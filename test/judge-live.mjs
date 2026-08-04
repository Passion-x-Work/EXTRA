// test/judge-live.mjs — 실제 GPT/Claude 판정을 CLI로 빠르게 확인.
//   실행: npm run judge -- gpt        (또는 claude / both)
//   .env 의 OPENAI_API_KEY / CLAUDE_API_KEY 사용 (npm run judge 가 --env-file 로드)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { judgeGPT, judgeClaude, judgeOffline } from "../server/ai/judge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf-8"));
const cfg = readJson("config/difficulty.json");
const character = {
  profile: readJson("content/characters/sejong/profile.json"),
  knowledge: readJson("content/characters/sejong/knowledge.json"),
  debate: readJson("content/characters/sejong/debate.json"),
};

const which = (process.argv[2] || "both").toLowerCase();
const inputs = [
  "글을 모르는 백성이 억울한 일을 당해도 하소연할 문서조차 쓰지 못합니다",
  "표현의 자유가 민주주의의 기본입니다",           // 시대착오
  "전하는 위대하신 성군이십니다",                    // 아첨
];
const runners = { gpt: judgeGPT, claude: judgeClaude, offline: (i, c, o) => judgeOffline(i, c, o) };
const providers = which === "both" ? ["gpt", "claude"] : [which];

for (const input of inputs) {
  console.log(`\n■ "${input}"`);
  for (const p of providers) {
    const v = await runners[p](input, character, { mode: "mixed", cfg });
    console.log(`  [${p}] ${v.grade}${v.anachronism ? " (시대착오)" : ""} · provider=${v.provider}`);
    console.log(`        ${v.line}`);
    if (v.sources?.length) console.log(`        근거: ${v.sources.map((s) => s.id).join(", ")}`);
  }
}
