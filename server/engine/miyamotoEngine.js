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
// bridge: 논거 전 상황 내레이션. arg.bridge가 있으면 그대로, 없고 화자가 바뀌면 범용 폴백.
const GENERIC_BRIDGE = "그때, 옆에 있던 {name}이(가) 말을 이어받는다.";
export function openTurn(cards, index) {
  const arg = cards.arguments[index];
  if (!arg) return null;
  const persona = cards.personas.find((p) => p.id === arg.speaker);
  const prev = index > 0 ? cards.arguments[index - 1] : null;
  const name = persona ? persona.name : arg.speaker;
  let bridge = arg.bridge || null;
  if (!bridge && prev && prev.speaker !== arg.speaker)
    bridge = GENERIC_BRIDGE.replace("{name}", name); // 화자 전환인데 수기 브릿지 없음 → 폴백
  return {
    index,
    argId: arg.id,
    speaker: name,
    speakerRole: persona ? persona.role : "",
    bridge,
    aiLine: arg.aiLine,
    kind: arg.kind,
  };
}

// 등급 → 멀티턴 결과(strong/weak/comply) + 표정 힌트
function outcomeFromGrade(grade) {
  if (grade === "탁월" || grade === "정합") return { outcome: "strong", mood: "shaken" };
  if (grade === "부분") return { outcome: "weak", mood: "pressing" };
  return { outcome: "comply", mood: "smug" }; // 불합치·역효과
}

// 논거[index]의 재설득 대사(rebuttal회차: 1,2…). 없으면 범용 폴백.
// outcome에 따라 대사 풀이 달라진다:
//   weak(약한 방어) → retries: 같은 각도를 더 파고드는 재설득
//   comply(동조)    → retriesComply: "정말 넘어온 거냐"고 확인하며 되돌릴 기회를 주는 대사
//   (동조했는데 계속 설득하는 대사가 나오면 흐름이 안 이어지므로 반드시 분리)
const GENERIC_RETRY = [
  "그건 그렇다 치고 — 그럼 이건 어때요?",
  "흠, 그래도 현실은 좀 다르지 않나요?",
  "말은 알겠는데, 그걸론 아직 부족한데요?",
];
const GENERIC_RETRY_COMPLY = [
  "오? 웬일로 순순히 넘어오시네요… 정말 그렇게 가도 후회 없으시겠어요? 마지막으로 다시 묻죠.",
  "어라, 동의하시는 거예요? …진심이신지 한 번만 더 확인할게요.",
];
export function getRetryLine(cards, index, attempt, outcome = "weak") {
  const arg = cards.arguments[index];
  const persona = cards.personas.find((p) => p.id === arg.speaker);
  const speaker = persona ? persona.name : arg.speaker;
  const pool = outcome === "comply"
    ? (arg.retriesComply || GENERIC_RETRY_COMPLY)
    : (arg.retries || GENERIC_RETRY);
  const line = pool[attempt] || pool[pool.length - 1] || GENERIC_RETRY[attempt % GENERIC_RETRY.length];
  return { speaker, line };
}

// ── 플레이어 반박 판정 + 게이지 반영 (멀티턴) ──
// opts.isFinal : 이 반박이 논거의 마지막 공방인가(카운트 소진 or strong).
//   중간 공방은 게이지 소폭, 최종 공방에만 본 점수(onDefend/onComply) 1회 적용.
export async function judgeRebuttal(cards, index, playerInput, gauge, opts = {}) {
  const arg = cards.arguments[index];
  if (!arg) throw new Error("no such arg: " + index);

  const character = argToCharacter(cards, arg);
  const verdict = await judge(playerInput, character, opts);

  const { outcome, mood } = outcomeFromGrade(verdict.grade);
  const defended = outcome === "strong" || outcome === "weak";

  // strong이거나, 호출부가 최종 공방이라고 알리면 본 점수. 아니면 중간 소폭(±소량).
  const isFinal = outcome === "strong" || opts.isFinal;
  let delta;
  if (isFinal) delta = defended ? arg.onDefend : arg.onComply;
  else delta = outcome === "weak" ? Math.round((arg.onDefend || 0) / 3) : Math.round((arg.onComply || 0) / 3);

  const nextGauge = Math.max(0, Math.min(100, gauge + delta));

  return {
    verdict,
    outcome,          // "strong" | "weak" | "comply"
    mood,             // 표정 힌트: "shaken" | "pressing" | "smug"
    defended,
    delta,
    isFinal,
    gauge: nextGauge,
    cardWon: outcome === "strong" && verdict.grade !== "부분" ? arg.card : null,
    win: nextGauge >= (cards.winCondition?.goalGauge || 100),
  };
}
