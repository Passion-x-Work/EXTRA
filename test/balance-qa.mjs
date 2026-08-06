// test/balance-qa.mjs — 3인물 밸런스 시뮬(오프라인 판정 기준). 실행: node test/balance-qa.mjs
import { readFileSync } from "node:fs";
import { initState, applyGrade, resultBand } from "../server/engine/applyGrade.js";
import { judgeOffline } from "../server/ai/judge.js";

const rj = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf-8"));
const cfg = rj("config/difficulty.json");
const load = (id) => ({
  profile: rj(`content/characters/${id}/profile.json`),
  knowledge: rj(`content/characters/${id}/knowledge.json`),
  debate: rj(`content/characters/${id}/debate.json`),
});

// app.js 방식대로 한 판 시뮬: coveredAxes 추적 포함
function play(id, inputs, tone = "classic") {
  const ch = load(id);
  let s = initState(cfg, id);
  s.coveredAxes = new Set();
  const log = [];
  for (const t of inputs) {
    if (s.status !== "CONTINUE") break;
    const v = judgeOffline(t, ch, { cfg, tone, covered: [...s.coveredAxes] });
    s = applyGrade(s, { ...v, input: t }, cfg, id);
    if (v.matchedIssue && (v.grade === "탁월" || v.grade === "정합")) s.coveredAxes.add(v.matchedIssue);
    log.push(`${v.grade}(${v.matchedIssue || "-"}) g=${s.gauge}`);
  }
  return { status: s.status, turns: s.turn, band: resultBand(s.turn, cfg), log };
}

const kwOf = (id, bucket, axisIdx = 0, n = 3) =>
  (rj(`content/characters/${id}/profile.json`).values?.[bucket]?.[axisIdx]?.keywords || []).slice(0, n);

const out = [];
for (const id of ["sejong", "vangogh", "hokusai"]) {
  const ch = cfg.characters[id];
  const p = rj(`content/characters/${id}/profile.json`);
  const axes = p.values?.통하는_가치 || [];
  out.push(`\n===== ${id} (start=${ch.gauge_start}, penalty=${ch.penalty_multiplier}, diff=${ch.difficulty}) =====`);
  out.push(`통하는 축 ${axes.length}개: ${axes.map((a) => a.axis).join(" / ")}`);

  // 완벽: 각 축 대표 키워드 3개씩(=score≥2 보장)
  const ideal = axes.map((a) => (a.keywords || []).slice(0, 3).join(" "));
  const r1 = play(id, ideal);
  out.push(`[완벽 플레이] ${r1.status} · ${r1.turns}턴 · ${r1.band}등급 | ${r1.log.join(" · ")}`);

  // 단일 키워드 스팸 8회
  const spamKw = axes?.[0]?.keywords?.[0] || "";
  const r2 = play(id, Array(8).fill(spamKw));
  out.push(`[키워드1개 스팸 "${spamKw}"] ${r2.status} · ${r2.turns}턴 | ${r2.log.join(" · ")}`);

  // 삽질(역효과 키워드 반복) — 몇 턴에 지나
  const badKw = kwOf(id, "역효과")[0] || "돈";
  const r3 = play(id, Array(8).fill(badKw));
  out.push(`[삽질 "${badKw}"] ${r3.status} · ${r3.turns}턴 | ${r3.log.join(" · ")}`);
}
process.stdout.write(out.join("\n") + "\n");
