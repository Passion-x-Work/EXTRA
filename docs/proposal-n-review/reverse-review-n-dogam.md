# 역모드 "내 말 다시보기" + 미야모토 도감 연결 (스펙)

> **상태:** 제안 · 미착수 (역모드 멀티턴 `feature/reverse-multiturn` 이후 작업)
> **작성:** 배정윤 · 정리 2026-08-08
> **목적:** 역설득(미야모토) 플레이 후, 내가 방어한 철학과 그때 쓴 반박을
> 다시 보고 도감으로 수집·공유할 수 있게 한다. 정방향의 사료 도감/공유 카드와 대칭.

## 배경

현재 역모드(`rev`)는 판정 후 다음 논거로 넘어갈 뿐, **플레이어의 반박 기록이
남지 않는다.** 정방향은 사료 카드 도감(scr-dogam) + 결과 공유 카드가 있으나
역모드는 대응이 없다(`revShowResult`에서 `save-card` 숨김 처리 중).

## 작업 1. 역모드 반박 세션 기록 (기반)

- **무엇:** 한 판 동안의 공방을 배열로 누적한다.
- **자료구조(제안):** `rev.log = [{ argId, speaker, aiLine, myInput, outcome,
  grade, cardWon }, ...]`
  - `onReverseTurn`에서 판정 결과가 나올 때마다 push.
  - 재설득(retry)도 같은 argId로 여러 항목 쌓임 → 마지막 결과가 그 논거의 확정.
- **저장:** 판 종료(`revEnd`) 시 localStorage에 인물별로 저장.
  - 키 예: `extra_reverse_log_v1` → `{ miyamoto: [ ...세션 ... ] }`
  - 최신 세션만 유지할지, 여러 판 누적할지는 결정 필요(1차는 최신 1판 권장).

## 작업 2. 획득 철학 카드 + 내 반박 표시

- **무엇:** 방어 성공(strong)으로 얻은 **철학 카드**(`arg.card`)와, 그때
  플레이어가 실제로 쓴 반박(`myInput`)을 나란히 보여준다.
- **의도:** "이 철학을, 나는 이런 말로 지켜냈다"는 개인화된 기록.
  단순 카드 수집을 넘어 플레이어의 언어가 남는다.
- **도감 저장:** 기존 사료 도감(`extra_dogam_v1`)과 **별개 컬렉션**으로.
  - 철학 카드 id + 대표 반박 문장을 함께 저장.

## 작업 3. 미야모토 도감 화면 연결

- **무엇:** 획득한 철학 카드 컬렉션을 볼 화면.
- **구현 방향(택1, 결정 필요):**
  - (a) 기존 사료 도감 화면(scr-dogam)에 "철학 카드" 탭/섹션 추가.
  - (b) 역모드 전용 도감 화면 신설.
  - → 1차는 (a) 재사용 권장(화면 추가 부담↓). `renderDogam`에 분기.
- **표시 내용:** 철학 카드명(예: 「출처를 의심하라」) + 지켜낸 철학 요약
  (`arg.targetPhilosophy`) + 내 반박(myInput) + 화자.

## 작업 4. 공유 카드 역모드 대응

- **현황:** `buildShareCard`가 정방향 전용(`state`·`resultBand`·firstInputSaved
  의존). 역모드는 `state=null`이라 그대로 못 씀.
- **무엇:** 역모드용 공유 카드 분기 추가.
  - 상단: "철학을 지켰다 / 흔들렸다"(승패)
  - 본문: 획득 철학 카드 목록 + 대표 반박 1개(가장 인상적인 strong 반박)
  - 하단: 기존 브랜딩("EXTRA · 역사에 끼어든 단역") 유지
- **연결:** `revShowResult`에서 숨겼던 `save-card`를 역모드 버전으로 노출.

## 의존성 / 순서

1. **작업 1(기록)** 이 나머지 전부의 기반 → 먼저.
2. 작업 2·3(도감)은 세트.
3. 작업 4(공유 카드)는 작업 1 위에서 독립적으로 가능.

## 결정 필요 (claw/정윤 확인)

- [ ] 세션 저장: 최신 1판만 vs 여러 판 누적
- [ ] 도감 화면: 기존 scr-dogam 재사용(a) vs 전용 화면 신설(b)
- [ ] 대표 반박 선정 기준: 첫 strong vs 마지막 strong vs 게이지 상승폭 최대

## 참고 (현재 코드 기준)

- 역모드 상태: `web/src/app.js`의 `rev` 객체 / `onReverseTurn` / `revShowResult`
- 철학 카드 출처: `content/characters/miyamoto/cards.json`의 각 `arg.card`
- 기존 도감: `renderDogam`, localStorage `extra_dogam_v1`
- 기존 공유 카드: `buildShareCard` / `saveCard`
- ⚠️ **진행 중인 `feature/reverse-multiturn` 병합 이후 시작할 것**
  (rev 객체 구조가 그 작업에서 바뀜: `attempt`, `speaker`, `maxRebuttals` 등)

---