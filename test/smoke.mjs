// test/smoke.mjs — API 키 없이 오프라인 판정으로 세종 한 판을 돌려 엔진을 검증.
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
const ok = (cond, msg) => { (cond ? pass++ : fail++); console.log(`${cond ? "✅" : "❌"} ${msg}`); };

function play(inputs, mode = "mixed") {
  let state = initState(cfg, "sejong");
  for (const input of inputs) {
    const v = judgeOffline(input, character, { mode, cfg });
    state = applyGrade(state, v, cfg, "sejong");
    console.log(`  · "${input.slice(0, 24)}" → ${v.grade} (게이지 ${state.gauge}, ${state.status})`);
    if (state.status !== "CONTINUE") break;
  }
  return state;
}

console.log("\n[1] 정공법(실용·백성) 설득 → 승리 기대");
const win = play([
  "글을 모르는 백성이 억울한 일을 당해도 하소연할 문서조차 쓰지 못합니다",
  "설총의 이두처럼 이 문자도 백성을 편하게 하려는 것입니다",
  "억울한 옥살이를 줄이려면 백성이 글로 제 뜻을 펴야 합니다",
]);
ok(win.status === "WIN", `승리 도달 (게이지 ${win.gauge}, 등급 ${resultBand(win.turn, cfg)})`);

console.log("\n[2] 시대착오 → 게이지 정체");
const anach = judgeOffline("표현의 자유가 민주주의의 기본입니다", character, { mode: "mixed", cfg });
ok(anach.grade === "불합치" && anach.anachronism, "시대착오 감지 → 불합치");

console.log("\n[3] 아첨 → 역효과");
const flat = judgeOffline("전하는 최고이십니다 위대하신 성군", character, { mode: "mixed", cfg });
ok(flat.grade === "역효과", "아첨 → 역효과");

console.log("\n[4] 결정론: 같은 입력 → 같은 게이지");
const a = play(["설총의 이두처럼 백성을 편하게 하려는 것입니다"]);
const b = play(["설총의 이두처럼 백성을 편하게 하려는 것입니다"]);
ok(a.gauge === b.gauge, `동일 결과 (${a.gauge} == ${b.gauge})`);

console.log("\n[5] strict 모드에서 회피 논거는 더 가혹");
const av = judgeOffline("형옥의 공평은 옥리에 달렸으니 억울함은 글과 무관합니다", character, { mode: "strict", cfg });
ok(["역효과", "불합치", "부분", "탁월", "정합"].includes(av.grade), `strict 회피 판정 = ${av.grade}`);

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
