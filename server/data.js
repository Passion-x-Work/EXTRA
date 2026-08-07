// server/data.js — config·캐릭터 데이터 로더(로컬 프록시 + Vercel 함수 공용).
// 경로는 이 파일 기준(../config, ../content) → cwd와 무관하게 동작.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf-8"));
export const loadCfg = () => readJson("config/difficulty.json");

const cache = {};
export function loadChar(id) {
  if (cache[id]) return cache[id];
  const b = `content/characters/${id}`;
  return (cache[id] = {
    profile: readJson(`${b}/profile.json`),
    knowledge: readJson(`${b}/knowledge.json`),
    debate: readJson(`${b}/debate.json`),
  });
}

// 번외(역설득) 인물은 cards.json 사용(profile/knowledge 없음)
const cardsCache = {};
export function loadCards(id) {
  if (cardsCache[id]) return cardsCache[id];
  return (cardsCache[id] = readJson(`content/characters/${id}/cards.json`));
}
