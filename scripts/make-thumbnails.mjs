// Render models/<id>/thumb.jpg for every entry in models.json.
// Uses a real headless Chrome/Edge (WebGL) + a throwaway local static server.
// Run:  npm run thumbs          (or: node scripts/make-thumbnails.mjs)
//       node scripts/make-thumbnails.mjs --force     re-render everything
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, dirname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT             = resolve('.');
const DEFAULT_ROTATION = [-90, 0, 120];
const THUMB_W          = 640;
const THUMB_H          = 480;
const TIMEOUT_MS       = 120000;
const FORCE            = process.argv.includes('--force');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin':  'application/octet-stream',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
};

function safeJoin(root, rel) {
  const clean = String(rel || '').replace(/^[/\\]+/, '');
  const full  = resolve(root, clean);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error('path escapes project root: ' + rel);
  }
  return full;
}

let settle = () => {};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'POST' && (url.pathname === '/__save' || url.pathname === '/__fail')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      const rel  = url.searchParams.get('path') || '';

      if (url.pathname === '/__fail') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        settle(new Error(body.slice(0, 400) || 'thumbnail page reported a failure'));
        return;
      }

      const m = /^data:image\/(?:jpeg|png);base64,([\s\S]+)$/.exec(body);
      if (!m) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        settle(new Error('thumbnail page sent an unexpected payload'));
        return;
      }

      try {
        const file = safeJoin(ROOT, rel);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(m[1], 'base64'));
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        settle(null, rel);
      } catch (e) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        settle(e);
      }
      return;
    }

    let p = decodeURIComponent(url.pathname);
    if (!p || p === '/') p = '/index.html';
    const file = safeJoin(ROOT, p);
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

function chromeArgs(userDataDir, pageUrl) {
  return [
    '--headless=new',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--enable-unsafe-swiftshader',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${THUMB_W},${THUMB_H}`,
    pageUrl,
  ];
}

async function findGlb(id) {
  const dir = join(ROOT, 'models', id);
  try {
    const files = await readdir(dir);
    const glb = files.find((f) => f.toLowerCase().endsWith('.glb'));
    return glb ? join(dir, glb) : null;
  } catch {
    return null;
  }
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(ROOT, 'models.json'), 'utf8'));
  } catch {
    console.error('models.json not found or unreadable. Run: npm run manifest');
    process.exit(1);
  }

  const models = Array.isArray(manifest.models) ? manifest.models : [];
  if (!models.length) {
    console.log('No models in models.json - nothing to do.');
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    console.warn('No Chrome/Edge found. Set CHROME_PATH to a Chrome or Edge executable.');
    console.warn('Models without thumb.jpg will show "No preview" in the gallery.');
    return;
  }

  const queue = [];
  for (const m of models) {
    const glb = await findGlb(m.id);
    if (!glb) {
      console.warn(`[skip] ${m.id}: no .glb file`);
      continue;
    }
    const outRel = `models/${m.id}/thumb.jpg`;
    const outAbs = join(ROOT, outRel);
    if (!FORCE && existsSync(outAbs)) {
      const [a, b] = await Promise.all([stat(glb), stat(outAbs)]);
      if (b.mtimeMs >= a.mtimeMs) {
        console.log(`[keep] ${outRel}`);
        continue;
      }
    }
    queue.push({ model: m, outRel });
  }

  if (!queue.length) {
    console.log('Thumbnails are up to date.');
    return;
  }

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const userDataDir = join(tmpdir(), `glb-thumbs-${process.pid}`);

  let ok = 0, failed = 0;

  for (const job of queue) {
    const m   = job.model;
    const rot = (Array.isArray(m.rotation) && m.rotation.length === 3) ? m.rotation : DEFAULT_ROTATION;

    const pageUrl =
      `${base}/tools/thumb.html` +
      `?model=${encodeURIComponent(m.url || '')}` +
      `&rot=${encodeURIComponent(rot.join(','))}` +
      `&save=${encodeURIComponent(job.outRel)}`;

    const done = new Promise((res, rej) => {
      settle = (err, rel) => (err ? rej(err) : res(rel));
    });

    const proc = spawn(chrome, chromeArgs(userDataDir, pageUrl), { stdio: 'ignore' });
    proc.on('error', (e) => settle(e));

    let timer;
    try {
      await Promise.race([
        done,
        new Promise((_, rej) => {
          timer = setTimeout(
            () => rej(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)),
            TIMEOUT_MS
          );
        }),
      ]);
      console.log(`[ok]   ${job.outRel}`);
      ok++;
    } catch (e) {
      console.error(`[fail] ${m.id}: ${e.message}`);
      failed++;
    } finally {
      clearTimeout(timer);
      settle = () => {};
      try { proc.kill('SIGKILL'); } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  server.close();
  try { await rm(userDataDir, { recursive: true, force: true }); } catch {}

  console.log(`Thumbnails: ${ok} written, ${failed} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });