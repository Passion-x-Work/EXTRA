# EXTRA — 폴더 및 문서 안내

## 폴더 구조
    EXTRA/
    ├─ client/     # 프론트엔드 (UI, 화면 흐름 showScene)
    ├─ server/     # 백엔드
    │   ├─ engine/ # 게임 규칙 판정 (신념게이지, 설득 성공/실패)
    │   ├─ rag/    # 사료 검색 (RAG)
    │   └─ ai/     # Claude API 호출·프롬프트 구성
    ├─ content/
    │   └─ characters/
    │       └─ sejong/   # 인물별 데이터 (폴더 복사로 인물 추가)
    ├─ docs/       # 프로젝트 문서
    │   └─ research/     # 인물별 사료 근거 원본
    ├─ .gitignore
    ├─ .env        # API 키 (git에 올리지 않음)
    └─ README.md

## 문서 안내 (docs/)
| 문서 | 위치 | 내용 |
|------|------|------|
| 프로젝트 개요 | README.md | 게임 소개·등장 인물·게임 흐름·기술 구성 (제일 먼저 볼 것) |
| 확장 비전 | docs/VISION.md | 교육 축 + IP 콜라보 축, 설계 의도 |
| 폴더·문서 안내 | docs/STRUCTURE.md | 이 문서. 폴더 구조와 문서 지도 |
| 사료 정책 | docs/RESEARCH_POLICY.md | 출처 티어 기준, 데이터 원칙, 갱신 정책 |
| 세종 사료 원본 | docs/research/sejong-sources.md | 세종 리서치 원본 (타임라인·쟁점표·사료 조각·성격 근거) |

## 인물 폴더 안의 파일 4종 (content/characters/<인물>/)
- **profile.json** — 인물의 성격·말투·신념게이지 초기값
- **knowledge.json** — RAG 검색용 검증된 사료 조각 (출처 포함)
- **debate.json** — 설득 쟁점 표 (쟁점 5개 + 3모드: strict / reward / mixed)
- **scenario.json** — 화면 흐름 (인트로 · 오프닝 · 승리/실패 결과)

## 인물 추가 방법
`content/characters/` 안에 인물 폴더를 복사하고, 위 4개 JSON의 내용만 교체한다.
사료 근거는 docs/research/ 아래에 인물별 문서로 추가한다.
코드 수정 없이 인물이 확장된다.
