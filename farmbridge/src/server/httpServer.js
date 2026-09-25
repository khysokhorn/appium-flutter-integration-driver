import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

export function createHttpServer({ deviceManager, actionRunner, scheduler, studio }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true, name: 'farmbridge' });
      }
      if (req.method === 'GET' && url.pathname === '/api/devices') {
        return json(res, 200, { devices: await deviceManager.listDevices() });
      }
      if (req.method === 'POST' && url.pathname === '/api/run') {
        const body = await readJson(req);
        return json(res, 200, { results: await actionRunner.run(body.deviceId, body.actions) });
      }
      if (req.method === 'GET' && url.pathname === '/api/jobs') {
        return json(res, 200, { jobs: scheduler.list() });
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        const body = await readJson(req);
        return json(res, 201, { job: await scheduler.add(body) });
      }
      if (req.method === 'GET' && url.pathname === '/api/accounts') return json(res, 200, { accounts: studio.listAccounts() });
      if (req.method === 'POST' && url.pathname === '/api/accounts') return json(res, 201, { account: await studio.addAccount(await readJson(req)) });
      if (req.method === 'GET' && url.pathname === '/api/media') return json(res, 200, { media: studio.listMedia() });
      if (req.method === 'POST' && url.pathname === '/api/media/upload') {
        return json(res, 201, { media: await studio.upload(req, url.searchParams.get('name')) });
      }
      if (req.method === 'GET' && url.pathname === '/api/reels') return json(res, 200, { reels: studio.listReels() });
      if (req.method === 'POST' && url.pathname === '/api/reels') return json(res, 201, { reel: await studio.addReel(await readJson(req)) });
      const prepare = url.pathname.match(/^\/api\/reels\/([a-f0-9-]+)\/prepare$/);
      if (req.method === 'POST' && prepare) return json(res, 200, { reel: await studio.prepare(prepare[1]) });
      const iosImport = url.pathname.match(/^\/api\/reels\/([a-f0-9-]+)\/confirm-ios-import$/);
      if (req.method === 'POST' && iosImport) return json(res, 200, { reel: await studio.confirmIosImport(iosImport[1]) });
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return file(res, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/app.js') {
        return file(res, path.join(publicDir, 'app.js'), 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/style.css') {
        return file(res, path.join(publicDir, 'style.css'), 'text/css; charset=utf-8');
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) throw new Error('Request body too large');
  }
  return text ? JSON.parse(text) : {};
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function file(res, filePath, contentType) {
  const data = await fs.readFile(filePath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(data);
}
