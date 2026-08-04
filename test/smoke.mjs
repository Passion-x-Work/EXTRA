// test/smoke.mjs — 가치 축 판정 엔진 검증(오프라인, 키 불필요).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyGrade, initState, resultBand } from "../server/engine/applyGrade.js";
import { judgeOffline } from "../server/ai/judge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf-8"));
const cfg = readJson("config/difficulty.json");
const character = {
  profile: readJson("content/characters/sejong/profile.json"),
  knowledge: readJson("content/characters/sejong/knowledge.json"),
  debate: readJson("content/characters/sejong/debate.json"),
};

let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log(`${c ? "✅" : "❌"} ${m}`); };

// 커버 축을 유지하며 한 판(설득 깊이 반영)
function play(inputs) {
  let state = initState(cfg, "sejong");
  state.coveredAxes = new Set();
  for (const input of inputs) {
    const v = judgeOffline(input, character, { mode: "mixed", cfg, covered: [...state.coveredAxes] });
    state = applyGrade(state, v, cfg, "sejong");
    if (v.matchedIssue && (v.grade === "탁월" || v.grade === "정합")) state.coveredAxes.add(v.matchedIssue);
    console.log(`  · "${input.slice(0, 20)}" → ${v.grade} [${v.matchedIssue || "-"}] 게이지 ${state.gauge}`);
    if (state.status !== "CONTINUE") break;
  }
  return state;
}

console.log("\n[1] 서로 다른 가치 축 3개로 설득 → 승리");
const win = play([
  "글을 모르는 백성이 억울한 일을 당해도 하소연할 문서조차 쓰지 못합니다",
  "설총의 이두처럼 백성이 쉬운 글로 배움의 기회를 얻습니다",
  "억울한 옥살이를 줄이려면 백성이 글로 제 뜻을 펴야 합니다",
]);
ok(win.status === "WIN", `승리 도달 (게이지 ${win.gauge}, 등급 ${resultBand(win.turn, cfg)})`);
ok(win.coveredAxes.size >= 2, `여러 가치 축 커버 (${win.coveredAxes.size}개)`);

console.log("\n[2] 같은 축을 반복하면 잘 안 통함(부분)");
{
  let s = initState(cfg, "sejong"); s.coveredAxes = new Set();
  const a = judgeOffline("백성의 억울함을 하소연하게 해야 합니다", character, { mode: "mixed", cfg, covered: [] });
  const b = judgeOffline("백성이 억울함을 하소연해야 합니다", character, { mode: "mixed", cfg, covered: [a.matchedIssue] });
  ok(a.matchedIssue && b.grade === "부분", `첫 축=${a.grade}, 반복=${b.grade}`);
}

console.log("\n[3] 시대착오 → 불합치");
ok(judgeOffline("표현의 자유가 민주주의의 기본입니다", character, { cfg }).anachronism, "시대착오 감지");

console.log("\n[4] 아첨 → 역효과");
ok(judgeOffline("전하는 최고이십니다 위대하신 성군", character, { cfg }).grade === "역효과", "아첨 → 역효과");

console.log("\n[5] 결정론: 같은 입력·같은 커버 → 같은 판정");
const x = judgeOffline("백성의 실용적 이익을 위한 것입니다", character, { cfg, covered: [] });
const y = judgeOffline("백성의 실용적 이익을 위한 것입니다", character, { cfg, covered: [] });
ok(x.grade === y.grade && x.matchedIssue === y.matchedIssue, `동일 판정 (${x.grade})`);

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
