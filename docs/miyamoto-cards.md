# 미야모토(번외 v2) — 논거 출처·검증

> 상태: **번외 · 데이터 뼈대** (역설득 엔진 미구현)
> 원 제안: `docs/research/be-miyamoto-proposal.md` (배정윤, v2)
> 데이터: `content/characters/miyamoto/cards.json` (v2 `arguments` 구조)
> 구조: 세종과 같은 "자유서술 → AI 판정" 엔진, **방향만 반대**(AI가 설득/유혹 → 플레이어가 자유서술로 반박).

## ⚠️ 반드시 지킬 원칙 (생존 인물)
1. **지어낸 대사 금지.** `targetPhilosophy`는 아래 출처로 뒷받침되는 설계 철학의 **패러프레이즈**(축자 인용 아님).
2. **부정적 희화화 금지.**
3. **실명·실발언 사용 여부는 NHN 규정 확인 필수** (사망·퍼블릭도메인 세종/반고흐보다 리스크 높음).
4. **오귀속 금지.** 다른 사람 철학을 미야모토 것으로 넣지 말 것 → 미끼(bait)로만.

## 출처 검증표 (1·2티어 — 위키/명언모음 사이트 제외)
| id | 획득 철학 | 상태 | 근거 |
|---|---|---|---|
| arg-01 | 재미 우선주의 | ✅ verified | **Eurogamer 인터뷰(2010-03-31)**: "I always try to create new experiences that are fun to play" / "a good idea … solve multiple problems at once" |
| arg-02 | 게임성 먼저 | ✅ verified | 미야모토 gameplay-first 스탠스: Zelda '게임 시스템 개발을 더 중시', "story is just another way to pull out enjoyment" — 스토리 해명 인터뷰(Nintendo Everything 정리) · Game Developer(구 Gamasutra) |
| arg-03 | 성취감의 설계 | ✅ verified | **GDC 2007 기조연설** 및 Game Developer 'Designer Spotlight': "a game needs a sense of accomplishment … satisfaction of completing something" |
| arg-04 | 출처를 의심하라 | ⚠️ trap_misattributed (일부러 가짜) | **Nintendo Life(2022)·GoNintendo·A Critical Hit** 추적: 실제 기원 Siobhan Beeman(Origin, GDC 1996), 이전 변형 Gamefan(1998, Jason Schreiber). 미야모토 귀속은 2002년경 확산 — **미야모토 발언 아님** |
| arg-05 | 모두의 재미 | ✅ verified(표현 대조 권장) | 미야모토/닌텐도 접근성 철학(직관적 조작·누구나 플레이, '5세부터 95세까지'). Game Developer 'Designer Spotlight' 등 |

### 출처 링크
- Eurogamer 인터뷰(2010-03-31): eurogamer.net
- 스토리 스탠스 해명: nintendoeverything.com
- Game Developer(구 Gamasutra) 'Designer Spotlight'·GDC 2007 커버리지: gamedeveloper.com
- "연기된 게임" 오귀속 추적: nintendolife.com(2022) · gonintendo.com · acriticalhit.com
- (1티어 심화용) Shmuplations 번역 미야모토 인터뷰(1989 Zelda, 1998 Game Hiryu): shmuplations.com

> 📝 arg-01·03은 원문 인용에 가깝고, arg-02·05는 여러 인터뷰에 걸친 철학이라 **패러프레이즈**. 화면에 직접 인용문을 띄운다면 위 원문과 최종 대조 권장.

## 남은 개발 판단 (스코프는 팀 상의 예정)
- **엔진**: `applyGrade`(채점) 재사용 가능. **새로 필요** = ① AI가 먼저 논거 던지는 턴 구조 ② 역방향 판정(반박이 `targetPhilosophy`에 부합 + 유혹 비동조인지) ③ 오프라인 폴백 역방향 로직.
- **판정 프롬프트**: 현재 논거의 `targetPhilosophy`를 기준으로 플레이어 반박 판정.
- **MVP 후보**: 1턴 방어 + 캐릭터 성격 대비 + 도감 재사용. (타이머·가짜 흑역사 엔딩·재설득 멀티턴은 스트레치 — 팀 상의)
- **라인업**: 미야자키 자리 → 미야모토 번외로 교체(빌드 반영 완료).
