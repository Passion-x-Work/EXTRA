# EXTRA · 폴더·파일 정리 제안서

> 작성일: 2026-08-04
> 목적: 중복 문서 정리, 고아 파일 식별, 깨진 링크 수정, 파일 분류
> **이 문서는 제안서입니다. 실제 변경은 팀 합의 후에 진행합니다.**

---

## 1. 중복 문서 분석

### 1-1. `docs/STRUCTURE.md` ↔ `docs/폴더구조.md`

| 항목 | STRUCTURE.md (38줄, 2KB) | 폴더구조.md (70줄, 4.4KB) |
|---|---|---|
| 폴더 트리 | 있음 (구 `client/` 경로 사용) | 있음 (구 `client/` 경로 + 🔜 상태 표기) |
| 문서 안내표 | 있음 (5개 문서) | 없음 |
| 인물 파일 4종 설명 | 있음 | 없음 |
| 디렉토리 책임표 | 없음 | 있음 (AI 관여 구분) |
| 명명 규칙 | 없음 | 있음 (에이전트/사료 ID/리서치/티어) |
| 경계 원칙 | 없음 | 있음 (4조항) |
| 다른 문서 링크 | 없음 | `기능명세서`, `하네스-엔지니어링` 링크 |

**판정: 겹침 (제목·폴더 트리 중복), 각각 고유 내용 존재**

- `STRUCTURE.md`: 문서 안내표 + 인물 파일 4종 설명이 고유
- `폴더구조.md`: 디렉토리 책임표 + 명명 규칙 + 경계 원칙이 고유
- 둘 다 구 경로(`client/`, `harness/`, `fallback/`, `gladiator`, `hokusai`)를 사용 → **오래됨**

> [!IMPORTANT]
> README.md가 최신 폴더 구조(web/, server/ai, server/engine, server/rag)를 이미 상세히 포함하고 있어, 두 문서 모두 README와 중복됩니다.

---

### 1-2. `docs/research/sejong-sources.md` ↔ `docs/research/sejong-1443-1444.md`

| 항목 | sejong-sources.md (139줄, 19.5KB) | sejong-1443-1444.md (119줄, 14.1KB) |
|---|---|---|
| 출처 목록 | 있음 (S1–S4, T1–T4) | 있음 (동일) |
| 타임라인 표 | 있음 (6행, 상세) | 있음 (동일 6행, 약간 축약) |
| 쟁점 대응표 | 있음 (6조, 매우 상세) | 있음 (6조, 약간 축약) |
| 사료 조각 | 있음 (7개, 조각별 #### 제목) | 있음 (7개, S-01~S-07 접두사) |
| 성격·말투 근거 | 있음 | 있음 (동일) |
| 날짜 정설/이설 메모 | 있음 | 있음 |

**판정: 거의 완전 중복 (95%+ 동일 내용)**

- `sejong-sources.md`가 더 상세하고 최신 (knowledge.json, debate.json의 `_comment`에서 참조)
- `sejong-1443-1444.md`는 정윤님 초기 버전이고, `sejong-sources.md`가 유나님 PR에서 추가된 확장·정리 버전
- README, STRUCTURE, RESEARCH_POLICY 모두 `sejong-sources.md`만 링크
- `sejong-1443-1444.md`는 `폴더구조.md`와 `agents/sejong.md`에서만 참조

---

### 1-3. `agents/sejong.md` ↔ `content/characters/sejong/*.json`

| 항목 | agents/sejong.md | knowledge.json + debate.json + profile.json |
|---|---|---|
| 사료 조각 | 있음 (S-01~S-07, JSON 스니펫) | 있음 (sejong-001~008, 실행용) |
| 설득 스키마 | 있음 (JSON 스니펫) | debate.json에 실제 데이터 |
| 쟁점 대응표 | 있음 (6조, JSON 스니펫) | debate.json에 5개 issue |
| 시대착오 트리거 | 있음 (JSON 스니펫) | judge.js에 하드코딩 |
| 판정 프롬프트 | 있음 (스켈레톤) | judge.js의 buildSystemPrompt |

**판정: 의도적 분리 (설계문서 vs 실행데이터), 하지만 내용이 드리프트**

- agents/sejong.md의 사료 ID는 `S-01`~`S-07` (7개)
- knowledge.json은 `sejong-001`~`sejong-008` (8개, 형옥 조각 추가)
- **현재 코드는 agents/sejong.md를 전혀 import하지 않음** → 순수 문서용

---

## 2. 고아 파일 (코드에서 import되지 않고, 문서에서도 주요 링크 없음)

| 파일 | import | 문서 링크 | 판정 |
|---|---|---|---|
| `content/characters/sejong/scenario.json` | ❌ 어떤 코드에서도 미참조 | README(간접 언급), STRUCTURE.md(파일 4종 설명) | ⚠️ **고아** — 코드가 scenario 데이터를 사용하지 않음 |
| `config/memes.json` | ❌ 어떤 코드에서도 미참조 | 기능명세서, 하네스-엔지니어링, 폴더구조, agents/sejong.md에서 참조 | ⚠️ **코드 고아** — 문서에만 참조, 실제 톤 전환은 app.js에 하드코딩 |
| `docs/research/sejong-1443-1444.md` | – | 폴더구조.md, agents/sejong.md | ⚠️ **사실상 고아** — sejong-sources.md에 흡수됨 |
| `.claude/launch.json` | – | – | ⚠️ Claude Code 도구 설정 — 현재 팀 도구 의존 |
| `.vscode/settings.json` | – | – | 2바이트(`{}`) — 빈 파일 |

---

## 3. 파일 분류 (실행 / 문서 / 미사용)

### 🟢 실행에 필요 (삭제·이동 시 게임 깨짐)

| 파일 | 역할 |
|---|---|
| `web/index.html` | 게임 진입점 |
| `web/src/app.js` | 게임 루프 |
| `web/src/style.css` | UI 스타일 |
| `server/ai/judge.js` | AI 판정기 |
| `server/engine/applyGrade.js` | 게이지·승패 엔진 |
| `server/rag/retrieve.js` | 사료 검색 |
| `config/difficulty.json` | 게이지 상수·모드·등급 |
| `content/characters/sejong/profile.json` | 세종 프로필 |
| `content/characters/sejong/knowledge.json` | 사료 8조각 (RAG) |
| `content/characters/sejong/debate.json` | 쟁점 5개 |
| `package.json` | 의존성·스크립트 |
| `package-lock.json` | 의존성 잠금 |
| `vite.config.js` | 빌드·서버 설정 |

### 🔵 문서·테스트 전용 (삭제해도 게임 실행에 무관)

| 파일 | 역할 |
|---|---|
| `README.md` | 프로젝트 소개 |
| `agents/sejong.md` | 세종 에이전트 설계문서 |
| `docs/VISION.md` | 확장 비전 |
| `docs/기획안.md` | 기획안 |
| `docs/기능명세서.md` | 기능 명세 |
| `docs/하네스-엔지니어링.md` | AI 하네스 설계서 |
| `docs/STRUCTURE.md` | 폴더·문서 안내 |
| `docs/폴더구조.md` | 폴더 구조 상세 |
| `docs/RESEARCH_POLICY.md` | 사료 정책 |
| `docs/research/sejong-sources.md` | 세종 사료 원본 (상세) |
| `docs/research/sejong-1443-1444.md` | 세종 사료 원본 (초기) |
| `docs/meeting-2026-08-03.md` | 회의 결정사항 |
| `test/smoke.mjs` | 오프라인 테스트 |
| `.gitignore` | 버전관리 설정 |

### 🟡 미사용 (코드에서도 문서에서도 실질적 역할 없음)

| 파일 | 역할 |
|---|---|
| `content/characters/sejong/scenario.json` | 화면 흐름 데이터 — 코드 미참조 |
| `config/memes.json` | 밈 어투 세트 — 코드 미참조 |
| `.vscode/settings.json` | 빈 파일 (2바이트) |
| `.claude/launch.json` | Claude Code 실행 설정 |

---

## 4. 깨진·오래된 경로 링크

| 문서 | 문제 | 상세 |
|---|---|---|
| `docs/STRUCTURE.md` L5 | 🔴 **깨진 경로** | `client/` → 실제로는 `web/` |
| `docs/폴더구조.md` L5–38 | 🔴 **대거 구식** | `client/` 대신 `web/` 사용해야 함. `harness/`, `fallback/`, `screens/`, `components/`, `api/`, `public/assets/` 등 존재하지 않는 하위폴더 다수 |
| `docs/폴더구조.md` L20–21 | 🔴 **인물 교체 미반영** | `gladiator.md`, `hokusai.md` → 8/3 회의에서 반고흐·미야자키로 변경 결정됨 |
| `docs/하네스-엔지니어링.md` L4 | 🟡 **부정확 경로** | `server/harness/` → 실제로는 `server/ai/` + `server/engine/` + `server/rag/` |
| `docs/하네스-엔지니어링.md` L31 | 🟡 **부정확 경로** | `server/harness/handleTurn.js` → 존재하지 않음 |
| `docs/하네스-엔지니어링.md` L119 | 🟡 **부정확 경로** | `server/fallback/` → 존재하지 않음 (폴백은 judge.js 내장) |
| `docs/하네스-엔지니어링.md` L134 | 🟡 **부정확 경로** | `server/harness/model.js` → 존재하지 않음 |
| `docs/기능명세서.md` L8 | ✅ 정상 | `./기획안.md`, `./하네스-엔지니어링.md`, `./폴더구조.md` 모두 존재 |
| `docs/기획안.md` L107 | ✅ 정상 | `./기능명세서.md` 존재 |
| `docs/폴더구조.md` L69 | ✅ 정상 | `./기능명세서.md`, `./하네스-엔지니어링.md` 존재 |
| `docs/기획안.md` L67–68 | 🟡 **인물 교체 미반영** | 검투사·호쿠사이 → 반고흐·미야자키로 변경해야 함 |
| `docs/기능명세서.md` L30 | 🟡 **인물 교체 미반영** | 검투사·호쿠사이 언급 |

---

## 5. 파일별 조치 제안

### 범례
- ✅ 유지: 변경 불필요
- 🔀 병합: 대상 문서에 고유 내용을 옮기고 원본 삭제
- 📝 수정: 내용 갱신 필요
- 📦 이동: 위치 변경
- 🗑️ 삭제: 제거

### 실행 파일 (코드)

| 파일 | 조치 | 근거 | 코드 영향 |
|---|---|---|---|
| `web/index.html` | ✅ 유지 | 게임 진입점 | — |
| `web/src/app.js` | ✅ 유지 | 게임 루프 | — |
| `web/src/style.css` | ✅ 유지 | UI 스타일 | — |
| `server/ai/judge.js` | ✅ 유지 | 판정기 | — |
| `server/engine/applyGrade.js` | ✅ 유지 | 게임 엔진 | — |
| `server/rag/retrieve.js` | ✅ 유지 | 사료 검색 | — |
| `config/difficulty.json` | ✅ 유지 | 게이지 상수 | — |
| `content/characters/sejong/profile.json` | ✅ 유지 | 세종 프로필 | — |
| `content/characters/sejong/knowledge.json` | ✅ 유지 | 사료 데이터 | — |
| `content/characters/sejong/debate.json` | ✅ 유지 | 쟁점 데이터 | — |
| `package.json` | ✅ 유지 | 의존성 | — |
| `package-lock.json` | ✅ 유지 | 잠금 파일 | — |
| `vite.config.js` | ✅ 유지 | Vite 설정 | — |
| `test/smoke.mjs` | ✅ 유지 | 테스트 | — |
| `.gitignore` | ✅ 유지 | 버전관리 | — |

### 미사용 / 고아 파일

| 파일 | 조치 | 근거 | 코드 영향 |
|---|---|---|---|
| `content/characters/sejong/scenario.json` | ✅ 유지 (미래용) | 코드에서 미참조이지만, 인트로·결과 대사 데이터로 향후 app.js가 사용할 가능성 높음. 삭제보다 유지가 안전 | ❌ 없음 |
| `config/memes.json` | ✅ 유지 (미래용) | 밈 모드 확장 시 judge.js가 참조할 데이터. 문서 여러 곳에서 설계 명시됨. 삭제하면 설계 정합성이 깨짐 | ❌ 없음 |
| `.vscode/settings.json` | 🗑️ 삭제 | 빈 파일(2바이트 `{}`). 역할 없음 | ❌ 없음 |
| `.claude/launch.json` | ✅ 유지 | 유나님 개발 도구 설정. 삭제 시 유나님 환경에 영향 | ❌ 없음 |

### 중복 문서 정리

| 파일 | 조치 | 대상 | 근거 | 코드 영향 |
|---|---|---|---|---|
| `docs/STRUCTURE.md` | 🔀 병합 → `docs/폴더구조.md` | 문서 안내표 + 인물 4종 설명을 `폴더구조.md`에 추가 후, `STRUCTURE.md` 삭제 | STRUCTURE.md의 폴더 트리는 README.md와 완전 중복. 고유 내용(문서 안내표, 인물 4종)만 폴더구조.md에 옮기면 충분 | ❌ 없음 |
| `docs/research/sejong-1443-1444.md` | 🔀 병합 → `docs/research/sejong-sources.md` | 내용 95% 중복. sejong-sources.md가 상위호환. 병합 후 삭제 | knowledge.json, debate.json 모두 sejong-sources.md를 참조. agents/sejong.md의 참조만 갱신하면 됨 | ❌ 없음 |

### 오래된 문서 갱신

| 파일 | 조치 | 갱신 내용 | 코드 영향 |
|---|---|---|---|
| `docs/폴더구조.md` | 📝 수정 | ① `client/` → `web/` ② `harness/`, `fallback/`, `screens/` 등 미존재 경로 정리 ③ 인물: 검투사·호쿠사이 → 반고흐·미야자키 ④ 상태(🔜)를 현재 상태(✅)로 갱신 ⑤ 실제 폴더 구조(server/ai, server/engine, server/rag, test/) 반영 | ❌ 없음 |
| `docs/STRUCTURE.md` | ↑ 병합 대상이므로 개별 수정 불필요 | — | ❌ 없음 |
| `docs/하네스-엔지니어링.md` | 📝 수정 | ① `server/harness/` → `server/ai/` + `server/engine/` + `server/rag/` ② `handleTurn.js`, `model.js` → 실제 파일명(judge.js, applyGrade.js, retrieve.js) ③ `server/fallback/` → judge.js 내부 오프라인 폴백으로 변경 명시 | ❌ 없음 |
| `docs/기획안.md` | 📝 수정 | ① 검투사·호쿠사이 → 반고흐·미야자키 교체 (L21, L67, L68, L71, L101) ② "인물 3명" 표기 갱신 | ❌ 없음 |
| `docs/기능명세서.md` | 📝 수정 | ① L30: 검투사·호쿠사이 → 반고흐·미야자키 ② 시스템 구성도의 `fallback` 경로 갱신 | ❌ 없음 |
| `agents/sejong.md` | 📝 수정 | ① L6: `sejong-1443-1444.md` → `sejong-sources.md` 참조 갱신 ② 사료 ID `S-01`~`S-07` → `sejong-001`~`sejong-008` 동기화 검토 (또는 별도 ID 체계 유지 명시) | ❌ 없음 |
| `docs/meeting-2026-08-03.md` L81–85 | 📝 수정 | 실행 TODO 5개 중 일부 이미 반영됨(인물 교체 = README/config에 반영). 체크박스 갱신 | ❌ 없음 |
| README.md L141 | 📝 수정 | STRUCTURE.md를 병합·삭제한다면, 이 링크를 `폴더구조.md`로 변경 | ❌ 없음 |

### 그 외

| 파일 | 조치 | 근거 | 코드 영향 |
|---|---|---|---|
| `README.md` | ✅ 유지 | 최신 상태. 폴더 구조·실행 방법·팀 역할 모두 갱신됨 | — |
| `docs/VISION.md` | ✅ 유지 | 고유 문서. 중복 없음. 최신 인물(반고흐·미야자키) 반영됨 | — |
| `docs/RESEARCH_POLICY.md` | ✅ 유지 | 고유 문서. 중복 없음 | — |
| `docs/meeting-2026-08-03.md` | ✅ 유지 | 회의 기록은 이력용으로 보관 | — |
| `docs/research/sejong-sources.md` | ✅ 유지 | 메인 사료 문서. knowledge.json/debate.json에서 참조 | — |

---

## 6. 작업 우선순위 제안

> [!TIP]
> 모든 변경은 문서 전용이며, 게임 실행 코드에 일절 영향을 주지 않습니다.

### P0 — 즉시 (혼동 방지)
1. `docs/research/sejong-1443-1444.md` → `sejong-sources.md`에 병합 후 삭제
2. `docs/STRUCTURE.md` → `docs/폴더구조.md`에 병합 후 삭제
3. 병합 후 README.md의 문서 링크 갱신

### P1 — 빠른 시일 (오래된 정보 수정)
4. `docs/폴더구조.md` 전면 갱신 (구 경로 → 현재 구조)
5. `docs/기획안.md`, `docs/기능명세서.md`에서 검투사·호쿠사이 → 반고흐·미야자키 교체
6. `docs/하네스-엔지니어링.md`의 경로 갱신 (harness/ → ai/+engine/+rag/)
7. `agents/sejong.md`의 참조 경로와 사료 ID 동기화

### P2 — 여유 있을 때
8. `.vscode/settings.json` 삭제 (빈 파일)
9. `docs/meeting-2026-08-03.md`의 TODO 체크박스 갱신

---

## 7. 요약 통계

| 분류 | 파일 수 |
|---|---|
| ✅ 유지 (변경 없음) | 21 |
| 📝 수정 (내용 갱신) | 6 |
| 🔀 병합 후 삭제 | 2 |
| 🗑️ 삭제 | 1 |
| **합계** | 30 |

> [!IMPORTANT]
> 병합·삭제 대상 3개 파일 모두 **코드 실행에 영향 없음**을 확인했습니다.
> 순수 문서 정리이며, `npm run dev` / `npm test`에 일체 영향이 없습니다.
