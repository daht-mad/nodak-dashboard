#!/usr/bin/env node
// 봇 기록 모으기 — 세션·크론·스킬 요약, 책장(페르소나 파일), 일기장(날짜별 기억)을 내 Airtable 에 올린다
// OpenClaw 봇이든 Hermes 봇이든 이 파일 하나. 어느 쪽인지는 저절로 알아낸다(--kind 로 정할 수도 있음)
//
//   node collect.mjs             → 모아서 올림 (바뀐 책·일기만 올림)
//   node collect.mjs --dry       → 올리지 않고 무엇을 올릴지만 보여 줌
//   옵션: --kind openclaw|hermes · --agent <OpenClaw 봇 id> · --hermes-home <경로> · --days 60(일기 며칠치) · --books SOUL,IDENTITY,AGENTS,USER
//
// 표 3개(봇상태·봇책장·봇일기)는 처음 한 번 내 에어테이블 스킬로 만든다 — 칸 모양은 SKILL.md 「표 만들기」
// .env (봇 워크스페이스 또는 이 폴더) 에 넣을 것: DASH_AIRTABLE_TOKEN · DASH_AIRTABLE_BASE
// 개인정보: 집사 정보(USER.md)는 기본으로 안 올린다 — 올리려면 --books 에 USER 를 직접 넣는다.
//   올리기 전에 전화번호·이메일·열쇠·토큰 모양은 가린다(scrub). 그래도 내 Airtable 은 나만 보게 둘 것
// Airtable 호출: 한 번 돌릴 때 상태 1 + 바뀐 책·일기 10줄마다 1. 바뀐 게 없으면 1번
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const HOME = os.homedir();

// ── .env 읽기 (이미 있는 환경변수가 먼저)
for (const f of [flag('--env'), path.join(process.cwd(), '.env'), path.join(HOME, '.openclaw', 'workspace', '.env'), path.join(HOME, '.hermes', '.env')].filter(Boolean)) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const TOKEN = process.env.DASH_AIRTABLE_TOKEN, BASE = process.env.DASH_AIRTABLE_BASE;
const T = { status: process.env.DASH_TABLE_STATUS || '봇상태', books: process.env.DASH_TABLE_BOOKS || '봇책장', diary: process.env.DASH_TABLE_DIARY || '봇일기' };

// ── 가리기: 전화번호·이메일·주민번호·열쇠/토큰 모양
const scrub = (s = '') => String(s)
  .replace(/\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, '010-****-****')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '(메일 가림)')
  .replace(/\b\d{6}[- ]?[1-4]\d{6}\b/g, '(주민번호 가림)')
  .replace(/\b(sk|pk|xox[abpr]|ghp|gho|github_pat|pat|key|AIza)[-_A-Za-z0-9.]{16,}\b/g, '(열쇠 가림)')
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '(열쇠 가림)');
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const DAY = 864e5, now = Date.now();
const readIf = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8') : '');
const mtime = (p) => { try { return statSync(p).mtime.toISOString(); } catch { return ''; } };
const heads = (t) => t.split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '').replace(/\s*\(.*$/, '').trim()).filter(Boolean).slice(0, 8);
const json = (s) => JSON.parse(s.slice(s.search(/[[{]/)));
const has = async (bin) => { try { await run('which', [bin]); return true; } catch { return false; } };
const rm = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch {} };

// ── 어느 봇인지
const HERMES_HOME = flag('--hermes-home') || process.env.HERMES_HOME || path.join(HOME, '.hermes');
let KIND = flag('--kind');
if (!KIND) KIND = (await has('openclaw')) ? 'openclaw' : existsSync(HERMES_HOME) || (await has('hermes')) ? 'hermes' : '';
if (!KIND) { console.error('OpenClaw 도 Hermes 도 못 찾았어. --kind openclaw|hermes 로 알려 줘'); process.exit(1); }
const DAYS = Number(flag('--days', '60'));
const WANT_BOOKS = flag('--books', 'SOUL,IDENTITY,AGENTS').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const BOOK_NAME = { SOUL: '영혼', IDENTITY: '이름표', AGENTS: '약속', USER: '집사', MEMORY: '기억', TOOLS: '연장통' };

// ═══ OpenClaw
async function openclaw() {
  const agent = flag('--agent') || process.env.DASH_AGENT || '';
  const A = agent ? ['--agent', agent] : [];
  const oc = async (args) => json((await run('openclaw', [...args, '--json'], { maxBuffer: 64 << 20 })).stdout);
  // 세션 열쇠 → 사람이 읽는 이름 (agent:봇:slack:channel:c0…:thread:… → 「slack 채널 c0… · 스레드」)
  const short = (k = '') => { const m = k.replace(/^agent:[^:]+:/, '').match(/^(\w+):(channel|direct|dm|group)?:?([\w.-]+)?(:thread)?/); if (!m) return k.slice(0, 60);
    const [, ch, kind, id, th] = m; return ch === 'cron' ? '크론' : ch === 'main' ? '메인 대화' : `${ch} ${kind === 'direct' || kind === 'dm' ? 'DM' : '채널'} ${id ? id.toUpperCase() : ''}${th ? ' · 스레드' : ''}`.trim(); };
  // 워크스페이스 — 지금 폴더에 SOUL.md 가 있으면 거기, 아니면 DASH_WORKSPACE, 아니면 ~/.openclaw/workspace
  const ws = (process.env.DASH_WORKSPACE || (existsSync(path.join(process.cwd(), 'SOUL.md')) ? process.cwd() : path.join(HOME, '.openclaw', 'workspace'))).replace(/^~/, HOME);

  const sj = await oc(['sessions', ...A, '--limit', '300']);
  const sessions = sj.sessions || [];
  const day = sessions.filter((s) => now - (s.updatedAt || 0) < DAY);
  const sessionOut = {
    total: sj.totalCount ?? sessions.length, today: day.length,
    running: sessions.filter((s) => s.status === 'running').length,
    tokensToday: day.reduce((n, s) => n + (s.totalTokens || 0), 0),
    recent: sessions.slice(0, 15).map((s) => ({ title: short(s.key), key: s.key, kind: s.kind || '', status: s.status || '', at: s.updatedAt, tokens: s.totalTokens || 0, aborted: !!s.abortedLastRun })),
  };
  const cj = await oc(['cron', 'list', '--all']);
  const cron = (cj.jobs || cj || []).filter((j) => !agent || !j.agentId || j.agentId === agent).map((j) => {
    const st = j.state || {};
    return {
      name: j.name || j.id, enabled: !!j.enabled,
      schedule: j.schedule?.expr || (j.schedule?.everyMs ? `${Math.round(j.schedule.everyMs / 60000)}분마다` : j.schedule?.at || ''),
      status: st.lastRunStatus || '', lastAt: st.lastRunAtMs || 0, nextAt: st.nextRunAtMs || 0, errors: st.consecutiveErrors || 0,
      note: st.lastRunStatus === 'error' ? scrub(String(st.lastDiagnosticSummary || st.lastError || '')).slice(0, 200) : '',
    };
  });
  const kj = await oc(['skills', 'list', ...A]);
  const skills = kj.skills || [];
  const mine = skills.filter((s) => s.source !== 'openclaw-bundled');
  const skillOut = {
    total: skills.length, ready: skills.filter((s) => s.eligible && !s.disabled).length,
    mine: mine.filter((s) => s.eligible && !s.disabled).map((s) => s.name).sort(),
    blocked: mine.filter((s) => !s.eligible && !s.disabled).map((s) => ({ name: s.name, missing: [...(s.missing?.bins || []), ...(s.missing?.env || [])].slice(0, 3) })),
  };
  const books = WANT_BOOKS.map((k) => ({ key: k, file: `${k}.md`, p: path.join(ws, `${k}.md`) })).filter((b) => existsSync(b.p))
    .map((b) => ({ key: b.key, name: BOOK_NAME[b.key] || b.key, file: b.file, at: mtime(b.p), text: readIf(b.p) }));
  // 일기 = memory/YYYY-MM-DD.md
  const mdir = path.join(ws, 'memory'), since = new Date(now - DAYS * DAY).toISOString().slice(0, 10);
  const diary = (existsSync(mdir) ? readdirSync(mdir) : []).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) >= since)
    .map((f) => { const text = readIf(path.join(mdir, f)); return { date: f.slice(0, 10), heads: heads(text), text }; });
  return { agent: agent || 'default', kind: 'openclaw', sessions: sessionOut, cron, skills: skillOut, books, diary };
}

// ═══ Hermes — 공식 문서 기준: SOUL.md · memories/ · cron/jobs.json · skills/ · `hermes sessions export`
//   ⚠️ 실제 Hermes 봇에서 아직 안 돌려 봄 (2026-10-21). 칸 이름이 다르면 pick() 후보에 더한다
async function hermes() {
  const H = HERMES_HOME;
  const pick = (o, ...ks) => { for (const k of ks) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };
  const ms = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v || '') || 0);
  let rows = [];
  if (await has('hermes')) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'hdash-'));
    try {
      await run('hermes', ['sessions', 'export', path.join(tmp, 's.jsonl'), '--newer-than', `${DAYS}d`, '--redact'], { maxBuffer: 64 << 20, env: { ...process.env, HERMES_HOME: H } });
      rows = readIf(path.join(tmp, 's.jsonl')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch (e) { console.error('세션 내보내기 실패 —', e.message.split('\n')[0]); }
    rm(tmp);
  }
  const ses = rows.map((s) => ({
    title: scrub(pick(s, 'title', 'name') || '(제목 없음)').slice(0, 80), key: String(pick(s, 'id', 'session_id') || ''),
    kind: String(pick(s, 'source', 'platform') || ''), at: ms(pick(s, 'updated_at', 'last_active', 'ended_at', 'started_at', 'created_at')),
    status: String(pick(s, 'status') || ''), tokens: Number(pick(s, 'total_tokens', 'tokens') || 0), aborted: /err|intr/.test(String(pick(s, 'status') || '')),
  })).sort((a, b) => b.at - a.at);
  const day = ses.filter((s) => now - s.at < DAY);
  const sessionOut = { total: ses.length, today: day.length, running: 0, tokensToday: day.reduce((n, s) => n + s.tokens, 0), recent: ses.slice(0, 15) };
  let jobs = [];
  try { const j = JSON.parse(readIf(path.join(H, 'cron', 'jobs.json')) || '[]'); jobs = Array.isArray(j) ? j : j.jobs || Object.values(j); } catch {}
  const cron = jobs.map((j) => {
    const st = String(pick(j, 'last_status', 'last_run_status', 'status') || '');
    const bad = /fail|error/i.test(st);
    return {
      name: String(pick(j, 'name', 'id') || ''), enabled: !(pick(j, 'paused', 'disabled') === true || j.enabled === false),
      schedule: String(pick(j, 'schedule', 'cron', 'expr') || ''), status: bad ? 'error' : st ? 'ok' : '',
      lastAt: ms(pick(j, 'last_run_at', 'last_run')), nextAt: ms(pick(j, 'next_run_at', 'next_run')), errors: Number(pick(j, 'consecutive_failures', 'failures') || 0),
      note: bad ? scrub(String(pick(j, 'last_error', 'error') || st)).slice(0, 200) : '',
    };
  });
  const sd = path.join(H, 'skills');
  const names = existsSync(sd) ? readdirSync(sd).filter((d) => existsSync(path.join(sd, d, 'SKILL.md'))).sort() : [];
  const skillOut = { total: names.length, ready: names.length, mine: names, blocked: [] };
  // 책장 — SOUL.md · 기억(memories/MEMORY.md, IDENTITY 자리) · 약속(.hermes.md → AGENTS.md) · 집사(memories/USER.md, 기본 안 올림)
  const want = WANT_BOOKS.map((k) => (k === 'IDENTITY' ? 'MEMORY' : k));
  const where = { SOUL: [path.join(H, 'SOUL.md')], MEMORY: [path.join(H, 'memories', 'MEMORY.md')], USER: [path.join(H, 'memories', 'USER.md')],
    AGENTS: [path.join(process.cwd(), '.hermes.md'), path.join(process.cwd(), 'AGENTS.md'), path.join(H, 'AGENTS.md')] };
  const books = [...new Set(want)].map((k) => { const p = (where[k] || []).find((x) => existsSync(x)); return p && { key: k, name: BOOK_NAME[k] || k, file: path.basename(p), at: mtime(p), text: readIf(p) }; }).filter(Boolean);
  // 일기 — Hermes 엔 날짜별 기억 파일이 없다 → 그날 나눈 대화 제목(세션)으로 하루치를 엮는다
  const byDate = {};
  for (const s of ses) { if (!s.at) continue; const d = new Date(s.at + 9 * 3600e3).toISOString().slice(0, 10); (byDate[d] ||= []).push(s); }
  const diary = Object.entries(byDate).map(([date, list]) => ({
    date, heads: list.slice(0, 8).map((s) => s.title),
    text: `## 그날 나눈 대화 ${list.length}개\n\n` + list.map((s) => `- ${new Date(s.at + 9 * 3600e3).toISOString().slice(11, 16)} ${s.title}${s.kind ? ` · ${s.kind}` : ''}`).join('\n'),
  }));
  return { agent: path.basename(H) === '.hermes' ? 'hermes' : path.basename(H), kind: 'hermes', sessions: sessionOut, cron, skills: skillOut, books, diary };
}

// ═══ Airtable (기록 쓰기만 — 표·칸은 만들지 않는다)
async function upsert(table, merge, rows) {
  for (let i = 0; i < rows.length; i += 10) {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn: merge }, records: rows.slice(i, i + 10).map((fields) => ({ fields })) }),
    });
    if (!r.ok) throw new Error(`${table} 올리기 실패 ${r.status} ${await r.text()} — 표가 없으면 SKILL.md 「표 만들기」부터`);
  }
}

// ═══ 실행
const got = KIND === 'hermes' ? await hermes() : await openclaw();
const at = new Date().toISOString();
const summary = { v: 2, agent: got.agent, kind: got.kind, at, sessions: got.sessions,
  cron: got.cron.sort((a, b) => (b.status === 'error') - (a.status === 'error') || b.enabled - a.enabled || b.lastAt - a.lastAt),
  skills: got.skills, books: got.books.map((b) => ({ key: b.key, name: b.name, file: b.file, at: b.at })) };
// 바뀐 것만 — 지난번에 올린 내용의 지문을 기억해 둔다
const STATE = path.join(HOME, '.cache', 'nodak-dashboard', `${got.kind}-${got.agent}.json`);
let prev = {}; try { prev = JSON.parse(readIf(STATE) || '{}'); } catch {}
const next = { ...prev }, bookRows = [], diaryRows = [];
for (const b of got.books) { const text = scrub(b.text).slice(0, 95000), k = `${got.agent}:${b.key}`, h = sha(text); next[k] = h; if (prev[k] !== h) bookRows.push({ 열쇠: k, 봇: got.agent, 책: b.name, 파일: b.file, 고친시각: b.at, 내용: text }); }
for (const d of got.diary) { const text = scrub(d.text).slice(0, 95000), k = `${got.agent}:${d.date}`, h = sha(text); next[k] = h; if (prev[k] !== h) diaryRows.push({ 열쇠: k, 봇: got.agent, 날짜: d.date, 제목들: scrub(d.heads.join('\n')), 내용: text }); }

const fails = summary.cron.filter((c) => c.status === 'error').length;
const line = `${got.kind} · ${got.agent} · 세션 오늘 ${summary.sessions.today} · 크론 ${summary.cron.length}개(실패 ${fails}) · 스킬 ${summary.skills.ready} · 책 ${got.books.length}권(바뀜 ${bookRows.length}) · 일기 ${got.diary.length}일(바뀜 ${diaryRows.length})`;
if (DRY) {
  console.log(line);
  console.log('책:', got.books.map((b) => `${b.name}(${b.file})`).join(', ') || '없음');
  console.log('일기 최근:', got.diary.slice(-3).map((d) => `${d.date} ${d.heads.slice(0, 2).join(' / ')}`).join(' | ') || '없음');
  console.log('(올리지 않음)'); process.exit(0);
}
if (!TOKEN || !BASE) { console.error('DASH_AIRTABLE_TOKEN · DASH_AIRTABLE_BASE 가 없어 (.env 에 넣어 줘)'); process.exit(1); }
await upsert(T.status, ['봇'], [{ 봇: got.agent, 시각: at, 요약: JSON.stringify(summary) }]);
if (bookRows.length) await upsert(T.books, ['열쇠'], bookRows);
if (diaryRows.length) await upsert(T.diary, ['열쇠'], diaryRows);
mkdirSync(path.dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(next));
console.log(`올림 · ${line}`);
