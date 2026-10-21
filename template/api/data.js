// 내 봇 대시보드 — 서버 함수 하나. 열쇠·토큰은 여기(Vercel 환경변수)에만 있고 화면 코드엔 절대 안 나간다
// POST /api/data {password}  → 비번이 맞으면 쿠키를 준다 (30일)
// GET  /api/data             → 쿠키가 맞으면 {village, bot, diary(날짜·제목만), solapi}. ?fresh=1 이면 기억(10분) 무시
// GET  /api/data?book=<열쇠> · ?day=<열쇠> → 책 한 권 · 일기 하루 본문 (누를 때만 Airtable 1번)
// 환경변수
//   DASH_PASSWORD   대시보드 비번 (필수)
//   VILLAGE_KEY     마을열쇠 — 있으면 우리 집 집색·미니룸·봇 얼굴이 입혀짐(없으면 노닥 노랑) · VILLAGE_URL(기본 https://village.nodak.co.kr)
//   AIRTABLE_TOKEN · AIRTABLE_BASE — 봇이 올린 내부 기록(표 봇상태·봇책장·봇일기). 있으면 봇·일기장·책장 탭이 켜짐
//   SOLAPI_API_KEY · SOLAPI_API_SECRET — 있으면 문자 카드가 켜짐
// Airtable 호출: 화면을 열 때 마을 4번 + 내 표 2번(상태·일기 목록). 같은 서버가 10분 동안 기억해서 그 사이엔 0번. 책·일기 본문은 누를 때 1번
import crypto from 'node:crypto';

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
    body: JSON.stringify({ op: 'house-data', part: 'home', key: E.VILLAGE_KEY }), // part 하나 = 지금 라이브 마을 서버 그대로 (Airtable 4번)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: j.error || `마을 ${r.status}` };
  return { at: j.at, parts: j.parts };
}

const AT = async (table, qs = '') => {
  const out = []; let offset = '';
  do {
    const r = await fetch(`https://api.airtable.com/v0/${E.AIRTABLE_BASE}/${encodeURIComponent(table)}?pageSize=100${qs}${offset ? `&offset=${offset}` : ''}`, { headers: { Authorization: `Bearer ${E.AIRTABLE_TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable ${table} ${r.status}`);
    const j = await r.json(); out.push(...j.records); offset = j.offset || '';
  } while (offset);
  return out;
};
const fq = (xs) => xs.map((x) => `&fields[]=${encodeURIComponent(x)}`).join('');
const AT_ON = () => E.AIRTABLE_TOKEN && E.AIRTABLE_BASE;
async function bot() {
  if (!AT_ON()) return { off: true };
  const rows = (await AT(E.DASH_TABLE_STATUS || '봇상태')).map((x) => { try { return JSON.parse(x.fields['요약'] || ''); } catch { return null; } }).filter(Boolean);
  return { bots: rows.sort((a, b) => String(b.at).localeCompare(String(a.at))) };
}
// 일기 목록 — 날짜·제목만 (본문은 누를 때)
async function diaryList() {
  if (!AT_ON()) return { off: true };
  const rows = await AT(E.DASH_TABLE_DIARY || '봇일기', fq(['열쇠', '봇', '날짜', '제목들']));
  return { days: rows.map((x) => ({ key: x.fields['열쇠'], bot: x.fields['봇'], date: x.fields['날짜'], heads: String(x.fields['제목들'] || '').split('\n').filter(Boolean) })).sort((a, b) => String(b.date).localeCompare(String(a.date))) };
}
async function one(table, key) {
  if (!AT_ON()) return { off: true };
  const f = encodeURIComponent(`{열쇠}='${String(key).replace(/'/g, "\\'")}'`);
  const [x] = await AT(table, `&maxRecords=1&filterByFormula=${f}`);
  return x ? { key, ...x.fields } : { error: '없어' };
}

async function solapi() {
  if (!E.SOLAPI_API_KEY || !E.SOLAPI_API_SECRET) return { off: true };
  const date = new Date().toISOString(), salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', E.SOLAPI_API_SECRET).update(date + salt).digest('hex');
  const r = await fetch('https://api.solapi.com/messages/v4/list?limit=20', {
    headers: { Authorization: `HMAC-SHA256 apiKey=${E.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}` },
  });
  if (!r.ok) return { error: `솔라피 ${r.status}` };
  const j = await r.json();
  const list = Object.values(j.messageList || {}).map((m) => ({
    at: m.dateCreated, type: m.type, to: String(m.to || '').replace(/^(\d{3})\d+(\d{4})$/, '$1-****-$2'), // 번호는 가려서
    status: m.statusCode, msg: m.statusMessage || '', ok: m.statusCode === '4000',
  }));
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
  if (q.get('book')) return send(res, 200, await one(E.DASH_TABLE_BOOKS || '봇책장', q.get('book')).catch((e) => ({ error: e.message })));
  if (q.get('day')) return send(res, 200, await one(E.DASH_TABLE_DIARY || '봇일기', q.get('day')).catch((e) => ({ error: e.message })));
  const fresh = q.get('fresh') === '1';
  if (!fresh && memo && Date.now() - memo.at < KEEP_MS) return send(res, 200, { ...memo.data, cached: true });
  const [v, b, dl, s] = await Promise.all([village(), bot(), diaryList(), solapi()].map((p) => p.catch((e) => ({ error: e.message }))));
  const data = { at: new Date().toISOString(), village: v, bot: b, diary: dl, solapi: s };
  memo = { at: Date.now(), data };
  return send(res, 200, data);
}
