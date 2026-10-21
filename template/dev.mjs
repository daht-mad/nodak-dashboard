// 내 컴퓨터에서 미리 보기 — node dev.mjs (PORT 기본 8800). .env 를 읽어 환경변수로 쓴다. 배포엔 안 쓰는 파일
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.DASH_ENV || path.join(dir, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const { default: handler } = await import('./api/data.js');
http.createServer((req, res) => {
  // DASH_DEV_OPEN=1 — 내 컴퓨터(테일넷) 미리보기에서만 비번 화면 건너뛰기. 이 파일은 배포에 안 올라간다(.vercelignore)
  if (process.env.DASH_DEV_OPEN === '1' && req.url.startsWith('/api/data') && req.method === 'GET') {
    const sig = crypto.createHmac('sha256', process.env.DASH_PASSWORD || '').update('nodak-dashboard').digest('hex');
    req.headers.cookie = `${req.headers.cookie ? req.headers.cookie + '; ' : ''}dash=${sig}`;
  }
  if (req.url.startsWith('/api/data')) return handler(req, res).catch((e) => { res.statusCode = 500; res.end(String(e)); });
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  const file = f.startsWith(dir) && existsSync(f) && !f.endsWith('.env') ? f : path.join(dir, 'index.html');
  const type = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
  res.setHeader('content-type', type);
  res.end(readFileSync(file));
}).listen(Number(process.env.PORT || 8800), () => console.log(`http://localhost:${process.env.PORT || 8800}`));
