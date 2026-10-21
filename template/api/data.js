// 내 봇 대시보드 — 서버 함수 하나. 열쇠·토큰은 여기(Vercel 환경변수)에만 있고 화면 코드엔 절대 안 나간다
// POST /api/data {password}  → 비번이 맞으면 쿠키를 준다 (30일)
// GET  /api/data             → 쿠키가 맞으면 {village, bot, diary(날짜·제목만), solapi}. ?fresh=1 이면 기억(10분) 무시
// GET  /api/data?book=<열쇠> · ?day=<열쇠> → 책 한 권 · 일기 하루 본문
// 환경변수
//   DASH_PASSWORD   대시보드 비번 (필수)
//   VILLAGE_KEY     마을열쇠 — 있으면 우리 집 집색·미니룸·봇 얼굴이 입혀짐(없으면 노닥 노랑) · VILLAGE_URL(기본 https://village.nodak.co.kr)
//   봇 기록은 Airtable 이 아니라 사이트에 같이 배포된 data.lock.json — 봇이 collect.mjs 로 작업실 비번(DASH_PASSWORD)을 걸어 잠가 둔 파일
//   SOLAPI_API_KEY · SOLAPI_API_SECRET — 있으면 문자 카드가 켜짐
// Airtable 호출: 화면을 열 때 마을 4번(우리 집 겉모습)뿐. 같은 서버가 10분 동안 기억해서 그 사이엔 0번
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E = process.env;
const VILLAGE_URL = (E.VILLAGE_URL || 'https://village.nodak.co.kr').replace(/\/$/, '');
// 작업실은 우리 집 겉모습(집색·미니룸·얼굴)만 마을에서 빌린다. 마을 활동은 노닥빌리지 마이페이지 몫
const KEEP_MS = 10 * 60e3;
let memo = null; // {at, data}

const sign = () => crypto.createHmac('sha256', E.DASH_PASSWORD || '').update('nodak-dashboard').digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = ''; for await (const c of req) s += c;
  try { return JSON.parse(s || '{}'); } catch { return {}; }
};
const send = (res, code, body, headers = {}) => {
  res.statusCode = code;
  for (const [k, v] of Object.entries({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })) res.setHeader(k, v);
  res.end(JSON.stringify(body));
};

async function village() {
  if (!E.VILLAGE_KEY) return { off: true };
  const r = await fetch(`${VILLAGE_URL}/api/village?sit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'house-data', parts: ['home', 'diary'], limit: 200, key: E.VILLAGE_KEY }), // 우리 집 겉모습 + 그림일기(일기장에 같이)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: j.error || `마을 ${r.status}` };
  return { at: j.at, parts: j.parts };
}

// 봇 기록 — data.lock.json 을 비번으로 연다. 배포본 안에서 먼저 찾고, 없으면 같은 사이트 주소에서 받는다
let lockMemo = null; // {raw, store} — 배포가 바뀌기 전엔 파일이 같으니 한 번만 연다
async function store(req) {
  let raw = '';
  for (const p of [path.join(process.cwd(), 'data.lock.json'), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data.lock.json')]) {
    try { raw = readFileSync(p, 'utf8'); break; } catch {}
  }
  if (!raw && req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (/^localhost|:\d+$/.test(host || '') ? 'http' : 'https');
    try { const r = await fetch(`${proto}://${host}/data.lock.json`, { cache: 'no-store' }); if (r.ok) raw = await r.text(); } catch {}
  }
  if (!raw) return null;
  if (lockMemo?.raw === raw) return lockMemo.store;
  const f = JSON.parse(raw);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(E.DASH_PASSWORD, Buffer.from(f.salt, 'base64'), 32), Buffer.from(f.iv, 'base64'));
  d.setAuthTag(Buffer.from(f.tag, 'base64'));
  let st; try { st = JSON.parse(gunzipSync(Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]))); }
  catch { throw new Error('기록 파일이 안 열려 — 봇의 DASH_PASSWORD 가 작업실 비번과 같은지 보고 collect 를 다시 돌려 줘'); }
  lockMemo = { raw, store: st };
  return st;
}
async function bot(req) {
  const st = await store(req);
  if (!st) return { off: true };
  return { bots: Object.values(st.bots || {}).sort((a, b) => String(b.at).localeCompare(String(a.at))) };
}
// 일기 목록 — 날짜·제목만 (본문은 누를 때)
async function diaryList(req) {
  const st = await store(req);
  if (!st) return { off: true };
  return { days: Object.values(st.diary || {}).map((x) => ({ key: x['열쇠'], bot: x['봇'], date: x['날짜'], heads: String(x['제목들'] || '').split('\n').filter(Boolean) })).sort((a, b) => String(b.date).localeCompare(String(a.date))) };
}
async function one(kind, key, req) {
  const st = await store(req);
  if (!st) return { off: true };
  const x = st[kind]?.[key];
  return x ? { key, ...x } : { error: '없어' };
}

async function solapi() {
  if (!E.SOLAPI_API_KEY || !E.SOLAPI_API_SECRET) return { off: true };
  const date = new Date().toISOString(), salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', E.SOLAPI_API_SECRET).update(date + salt).digest('hex');
  const r = await fetch('https://api.solapi.com/messages/v4/list?limit=200', {
    headers: { Authorization: `HMAC-SHA256 apiKey=${E.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}` },
  });
  if (!r.ok) return { error: `솔라피 ${r.status}` };
  const j = await r.json();
  const mask = (t) => String(t || '').replace(/^(\d{3})\d+(\d{4})$/, '$1-****-$2');
  const hide = (t) => String(t || '').replace(/01[016789][-. ]?\d{3,4}[-. ]?\d{4}/g, '010-****-****');
  // 같은 내용끼리 한 줄로 — 제목(LMS) 또는 첫 줄이 같으면 한 번의 발송으로 본다 (닿 10/21 「무슨 내용으로 N명에게」)
  const groups = {};
  for (const m of Object.values(j.messageList || {})) {
    const first = String(m.text || '').split('\n').find((l) => l.trim()) || '';
    const title = (m.subject || first).trim().replace(/\d{4,}/g, '●●●●').slice(0, 60); // 인증번호 같은 숫자는 가리고, 숫자만 다른 문자는 한 줄로
    const k = title + '|' + m.type;
    const g = (groups[k] ||= { title, type: m.type, text: hide(m.text).replace(/\d{6}/g, '●●●●●●').slice(0, 1000), to: [], ok: 0, fail: 0, at: m.dateCreated, fails: [] });
    g.to.push(mask(m.to));
    if (m.statusCode === '4000') g.ok++; else { g.fail++; g.fails.push(`${mask(m.to)} ${m.statusMessage || m.reason || m.statusCode || ''}`.trim()); }
    if (String(m.dateCreated) > String(g.at)) g.at = m.dateCreated;
  }
  const list = Object.values(groups).sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 30);
  return { list };
}

export default async function handler(req, res) {
  if (!E.DASH_PASSWORD) return send(res, 500, { error: 'DASH_PASSWORD 환경변수가 없어' });
  if (req.method === 'POST') {
    const { password } = await readBody(req);
    if (!same(password || '', E.DASH_PASSWORD)) return send(res, 403, { error: '비번이 달라' });
    const secure = String(req.headers.host || '').startsWith('localhost') || /:\d+$/.test(req.headers.host || '') ? '' : '; Secure';
    return send(res, 200, { ok: true }, { 'set-cookie': `dash=${sign()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}` });
  }
  if (!same(cookieOf(req).dash || '', sign())) return send(res, 401, { error: '비번이 필요해' });
  const q = new URL(req.url || '/', 'http://x').searchParams;
  if (q.get('book')) return send(res, 200, await one('books', q.get('book'), req).catch((e) => ({ error: e.message })));
  if (q.get('day')) return send(res, 200, await one('diary', q.get('day'), req).catch((e) => ({ error: e.message })));
  const fresh = q.get('fresh') === '1';
  if (!fresh && memo && Date.now() - memo.at < KEEP_MS) return send(res, 200, { ...memo.data, cached: true });
  const [v, b, dl, s] = await Promise.all([village(), bot(req), diaryList(req), solapi()].map((p) => p.catch((e) => ({ error: e.message }))));
  const data = { at: new Date().toISOString(), village: v, bot: b, diary: dl, solapi: s };
  memo = { at: Date.now(), data };
  return send(res, 200, data);
}
