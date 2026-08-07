// server/engine/miyamotoEngine.js
// 번외: 역설득 엔진. 기존 judge()/applyGrade()를 재사용하는 얇은 오케스트레이터.
// 흐름: AI가 arg.aiLine으로 먼저 유혹/함정 → 플레이어 자유서술 반박
//       → judge()로 등급 판정 → arg.onDefend/onComply로 게이지 반영.
// 판정 로직·LLM 호출은 judge.js를 그대로 씀(새로 짜지 않음).

import { judge } from "../ai/judge.js";

// ── arg 하나 → judge()가 기대하는 character 객체로 변환하는 어댑터 ──
// 세종의 { profile, knowledge, debate, values } 스키마에 맞춘다.
// arg 하나가 곧 "미니 판(1쟁점)"이 된다.
function argToCharacter(cards, arg) {
  const { figure, personas } = cards;
  const persona = personas.find((p) => p.id === arg.speaker) || personas[0];

  return {
    profile: {
      displayName: figure.displayName,          // 판정 대사 화자는 미야모토(플레이어=미야모토)이나,
      speaker: persona.name,                     // 실제 유혹을 던진 건 하루/쿠로다 → 대사 톤 참고용
      systemPromptBase:
        `당신은 게임 디자이너 미야모토 시게루의 철학을 판정하는 심판이다. ` +
        `'${persona.name}'(${persona.role})가 다음과 같이 설득/유혹했다: "${arg.aiLine}". ` +
        `플레이어(미야모토의 자리)의 반박이 아래 '지켜야 할 철학'에 부합하면 방어 성공, ` +
        `유혹/미끼에 동조하면 방어 실패로 판정하라.`,
      values: buildValues(arg),
    },
    // 미야모토는 별도 사료 fragment DB가 없으므로 arg.sourceNote를 조각 1개로 노출
    knowledge: {
      fragments: [
        {
          id: arg.id + "-src",
          content: arg.sourceNote,
          source: arg.sourceStatus === "trap_misattributed" ? "오귀속(가짜)" : "확인된 출처",
          sourceUrl: null,
        },
      ],
    },
    // debate.issues: 이 arg 하나만 담는다
    debate: {
      issues: [
        {
          id: arg.id,
          opponentClaim: arg.aiLine,
          sourceRef: [arg.id + "-src"],
          playerEffect: { goodMove: arg.targetPhilosophy },
        },
      ],
    },
    values: buildValues(arg),
  };
}

// arg의 철학/함정을 judgeOffline이 읽는 values 축 구조로 변환
function buildValues(arg) {
  // 수기 키워드가 있으면 우선, 없으면 자동 추출(하위호환)
  const defendKw = arg.defendKeywords || extractKeywords(arg.targetPhilosophy);
  const complyKw = arg.complyKeywords ||
    (arg.kind === "bait"
      ? ["맞는 말", "명언대로", "그 말대로", "미루", "무한정", "따르"]
      : extractKeywords(arg.aiLine));

  const values = {
    통하는_가치: [
      {
        axis: arg.id + "-defend",
        keywords: defendKw,
        line: `(방어 성공) ${arg.targetPhilosophy}`,
        근거_사료: [arg.id + "-src"],
      },
    ],
    역효과: [],
    안_통하는_것: [],
  };

  // 동조(유혹/미끼 수용)는 kind와 무관하게 complyKw로 통일
  const complyAxis = {
    axis: arg.id + "-comply",
    keywords: complyKw,
    line: arg.kind === "bait"
      ? `(동조) 가짜 명언에 넘어갔다.`
      : `(동조) 유혹에 넘어갔다.`,
  };
  // bait는 아첨/맹종 성격이 강하니 역효과, 나머지는 안_통하는_것
  (arg.kind === "bait" ? values.역효과 : values.안_통하는_것).push(complyAxis);

  return values;
}

// 아주 단순한 키워드 추출(명사 위주 2글자+). 실제로는 논거별 수기 튜닝 권장.
function extractKeywords(text) {
  return (text || "")
    .replace(/[^가-힣a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 12);
}

// ── 턴 오프너: AI(하루/쿠로다)가 먼저 던지는 대사 ──
export function openTurn(cards, index) {
  const arg = cards.arguments[index];
  if (!arg) return null;
  const persona = cards.personas.find((p) => p.id === arg.speaker);
  return {
    index,
    argId: arg.id,
    speaker: persona ? persona.name : arg.speaker,
    speakerRole: persona ? persona.role : "",
    aiLine: arg.aiLine,
    kind: arg.kind,
  };
}

// ── 플레이어 반박 판정 + 게이지 반영 ──
// gauge 계산은 접근 A: 방어 계열이면 += onDefend, 동조 계열이면 += onComply.
export async function judgeRebuttal(cards, index, playerInput, gauge, opts = {}) {
  const arg = cards.arguments[index];
  if (!arg) throw new Error("no such arg: " + index);

  const character = argToCharacter(cards, arg);
  const verdict = await judge(playerInput, character, opts); // ← judge.js 그대로 재사용

  const defended = ["탁월", "정합", "부분"].includes(verdict.grade);
  const delta = defended ? arg.onDefend : arg.onComply;
  const nextGauge = Math.max(0, Math.min(100, gauge + delta));

  return {
    verdict,
    defended,
    delta,
    gauge: nextGauge,
    cardWon: defended && verdict.grade !== "부분" ? arg.card : null, // 부분은 카드 미획득(튜닝 가능)
    win: nextGauge >= (cards.winCondition?.goalGauge || 100),
  };
}
