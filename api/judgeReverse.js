// api/judgeReverse.js — Vercel 서버리스 역설득 판정 함수. (로컬은 server/index.mjs 프록시가 동일 역할)
// 번외(미야모토): AI 화자 논거[argIndex]에 대한 플레이어 반박을 판정.
// POST /api/judgeReverse  { charId, argIndex, input, gauge, provider } -> { verdict, defended, delta, gauge, cardWon, win }
import { judgeRebuttal } from "../server/engine/miyamotoEngine.js";
import { loadCards } from "../server/data.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const { charId = "miyamoto", argIndex = 0, input, gauge = 0, provider, tone, isFinal } = req.body || {};
    const cards = loadCards(charId);
    const result = await judgeRebuttal(cards, argIndex, input, gauge, { provider, mode: "reverse-persuasion", tone, isFinal });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
