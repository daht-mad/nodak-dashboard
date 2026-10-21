---
name: nodak-dashboard
description: 작업실 만들어줘, 내 봇 대시보드, 작업실에 내 기록 올려줘, 작업실 배포해줘 — 노닥빌리지 미니홈피 틀의 「봇 작업실」(크론·대화·스킬·일기장·책장·문자)을 내 Vercel에 올린다. 봇 기록은 비번으로 잠가 사이트에 같이 배포 — Airtable 필요 없음. OpenClaw·Hermes 둘 다.
---

# 봇 작업실 (nodak-dashboard)

집사만 보는 내 봇 작업실. 마을 미니홈피와 같은 틀이라 **집색·미니룸·봇 얼굴이 저절로 입혀진다**(마을열쇠로 겉모습만 빌림, 없으면 노닥 노랑 + 기본 방).
마을 활동(손님·방명록·도토리·장터·상점)은 여기 말고 노닥빌리지 사이트가 보여 준다 — 작업실은 **봇 컴퓨터 안 기록**만.
열쇠·토큰은 Vercel 환경변수(서버 함수)에만 둔다 — 화면 코드에 넣지 않는다.
봇 기록은 작업실 폴더의 `data.lock.json` 한 파일에 담겨 사이트와 같이 배포된다. **작업실 비번으로 잠겨 있어서** 파일 주소가 열려도 비번 없인 못 읽는다. 기록을 새로 고치는 것 = 다시 배포하는 것.

| 탭 | 어디서 오나 |
|---|---|
| 오늘 · 할 일 · 대화 · 스킬 | 봇이 담은 상태(크론·세션·스킬) |
| 일기장 | OpenClaw는 `memory/날짜.md`, Hermes는 그날 대화 제목(세션)으로 엮음 |
| 책장 | SOUL·IDENTITY·AGENTS (Hermes: SOUL·MEMORY·.hermes.md). **USER.md(집사 정보)는 기본으로 안 올림** |
| 사용량 | claude-cli 봇만 — `~/.claude/projects/<워크스페이스>/*.jsonl` 의 호출별 토큰을 하루씩 합침(API 키·Hermes 봇은 탭이 안 뜸) |
| 문자 | 솔라피 키가 있을 때만 — 같은 내용끼리 묶어 「N명에게 · 실패 M」 |

## 1. 작업실 폴더 만들기 (처음 한 번)

`template/` 폴더를 내 작업실 폴더로 복사한다(예: `~/my-workroom`). 봇 워크스페이스 `.env`에 두 줄:

```
DASH_PASSWORD=작업실 비번 (집사가 정함 — 3번 Vercel 환경변수와 같은 값)
DASH_SITE=~/my-workroom
```

## 2. 봇 기록 담기

```bash
node scripts/collect.mjs --dry     # 무엇을 담을지 먼저 보기
node scripts/collect.mjs           # 작업실 폴더의 data.lock.json 에 담기
```

- OpenClaw 봇 여러 마리면 `--agent <id>`로 마리마다 한 번씩 — 한 파일에 같이 담기고 다른 봇 몫은 안 지워진다. Hermes 프로필이면 `--hermes-home ~/.hermes/profiles/<이름>`
- 집사 정보까지 책장에 담으려면 집사가 직접 `--books SOUL,IDENTITY,AGENTS,USER`
- 담기 전에 전화번호·이메일·주민번호·열쇠 모양은 가려진다
- 비번을 바꾸면 collect를 다시 돌려 새 비번으로 잠근다(안 그러면 작업실에 「기록 파일이 안 열려」)

완료 확인: 출력 마지막 줄이 `담음 · … · data.lock.json NKB`.

## 3. 작업실 올리기 (내 Vercel)

작업실 폴더에서 처음 한 번 `vercel` 로 프로젝트를 잇고 환경변수를 넣는다:

| 이름 | 값 |
|---|---|
| `DASH_PASSWORD` | 작업실 비번 (1번과 같은 값) |
| `VILLAGE_KEY` | 마을열쇠 |
| `SOLAPI_API_KEY` · `SOLAPI_API_SECRET` | 있으면 문자 탭이 켜짐 |

그다음부턴 담고 올리기를 한 번에: `node scripts/collect.mjs --deploy` (마지막 줄 `배포 · https://…`).

- 하루 몇 번 자동으로 새로 고치려면 크론은 집사와 상의해서 직접 건다(예: 하루 2번 `--deploy`). 배포 한 번 = 기록 한 번 새로 고침
- 내 컴퓨터에서 먼저 보기: 작업실 폴더 `.env`에 위 값 → `node dev.mjs` → http://localhost:8800

완료 확인: 배포 주소에서 비번 화면 → 들어가면 탭(오늘·할 일·대화·스킬·일기장·책장), 맨 위 판이 우리 집 집색. 비번 없이 `/api/data`를 열면 401.

## 안 되는 것·주의

- Hermes 갈래는 공식 문서 기준으로 짰고 실제 Hermes 봇에서는 아직 안 돌려 봤다(2026-10-21). 칸 이름이 다르면 `collect.mjs`의 `pick()` 후보에 더한다
- 화면을 열 때 Airtable 호출은 마을 4번(우리 집 겉모습)뿐 → 서버가 10분 기억. 몇 분마다 자동 새로고침하게 고치지 않는다
- `data.lock.json`은 사이트 주소로 누구나 받을 수 있다. 비번 없인 못 읽지만 비번이 짧으면 맞혀 볼 수 있으니 작업실 비번은 길게
