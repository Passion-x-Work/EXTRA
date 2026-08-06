# 미야모토(번외) — 논거 카드 출처·검증 상태

> 상태: **번외 · 기획/데이터 뼈대** (역설득 엔진 미구현)
> 원 제안: `docs/research/be-miyamoto-proposal.md` (배정윤)
> 데이터: `content/characters/miyamoto/cards.json`

## ⚠️ 반드시 지킬 원칙 (생존 인물)
1. **지어낸 대사 금지.** 카드의 `principle`은 '검증된 verbatim 인용'이 아니라 널리 알려진 설계 철학의 **패러프레이즈**다.
2. **부정적 희화화 금지.**
3. **실명·실발언 사용 여부는 NHN 해커톤 규정 확인 필수.** (사망·퍼블릭도메인 인물인 세종·반고흐·호쿠사이보다 리스크 높음)
4. **오귀속 금지.** 다른 사람의 철학을 미야모토 것으로 넣지 말 것 → 함정 카드로만.

## 카드 검증 상태
| id | 진위 | source_status | 확정 전 해야 할 일 |
|---|---|---|---|
| mc-real-01 재미 우선 | real | **needs_check** | 미야모토 인터뷰 1·2티어 원문·맥락 확정 |
| mc-real-02 게임성 먼저 | real | **needs_check** | 원문 대조 |
| mc-real-03 일석다조 | real | **needs_check** | 'solves multiple problems' 원 출처 확정 |
| mc-real-04 성취·발견 | real | **needs_check** | 원문 대조 |
| mc-trap-01 "연기된 게임…" | fake | documented_misattribution | 널리 미야모토로 인용되나 본인 부인/출처 불명 → **대표 함정**으로 유지 |
| mc-trap-02 수평적 사고 | fake | documented_misattribution | **요코이 군페이**의 철학 — 미야모토 것 아님(오귀속 함정) |
| mc-trap-03 최신 그래픽 성패 | fake | fabricated_for_trap | 철학과 배치되는 오답(함정용) |
| mc-trap-04 어려울수록 좋다 | fake | fabricated_for_trap | 접근성·성취감과 배치(함정용) |

## 남은 개발 판단 (유나)
- **엔진**: 기존 `applyGrade`(자유서술→AI판정→게이지)와 **다른 흐름**. 카드 제시/선택 UI + 채점 로직 추가 필요 → 드롭인 아님.
- **AI 유지**: 순수 '미리 정의된 카드 고르기'면 우리 논지("AI 실시간 판정")가 약해짐. → **플레이어가 진짜/가짜 고른 '이유'를 AI가 판정**하는 방향이면 AI가 중심에 남음.
- **라인업**: 미야자키 콜라보 슬롯을 미야모토 번외로 교체함(2026-08-06 결정).
