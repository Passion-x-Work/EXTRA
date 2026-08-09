// test/miyamoto-smoke.mjs
// 번외 역설득 엔진 스모크 테스트. 키 없이 offline provider로 즉시 실행.
//   node test/miyamoto-smoke.mjs
// 검증 항목:
//   1. 5개 arg 전부 openTurn()이 aiLine/speaker를 정상 반환하는가
//   2. 방어형 반박 → defended=true, 게이지 상승(+onDefend)
//   3. 동조형 반박 → defended=false, 게이지 하락(+onComply)
//   4. 게이지가 0~100 클램프되는가
//   5. arg-04(bait) 출처 의심 반박이 방어로 잡히는가 (offline 한계 확인용)

import { readFileSync } from "node:fs";
import "../server/loadEnv.mjs";   // ← .env 로딩 (CLAUDE_API_KEY 인식용) 추가
import { openTurn, judgeRebuttal } from "../server/engine/miyamotoEngine.js";

const cards = JSON.parse(
  readFileSync(
    new URL("../content/characters/miyamoto/cards.json", import.meta.url)
  )
);

const OPTS = { provider: "claude", mode: "reverse-persuasion", tone: "classic" };

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log(`  ${cond ? "✅" : "❌"} ${msg}`); };

// ── 1. 턴 오프너 ──────────────────────────────────────────────
console.log("\n[1] openTurn — AI가 먼저 던지는 대사");
cards.arguments.forEach((arg, i) => {
  const t = openTurn(cards, i);
  ok(t && t.aiLine === arg.aiLine, `${arg.id} (${t?.speaker}): "${(t?.aiLine || "").slice(0, 28)}…"`);
});

// ── 2. 방어형 반박 (targetPhilosophy 핵심어를 담아 반박) ──────────
console.log("\n[2] 방어 성공 → 게이지 상승");
{
  // arg-01: 재미·즐거움 우선으로 반박
  const r = await judgeRebuttal(
    cards, 0,
    "평단보다 플레이어가 즐거운 게 먼저다. 항상 새롭고 재미있는 경험을 만드는 게 핵심이지.",
    0, OPTS
  );
  ok(r.delta === cards.arguments[0].onDefend || r.defended,
     `arg-01 defended=${r.defended}, delta=${r.delta}, gauge=${r.gauge}, grade=${r.verdict.grade}`);
}

// ── 3. 동조형 반박 (유혹 문구를 그대로 수용) ────────────────────
// 멀티턴 규칙: 중간 공방은 onComply의 1/3(소폭), 최종 공방(isFinal)에만 본 점수.
console.log("\n[3] 동조 → 게이지 하락 (중간 1/3 · 최종 본점수)");
{
  const INPUT = "맞아요, 멋진 스토리부터 완성하고 거기 맞춰 시스템을 짜는 게 좋겠네요.";
  const onComply = cards.arguments[1].onComply;

  // 중간 공방: 소폭(÷3)만 하락
  const mid = await judgeRebuttal(cards, 1, INPUT, 50, OPTS);
  ok(!mid.defended && mid.delta === Math.round(onComply / 3),
     `arg-02 중간 공방: defended=${mid.defended}, delta=${mid.delta} (기대 ${Math.round(onComply / 3)}), grade=${mid.verdict.grade}`);

  // 최종 공방(isFinal): 본 점수 확정
  const fin = await judgeRebuttal(cards, 1, INPUT, 50, { ...OPTS, isFinal: true });
  ok(!fin.defended && fin.delta === onComply,
     `arg-02 최종 공방: defended=${fin.defended}, delta=${fin.delta} (기대 ${onComply}), gauge=${fin.gauge}`);
}

// ── 4. 게이지 클램프 (0 하한 / 100 상한) ────────────────────────
console.log("\n[4] 게이지 0~100 클램프");
{
  const low  = await judgeRebuttal(cards, 1, "네 그 말이 다 맞아요, 그대로 하죠.", 5, OPTS);
  ok(low.gauge >= 0, `하한: gauge=${low.gauge} (0 미만 아님)`);
  const high = await judgeRebuttal(
    cards, 0,
    "플레이어가 즐거운 새 경험이 항상 먼저다.",
    95, OPTS
  );
  ok(high.gauge <= 100, `상한: gauge=${high.gauge} (100 초과 아님)`);
}

// ── 5. arg-04 bait ──
console.log("\n[5] arg-04 가짜 명언 — 출처 의심 반박");
{
  const OFFLINE = { ...OPTS, provider: "offline" };  // ← 이 케이스만 강제 offline

  // (2) 개선 검증: offline에서도 출처 의심 반박이 방어로 잡혀야 함
  const defOff = await judgeRebuttal(
    cards, 3,
    "그건 제가 한 말이 아닌데요. 출처가 의심스럽습니다. 유명하다고 다 사실은 아니죠.",
    50, OFFLINE
  );
  ok(defOff.defended,
     `[offline] 출처 의심 방어: defended=${defOff.defended}, grade=${defOff.verdict.grade}, delta=${defOff.delta} (defendKeywords 적용 후 방어로 잡혀야 정상)`);

  // 동조 케이스도 offline 고정
  const comOff = await judgeRebuttal(
    cards, 3,
    "역시 미야모토님 명언이네요. 그 말대로 마감 무시하고 무한정 미루겠습니다.",
    50, OFFLINE
  );
  ok(!comOff.defended,
     `[offline] 동조: defended=${comOff.defended}, grade=${comOff.verdict.grade} (동조로 잡혀야 정상)`);
}

console.log(`\n결과: ${pass} pass / ${fail} fail\n`);
process.exit(fail ? 1 : 0);
