# CHANGELOG

## [Unreleased] — 포스트-해커톤 개발
> 해커톤 이후의 모든 변경은 여기에 기록합니다. 당분간 한국 인물(세종) 집중.

- docs: 해커톤 출품 경계 태그(hackathon-submission) 및 CHANGELOG 신설
- docs: 세종 훈민정음 1·2티어 사료 리서치 문서 추가 (docs/research/sejong-hunminjeongeum-sources-tiered.md)
- docs: 승리 클립 전 인물 확장 제안서 정리 (docs/proposal-n-review/victory-clip-all-characters-proposal.md, 미구현)

## [hackathon-submission] — 2026-08-13 (4191cb7)
NHN Game x AI Hackathon 2026 최종 출품 상태. 팀 덕업일치(Passion x Work).

- 정방향 설득 모드: 세종(완성형), 반 고흐(맛보기) — 신념 게이지 40→100
- 역방향 모드(미야모토): 가상 동료 하루·쿠로다의 유혹·가짜 명언 반박 (멀티턴)
- 사료 기반 AI 판정(GPT 기본, Claude 대체, 오프라인 휴리스틱 폴백)
- 도감·사료 카드·개인 논거 카드, 힌트 예산 시스템, 앵무새 답변 페널티
- 전체 화면 고지도 UI(무한 스크롤, 위경도 핀), 난이도별 승리 클립, 결과 공유 카드
- Render 단일 서버 배포(판정 API + dist 서빙)
- 호쿠사이: 데이터 보존, 지도에서 숨김
