# EXTRA — 폴더 및 문서 안내

> 실제 저장소 기준(2026-08 최신). 인물은 세종 · 반고흐 · **호쿠사이** 3종(+ 미야자키 콜라보 비전).

## 폴더 구조
    EXTRA/
    ├─ web/            # 프론트엔드 (Vite 정적)
    │   ├─ index.html      # 화면: 지도 → 대화 → 결과 → 사료 도감
    │   ├─ src/app.js      # 화면 흐름·게이지·힌트·연출(비주얼 노벨)
    │   ├─ src/style.css   # 인물별 씬 테마(data-theme) · 반응형
    │   └─ Assets/         # 인물 이미지(배경·Phase별 표정) — 담당: 배정윤
    ├─ server/         # 백엔드 (로컬 프록시 · 판정 로직)
    │   ├─ ai/judge.js         # 판정: 등급+대사 (offline/gpt/claude)
    │   ├─ engine/applyGrade.js# 게임 규칙(게이지·턴·승패) — 결정론
    │   ├─ rag/retrieve.js     # 사료 검색(쟁점–sourceRef 직접 매핑)
    │   ├─ index.mjs           # 로컬 개발 프록시 서버
    │   └─ loadEnv.mjs         # .env 로더(시스템 env 오버라이드)
    ├─ api/judge.js    # Vercel 서버리스 판정 함수(배포용)
    ├─ config/
    │   └─ difficulty.json # 난이도·게이지·등급점수·힌트(숫자는 여기)
    ├─ content/
    │   └─ characters/     # 인물별 데이터(폴더 추가 = 인물 추가)
    │       ├─ sejong/     ├─ vangogh/     └─ hokusai/
    ├─ test/smoke.mjs  # 판정·설정 스모크 테스트
    ├─ docs/           # 프로젝트 문서 (+ research/ 사료 근거)
    ├─ vercel.json · vite.config.js · package.json
    ├─ .env            # API 키 (git 제외) · .env.example (빈 템플릿)
    └─ README.md

## 문서 안내 (docs/)
| 문서 | 내용 |
|------|------|
| README.md | 프로젝트 개요 (제일 먼저) |
| docs/GAME_INTRO.md | 게임 소개서 — 등장 인물·플레이·특징 |
| docs/AI_TECH.md | AI 기술 문서 — 에이전트 설계·디렉팅 명세 코어 |
| docs/VISION.md | 확장 비전 — 교육 축 + IP 콜라보 축 |
| docs/STRUCTURE.md | 이 문서 — 폴더 구조·문서 지도 |
| docs/RESEARCH_POLICY.md | 사료 티어 기준·데이터 원칙 |
| docs/DEPLOY.md | Vercel 배포 가이드 (담당: 배정윤) |
| docs/ASSETS_GUIDE.md | 캐릭터 이미지 파일명·규격 규약 (담당: 배정윤) |
| docs/TEAM_ROLES.md | 팀원 역할 기술서 |
| docs/research/*-sources.md | 인물별 사료 근거 원본(세종·반고흐·호쿠사이) |

## 인물 폴더 안의 파일 4종 (content/characters/&lt;인물&gt;/)
- **profile.json** — 성격·말투·**설득 가치 축**(통하는_가치 / 안_통하는_것 / 역효과 / 시대착오) · 게이지 초기값
- **knowledge.json** — RAG용 검증된 사료 조각(출처·티어 포함)
- **debate.json** — 설득 쟁점 표(쟁점 + 3모드: strict / reward / mixed)
- **scenario.json** — 화면 흐름(인트로 · 오프닝(정통/밈) · 승리/실패)

## 인물 추가 방법
1. `content/characters/`에 인물 폴더 복사 → 위 4개 JSON 교체
2. `config/difficulty.json`의 `characters`·`hint_unlock.order`에 항목 추가
3. `docs/research/`에 사료 근거 문서 추가
4. `web/`에서 지도 유적 버튼(`data-char`) + 씬 테마 연결

판정 엔진은 `profile.json`의 가치 축을 범용으로 읽으므로 **인물 추가에 판정 코드 수정은 없다.**
