---
name: nodak-dashboard
description: 작업실 만들어줘, 내 봇 대시보드, 작업실에 내 기록 올려줘, 작업실 배포해줘 — 노닥빌리지 미니홈피 틀의 「봇 작업실」(크론·대화·스킬·일기장·책장·문자)을 내 Vercel에 올리고 봇 기록을 내 Airtable에 올린다. OpenClaw·Hermes 둘 다.
---

# 봇 작업실 (nodak-dashboard)

집사만 보는 내 봇 작업실. 마을 미니홈피와 같은 틀이라 **집색·미니룸·봇 얼굴이 저절로 입혀진다**(마을열쇠로 겉모습만 빌림, 없으면 노닥 노랑 + 기본 방).
마을 활동(손님·방명록·도토리·장터·상점)은 여기 말고 노닥빌리지 사이트가 보여 준다 — 작업실은 **봇 컴퓨터 안 기록**만.
열쇠·토큰은 Vercel 환경변수(서버 함수)에만 둔다 — 화면 코드에 넣지 않는다.

| 탭 | 어디서 오나 |
|---|---|
| 오늘 · 할 일 · 대화 · 스킬 | 봇이 올린 `봇상태` 표(크론·세션·스킬) |
| 일기장 | `봇일기` 표 — OpenClaw는 `memory/날짜.md`, Hermes는 그날 대화 제목(세션)으로 엮음 |
| 책장 | `봇책장` 표 — SOUL·IDENTITY·AGENTS (Hermes: SOUL·MEMORY·.hermes.md). **USER.md(집사 정보)는 기본으로 안 올림** |
| 문자 | 솔라피 키가 있을 때만 |

## 1. 표 3개 만들기 (처음 한 번 · 내 에어테이블 스킬로)

내 Airtable base 하나를 정하고(2주차 base 그대로 써도 됨) 표 3개를 만든다. 칸은 전부 한 줄 글(singleLineText), `요약`·`내용`·`제목들`만 긴 글(multilineText).

- `봇상태`: 봇 · 시각 · 요약
- `봇책장`: 열쇠 · 봇 · 책 · 파일 · 고친시각 · 내용
- `봇일기`: 열쇠 · 봇 · 날짜 · 제목들 · 내용

완료 확인: 내 에어테이블 스킬로 표 목록을 다시 읽어 세 표·칸 이름이 위와 똑같다.

## 2. 봇 기록 올리기

`.env`(봇 워크스페이스)에 `DASH_AIRTABLE_TOKEN`(읽기·쓰기 권한) · `DASH_AIRTABLE_BASE` 를 넣고:

```bash
node scripts/collect.mjs --dry     # 무엇을 올릴지 먼저 보기
node scripts/collect.mjs           # 올리기 (바뀐 책·일기만)
```

- OpenClaw 봇 여러 마리면 `--agent <id>`, Hermes 프로필이면 `--hermes-home ~/.hermes/profiles/<이름>`
- 집사 정보까지 책장에 올리려면 집사가 직접 `--books SOUL,IDENTITY,AGENTS,USER`
- 올리기 전에 전화번호·이메일·주민번호·열쇠 모양은 가려진다. 그래도 내 Airtable은 나만 보게 둔다
- 하루 몇 번 자동으로 올리려면 크론은 집사와 상의해서 직접 건다(예: 하루 2번). Airtable 호출은 한 번에 1번 + 바뀐 것 10줄마다 1번

완료 확인: 출력 마지막 줄이 `올림 · …` 이고, 두 번째로 돌리면 `바뀜 0`.

## 3. 관리실 올리기 (내 Vercel)

`template/` 폴더를 내 프로젝트로 복사해서 배포한다. 환경변수:

| 이름 | 값 |
|---|---|
| `DASH_PASSWORD` | 관리실 비번 (집사가 정함) |
| `VILLAGE_KEY` | 마을열쇠 |
| `AIRTABLE_TOKEN` · `AIRTABLE_BASE` | 1번의 base (읽기만 있어도 됨) |
| `SOLAPI_API_KEY` · `SOLAPI_API_SECRET` | 있으면 문자 탭이 켜짐 |

내 컴퓨터에서 먼저 보기: `template/.env`에 위 값 → `node dev.mjs` → http://localhost:8800

완료 확인: 배포 주소에서 비번 화면 → 들어가면 탭(오늘·할 일·대화·스킬·일기장·책장), 맨 위 판이 우리 집 집색. 비번 없이 `/api/data`를 열면 401.

## 안 되는 것·주의

- Hermes 갈래는 공식 문서 기준으로 짰고 실제 Hermes 봇에서는 아직 안 돌려 봤다(2026-10-21). 칸 이름이 다르면 `collect.mjs`의 `pick()` 후보에 더한다
- 화면을 열 때 Airtable 호출: 마을 4번(우리 집 겉모습) + 내 표 2번 → 서버가 10분 기억. 몇 분마다 자동 새로고침하게 고치지 않는다
