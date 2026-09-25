import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function request(port, route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, body == null ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test('starts on a Mac-style host and controls simulated Android and iOS devices over HTTP', { timeout: 20_000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'farmbridge-smoke-'));
  const adb = path.join(temp, 'adb');
  const xcrun = path.join(temp, 'xcrun');
  const appiumCalls = [];
  const appium = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    appiumCalls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/session') res.end(JSON.stringify({ value: { sessionId: 'session-1' } }));
    else if (req.url.endsWith('/source')) res.end(JSON.stringify({ value: '<iOS />' }));
    else if (req.url.endsWith('/screenshot')) res.end(JSON.stringify({ value: Buffer.from('image').toString('base64') }));
    else res.end(JSON.stringify({ value: null }));
  });
  let child;
  let output = '';
  try {
    await fs.writeFile(adb, `#!${process.execPath}\nconst a=process.argv.slice(2); if(a[0]==='devices') process.stdout.write('List of devices attached\\nFAKE123 device model:Pixel_6 product:fake device:fake\\n'); else if(a.includes('screencap')) process.stdout.write('image'); else if(a.includes('cat')) process.stdout.write('<Android />');`);
    await fs.writeFile(xcrun, `#!${process.execPath}\nconst a=process.argv.slice(2); if(a[0]==='simctl') process.stdout.write(JSON.stringify({devices:{'iOS':[ {udid:'12345678-1234-1234-1234-123456789ABC',name:'iPhone Simulator',isAvailable:true,state:'Booted'} ]}})); else if(a[0]==='xctrace') process.stdout.write('== Devices ==\\nTest iPhone (18.0) (00008110-001234567890001E)\\n');`);
    await Promise.all([fs.chmod(adb, 0o755), fs.chmod(xcrun, 0o755)]);
    appium.listen(0, '127.0.0.1');
    await once(appium, 'listening');
    const port = await freePort();
    child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        HOST: '127.0.0.1', PORT: String(port),
        ADB_PATH: adb, PATH: `${temp}${path.delimiter}${process.env.PATH || ''}`,
        APPIUM_URL: `http://127.0.0.1:${appium.address().port}`,
        FARMBRIDGE_STATE: path.join(temp, 'state.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    let health;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode != null) throw new Error(`Server exited early: ${output}`);
      try { health = await request(port, '/api/health'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.deepEqual(health, { status: 200, data: { ok: true, name: 'farmbridge' } }, output);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /FarmBridge/);
    const devices = (await request(port, '/api/devices')).data.devices;
    assert.ok(devices.some(device => device.id === 'android:FAKE123'));
    assert.ok(devices.some(device => device.id === 'ios:12345678-1234-1234-1234-123456789ABC'));

    const android = await request(port, '/api/run', { deviceId: 'android:FAKE123', actions: [
      { type: 'launch', appId: 'com.example.app' }, { type: 'tap', x: 10, y: 20 },
      { type: 'source' }, { type: 'screenshot' },
    ] });
    assert.equal(android.status, 200);
    assert.equal(android.data.results[2].source, '<Android />');
    assert.equal(android.data.results[3].base64, Buffer.from('image').toString('base64'));

    const ios = await request(port, '/api/run', { deviceId: 'ios:12345678-1234-1234-1234-123456789ABC', actions: [
      { type: 'tap', x: 10, y: 20 }, { type: 'text', text: 'Hello' }, { type: 'source' },
    ] });
    assert.equal(ios.status, 200);
    assert.equal(ios.data.results[2].source, '<iOS />');
    assert.ok(appiumCalls.some(call => call.url === '/session' && call.body.capabilities.alwaysMatch['appium:automationName'] === 'XCUITest'));

    const added = await request(port, '/api/jobs', { deviceId: 'android:FAKE123', runAt: new Date(0).toISOString(), actions: [{ type: 'home' }] });
    assert.equal(added.status, 201);
    let jobs;
    for (let attempt = 0; attempt < 30; attempt++) {
      jobs = (await request(port, '/api/jobs')).data.jobs;
      if (jobs[0]?.status === 'done') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(jobs[0].status, 'done', output);
  } finally {
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
      if (child.exitCode == null) child.kill('SIGKILL');
    }
    if (appium.listening) await new Promise(resolve => appium.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
