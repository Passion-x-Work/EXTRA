// server/index.mjs — 판정 프록시 + 정적 서빙(Render 배포용). 키(OPENAI/CLAUDE)는 서버에만.
//   POST /api/judge  { input, charId, mode, tone, provider } -> Verdict
// 게임 상태(게이지·턴·승패)는 클라이언트 engine이 소유. 서버는 판정만.
// 배포: `npm run build` 후 이 서버 하나로 프론트(dist)+API 모두 서빙.
import "./loadEnv.mjs"; // .env 를 먼저 로드(시스템 환경변수 override)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { judge } from "./ai/judge.js";
import { judgeRebuttal } from "./engine/miyamotoEngine.js";
import { loadCfg, loadChar, loadCards } from "./data.js";

const cfg = loadCfg();
const PORT = process.env.PORT || 8787;
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.end();

  if (req.method === "POST" && req.url === "/api/judge") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const { input, charId = "sejong", mode, tone, provider, covered } = JSON.parse(raw || "{}");
        const character = loadChar(charId);
        const useMode = mode || cfg.characters[charId]?.mode || "mixed";
        const verdict = await judge(input, character, { provider, mode: useMode, tone, cfg, covered });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(verdict));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  // 번외(역설득) 판정: AI 화자의 논거[argIndex]에 대한 플레이어 반박을 판정
  if (req.method === "POST" && req.url === "/api/judgeReverse") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const { charId = "miyamoto", argIndex = 0, input, gauge = 0, provider, tone, isFinal } = JSON.parse(raw || "{}");
        const cards = loadCards(charId);
        const result = await judgeRebuttal(cards, argIndex, input, gauge, { provider, mode: "reverse-persuasion", tone, isFinal });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
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

  // ── 빌드된 프론트엔드 정적 서빙(Render 등 단일 서버 배포) ──
  if (req.method === "GET" || req.method === "HEAD") {
    const MIME = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",   // 초상·배경 이미지
      ".webm": "video/webm",   // 승리 클립
      ".mp4": "video/mp4",     // 승리 클립(Safari 폴백)
      ".svg": "image/svg+xml",
      ".json": "application/json",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
    };
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const safePath = resolve(DIST, "." + (urlPath === "/" ? "/index.html" : urlPath));
    // 경로 탈출 방지: dist 밖(../ 등)은 서빙하지 않는다
    if (safePath.startsWith(DIST) && existsSync(safePath) && statSync(safePath).isFile()) {
      res.writeHead(200, { "content-type": MIME[extname(safePath).toLowerCase()] || "application/octet-stream" });
      return res.end(readFileSync(safePath));
    }
    // SPA fallback: 경로를 못 찾으면 index.html
    const indexPath = join(DIST, "index.html");
    if (existsSync(indexPath)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(indexPath));
    }
  }

  res.writeHead(404);
  res.end("not found");
}).listen(PORT, () => console.log(`[EXTRA] 서버 http://localhost:${PORT} (providers: gpt=${!!process.env.OPENAI_API_KEY} claude=${!!process.env.CLAUDE_API_KEY} · dist=${existsSync(DIST)})`));
