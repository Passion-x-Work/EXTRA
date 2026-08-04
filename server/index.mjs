// server/index.mjs — 판정 프록시. 키(OPENAI/CLAUDE)는 서버에만. 클라이언트엔 노출 X.
//   POST /api/judge  { input, charId, mode, tone, provider } -> Verdict
// 게임 상태(게이지·턴·승패)는 클라이언트 engine이 소유. 서버는 판정만.
import "./loadEnv.mjs"; // .env 를 먼저 로드(시스템 환경변수 override)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { judge } from "./ai/judge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf-8"));
const cfg = readJson("config/difficulty.json");
const chars = {}; // 캐릭터 데이터 캐시
function loadChar(id) {
  if (chars[id]) return chars[id];
  const base = `content/characters/${id}`;
  chars[id] = {
    profile: readJson(`${base}/profile.json`),
    knowledge: readJson(`${base}/knowledge.json`),
    debate: readJson(`${base}/debate.json`),
  };
  return chars[id];
}

const PORT = process.env.PORT || 8787;

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.end();

  if (req.method === "POST" && req.url === "/api/judge") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const { input, charId = "sejong", mode, tone, provider } = JSON.parse(raw || "{}");
        const character = loadChar(charId);
        const useMode = mode || cfg.characters[charId]?.mode || "mixed";
        const verdict = await judge(input, character, { provider, mode: useMode, tone, cfg });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(verdict));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      providers: { gpt: !!process.env.OPENAI_API_KEY, claude: !!process.env.CLAUDE_API_KEY },
      default: process.env.AI_PROVIDER || "offline",
    }));
  }

  res.writeHead(404);
  res.end("not found");
}).listen(PORT, () => console.log(`[EXTRA] 판정 프록시 http://localhost:${PORT} (providers: gpt=${!!process.env.OPENAI_API_KEY} claude=${!!process.env.CLAUDE_API_KEY})`));
