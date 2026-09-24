import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function runFile(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function runFileBuffer(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function parseAdbDevices(output) {
  return output.split(/\r?\n/).slice(1).map((x) => x.trim()).filter(Boolean).map((line) => {
    const [serial, state, ...parts] = line.split(/\s+/);
    const attrs = Object.fromEntries(parts.filter((x) => x.includes(':')).map((x) => {
      const i = x.indexOf(':');
      return [x.slice(0, i), x.slice(i + 1)];
    }));
    return {
      id: 'android:' + serial,
      serial,
      platform: 'android',
      state,
      name: (attrs.model || serial).replace(/_/g, ' '),
      product: attrs.product || null,
      device: attrs.device || null
    };
  });
}

export function parseXctraceDevices(output) {
  const out = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('==') || /^Mac.*\([^)]+\)$/.test(line)) continue;
    const match = line.match(/^(.*?)\s+\((?:[^()]*)\)\s+\(([0-9A-Fa-f-]{8,})\)(?:\s+\(Simulator\))?$/);
    if (!match) continue;
    out.push({
      id: 'ios:' + match[2],
      udid: match[2],
      platform: 'ios',
      name: match[1].trim(),
      kind: line.endsWith('(Simulator)') ? 'simulator' : 'physical',
      state: 'unknown'
    });
  }
  return out;
}

class AndroidBridge {
  constructor(adbPath = process.env.ADB_PATH || 'adb') {
    this.platform = 'android';
    this.adbPath = adbPath;
  }
  async listDevices() {
    return parseAdbDevices((await runFile(this.adbPath, ['devices', '-l'])).stdout);
  }
  shell(id, args) { return runFile(this.adbPath, ['-s', id, 'shell', ...args]); }
  tap(id, x, y) { return this.shell(id, ['input', 'tap', String(x), String(y)]); }
  swipe(id, x1, y1, x2, y2, durationMs = 400) { return this.shell(id, ['input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(durationMs)]); }
  inputText(id, text) { return this.shell(id, ['input', 'text', text.replace(/%/g, '\\%').replace(/ /g, '%s')]); }
  launchApp(id, appId) { return this.shell(id, ['monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']); }
  terminateApp(id, appId) { return this.shell(id, ['am', 'force-stop', appId]); }
  home(id) { return this.shell(id, ['input', 'keyevent', 'KEYCODE_HOME']); }
  async screenshot(id) { return (await runFileBuffer(this.adbPath, ['-s', id, 'exec-out', 'screencap', '-p'])).stdout; }
  async source(id) {
    const remote = '/sdcard/farmbridge-window.xml';
    await this.shell(id, ['uiautomator', 'dump', remote]);
    return (await this.shell(id, ['cat', remote])).stdout;
  }
  install(id, apkPath) { return runFile(this.adbPath, ['-s', id, 'install', '-r', apkPath]); }
  pushFile(id, localPath, remotePath) { return runFile(this.adbPath, ['-s', id, 'push', localPath, remotePath]); }
}

class IosBridge {
  constructor(appiumUrl = process.env.APPIUM_URL || 'http://127.0.0.1:4723') {
    this.platform = 'ios';
    this.appiumUrl = appiumUrl.replace(/\/$/, '');
    this.sessions = new Map();
  }
  async listDevices() {
    const devices = new Map();
    try {
      const data = JSON.parse((await runFile('xcrun', ['simctl', 'list', 'devices', '--json'])).stdout);
      for (const group of Object.values(data.devices || {})) {
        for (const d of group) {
          if (!d.isAvailable) continue;
          devices.set(d.udid, { id: 'ios:' + d.udid, udid: d.udid, platform: 'ios', name: d.name, kind: 'simulator', state: String(d.state || 'unknown').toLowerCase() });
        }
      }
    } catch {}
    try {
      for (const d of parseXctraceDevices((await runFile('xcrun', ['xctrace', 'list', 'devices'])).stdout)) devices.set(d.udid, d);
    } catch (error) {
      if (devices.size === 0) throw error;
    }
    return [...devices.values()];
  }
  async request(method, route, body) {
    const response = await fetch(this.appiumUrl + route, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await response.json(); } catch {}
    if (!response.ok || (json && json.value && json.value.error)) {
      const message = json && json.value && json.value.message ? json.value.message : method + ' ' + route + ' failed with HTTP ' + response.status;
      throw new Error(message);
    }
    return json || {};
  }
  async session(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    const result = await this.request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:udid': id,
          'appium:noReset': true,
          'appium:newCommandTimeout': 300
        },
        firstMatch: [{}]
      }
    });
    const sessionId = result.sessionId || (result.value && result.value.sessionId);
    if (!sessionId) throw new Error('Appium did not return a session id');
    this.sessions.set(id, sessionId);
    return sessionId;
  }
  async tap(id, x, y) {
    const s = await this.session(id);
    await this.request('POST', '/session/' + s + '/actions', { actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x, y, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 }] }] });
    try { await this.request('DELETE', '/session/' + s + '/actions'); } catch {}
  }
  async swipe(id, x1, y1, x2, y2, durationMs = 400) {
    const s = await this.session(id);
    await this.request('POST', '/session/' + s + '/actions', { actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: x1, y: y1, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerMove', duration: durationMs, x: x2, y: y2, origin: 'viewport' }, { type: 'pointerUp', button: 0 }] }] });
    try { await this.request('DELETE', '/session/' + s + '/actions'); } catch {}
  }
  async inputText(id, text) {
    const s = await this.session(id);
    await this.request('POST', '/session/' + s + '/keys', { text, value: [...text] });
  }
  async launchApp(id, appId) { const s = await this.session(id); await this.request('POST', '/session/' + s + '/appium/device/activate_app', { bundleId: appId }); }
  async terminateApp(id, appId) { const s = await this.session(id); await this.request('POST', '/session/' + s + '/appium/device/terminate_app', { bundleId: appId }); }
  async home(id) { const s = await this.session(id); await this.request('POST', '/session/' + s + '/execute/sync', { script: 'mobile: pressButton', args: [{ name: 'home' }] }); }
  async screenshot(id) { const s = await this.session(id); const r = await this.request('GET', '/session/' + s + '/screenshot'); return Buffer.from(r.value, 'base64'); }
  async source(id) { const s = await this.session(id); return (await this.request('GET', '/session/' + s + '/source')).value; }
}

class DeviceManager {
  constructor(bridges) { this.bridges = bridges; }
  bridgeFor(deviceId) {
    const split = String(deviceId).split(/:(.+)/);
    const bridge = this.bridges.find((x) => x.platform === split[0]);
    if (!bridge || !split[1]) throw new Error('Unsupported device id: ' + deviceId);
    return { bridge, id: split[1] };
  }
  async listDevices() {
    const groups = await Promise.all(this.bridges.map(async (bridge) => {
      try { return await bridge.listDevices(); }
      catch (error) { return [{ id: bridge.platform + ':unavailable', platform: bridge.platform, name: bridge.platform + ' bridge unavailable', state: 'unavailable', error: error.message }]; }
    }));
    return groups.flat();
  }
}

class ActionRunner {
  constructor(manager) { this.manager = manager; }
  async run(deviceId, actions) {
    if (!Array.isArray(actions)) throw new Error('actions must be an array');
    const target = this.manager.bridgeFor(deviceId);
    const results = [];
    for (const a of actions) {
      if (a.type === 'tap') await target.bridge.tap(target.id, num(a.x, 'x'), num(a.y, 'y'));
      else if (a.type === 'swipe') await target.bridge.swipe(target.id, num(a.x1, 'x1'), num(a.y1, 'y1'), num(a.x2, 'x2'), num(a.y2, 'y2'), a.durationMs == null ? 400 : num(a.durationMs, 'durationMs'));
      else if (a.type === 'text') await target.bridge.inputText(target.id, str(a.text, 'text'));
      else if (a.type === 'launch') await target.bridge.launchApp(target.id, str(a.appId, 'appId'));
      else if (a.type === 'terminate') await target.bridge.terminateApp(target.id, str(a.appId, 'appId'));
      else if (a.type === 'home') await target.bridge.home(target.id);
      else if (a.type === 'wait') await new Promise((resolve) => setTimeout(resolve, Math.min(num(a.ms, 'ms'), 60000)));
      else if (a.type === 'source') results.push({ type: 'source', source: await target.bridge.source(target.id), ok: true });
      else if (a.type === 'screenshot') {
        const data = await target.bridge.screenshot(target.id);
        if (a.path) { await fs.writeFile(path.resolve(a.path), data); results.push({ type: 'screenshot', path: path.resolve(a.path), ok: true }); }
        else results.push({ type: 'screenshot', base64: data.toString('base64'), ok: true });
        continue;
      } else throw new Error('Unsupported action type: ' + a.type);
      results.push({ type: a.type, ok: true });
    }
    return results;
  }
}

class Scheduler {
  constructor(runner) {
    this.runner = runner;
    this.file = process.env.FARMBRIDGE_STATE || path.join(os.homedir(), '.farmbridge', 'state.json');
    this.jobs = [];
    this.running = new Set();
  }
  async start() {
    try { this.jobs = JSON.parse(await fs.readFile(this.file, 'utf8')).jobs || []; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.timer = setInterval(() => this.tick().catch(console.error), 1000);
    this.timer.unref();
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ jobs: this.jobs }, null, 2));
  }
  async add(body) {
    if (!body.deviceId || !Array.isArray(body.actions)) throw new Error('deviceId and actions are required');
    const date = new Date(body.runAt || Date.now());
    if (Number.isNaN(date.getTime())) throw new Error('Invalid runAt');
    if (body.repeatEveryMs != null && Number(body.repeatEveryMs) < 60000) throw new Error('repeatEveryMs must be at least 60000');
    const job = { id: crypto.randomUUID(), deviceId: body.deviceId, actions: body.actions, runAt: date.toISOString(), repeatEveryMs: body.repeatEveryMs == null ? null : Number(body.repeatEveryMs), status: 'pending', createdAt: new Date().toISOString(), lastError: null };
    this.jobs.push(job);
    await this.save();
    return job;
  }
  async tick(now = Date.now()) {
    for (const job of this.jobs) {
      if (job.status !== 'pending' || this.running.has(job.id) || new Date(job.runAt).getTime() > now) continue;
      this.running.add(job.id);
      job.status = 'running';
      await this.save();
      try {
        await this.runner.run(job.deviceId, job.actions);
        job.lastError = null;
        if (job.repeatEveryMs) { job.runAt = new Date(now + job.repeatEveryMs).toISOString(); job.status = 'pending'; }
        else { job.status = 'done'; job.finishedAt = new Date().toISOString(); }
      } catch (error) { job.status = 'failed'; job.lastError = error.message; }
      finally { this.running.delete(job.id); await this.save(); }
    }
  }
}

function str(value, name) { if (typeof value !== 'string' || !value) throw new Error(name + ' is required'); return value; }
function num(value, name) { const n = Number(value); if (!Number.isFinite(n)) throw new Error(name + ' must be a number'); return n; }
async function readJson(req) { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 1000000) throw new Error('Request too large'); } return text ? JSON.parse(text) : {}; }
function send(res, status, value, type = 'application/json; charset=utf-8') { res.writeHead(status, { 'content-type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(value) : value); }

function dashboard() {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FarmBridge</title><style>body{font-family:system-ui;background:#101216;color:#eee;margin:0}main{max-width:900px;margin:auto;padding:24px}.card{background:#191d24;border:1px solid #303744;border-radius:14px;padding:18px;margin:16px 0}button,select,textarea{font:inherit;background:#0d1015;color:#fff;border:1px solid #3b4555;border-radius:8px;padding:9px}button{background:#f6bc47;color:#1d1608;font-weight:700}textarea,select{width:100%;box-sizing:border-box;margin:8px 0}textarea{min-height:220px;font-family:monospace}</style></head><body><main><h1>FarmBridge</h1><p>Android ADB + iOS Appium/XCUITest</p><div class="card"><h2>Devices</h2><div id="devices">Loading...</div></div><div class="card"><h2>Run workflow</h2><select id="device"></select><textarea id="actions">[{"type":"home"},{"type":"wait","ms":500}]</textarea><button id="run">Run</button><pre id="out"></pre></div><script>async function load(){const d=await fetch("/api/devices").then(r=>r.json());devices.innerHTML=d.devices.map(x=>"<div><b>"+(x.name||x.id)+"</b><br><small>"+x.id+" · "+(x.state||"")+(x.error?" · "+x.error:"")+"</small></div>").join("<hr>")||"No devices";device.innerHTML=d.devices.filter(x=>x.state!=="unavailable").map(x=>"<option value=\""+x.id+"\">"+(x.name||x.id)+" ("+x.platform+")</option>").join("")}run.onclick=async()=>{out.textContent="Running...";const r=await fetch("/api/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId:device.value,actions:JSON.parse(actions.value)})});out.textContent=JSON.stringify(await r.json(),null,2)};load()</script></main></body></html>';
}

async function main() {
  const android = new AndroidBridge();
  const ios = new IosBridge();
  const manager = new DeviceManager([android, ios]);
  const runner = new ActionRunner(manager);
  const command = process.argv[2];
  if (command === 'devices') { console.log(JSON.stringify(await manager.listDevices(), null, 2)); return; }
  if (command === 'run') {
    const deviceId = process.argv[3];
    const file = process.argv[4];
    if (!deviceId || !file) throw new Error('Usage: node src/farmbridge.mjs run <deviceId> <workflow.json>');
    const body = JSON.parse(await fs.readFile(file, 'utf8'));
    console.log(JSON.stringify(await runner.run(deviceId, body.actions || body), null, 2));
    return;
  }
  const scheduler = new Scheduler(runner);
  await scheduler.start();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, dashboard(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, name: 'farmbridge' });
      if (req.method === 'GET' && url.pathname === '/api/devices') return send(res, 200, { devices: await manager.listDevices() });
      if (req.method === 'POST' && url.pathname === '/api/run') { const body = await readJson(req); return send(res, 200, { results: await runner.run(body.deviceId, body.actions) }); }
      if (req.method === 'GET' && url.pathname === '/api/jobs') return send(res, 200, { jobs: scheduler.jobs });
      if (req.method === 'POST' && url.pathname === '/api/jobs') return send(res, 201, { job: await scheduler.add(await readJson(req)) });
      return send(res, 404, { error: 'Not found' });
    } catch (error) { return send(res, 400, { error: error.message }); }
  });
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8787);
  server.listen(port, host, () => console.log('FarmBridge listening at http://' + host + ':' + port));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
