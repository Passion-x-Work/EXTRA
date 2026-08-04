// api/judge.js — Vercel 서버리스 판정 함수. (로컬은 server/index.mjs 프록시가 같은 역할)
// 키(OPENAI_API_KEY / CLAUDE_API_KEY / AI_PROVIDER)는 Vercel 환경변수로 설정.
// POST /api/judge  { input, charId, mode, tone, provider } -> Verdict
import { judge } from "../server/ai/judge.js";
import { loadCfg, loadChar } from "../server/data.js";

const cfg = loadCfg();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const { input, charId = "sejong", mode, tone, provider } = req.body || {};
    const character = loadChar(charId);
    const useMode = mode || cfg.characters[charId]?.mode || "mixed";
    const verdict = await judge(input, character, { provider, mode: useMode, tone, cfg });
    res.status(200).json(verdict);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
