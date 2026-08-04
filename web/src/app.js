// web/src/app.js — 멀티 캐릭터. 오프라인 판정으로 즉시 플레이, provider 드롭다운으로 GPT/Claude 전환.
import cfg from "../../config/difficulty.json";
import { initState, applyGrade, resultBand } from "../../server/engine/applyGrade.js";
import { judgeOffline } from "../../server/ai/judge.js";

// content/characters/<id>/*.json 전부 로드 → chars[id] = { profile, knowledge, debate, scenario }
const modules = import.meta.glob("../../content/characters/*/*.json", { eager: true });
const chars = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/characters\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  (chars[m[1]] ??= {})[m[2]] = mod.default ?? mod;
}

const DIFF_KO = { tutorial: "튜토리얼", standard: "표준", hard: "고난도" };
const $ = (id) => document.getElementById(id);
let state, charId, tone = "classic", firstInputSaved = "";

const character = () => {
  const c = chars[charId];
  return { profile: c.profile, knowledge: c.knowledge, debate: c.debate };
};

function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screen).classList.add("active");
}

function renderGauge() {
  $("gauge-fill").style.width = Math.max(0, Math.min(100, state.gauge)) + "%";
  $("gauge-num").textContent = state.gauge;
  $("turn-count").textContent = "턴 " + state.turn;
}

function addLine(text, cls) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}

function addSources(sources) {
  if (!sources || !sources.length) return;
  const div = document.createElement("div");
  div.className = "sources";
  div.textContent = "근거: " + sources.map((s) => s.source.split("/")[0].split(".")[0].slice(0, 40)).join(" / ");
  $("log").appendChild(div);
}

function startGame(id) {
  charId = id;
  const { profile, scenario } = chars[charId];
  state = initState(cfg, charId);
  firstInputSaved = "";
  $("log").innerHTML = "";
  $("char-name").textContent = profile.displayName;
  $("char-diff").textContent = DIFF_KO[profile.difficulty] || profile.difficulty || "";
  renderGauge();
  addLine(scenario.openingLines?.[tone] || scenario.openingLines?.classic || "…", "npc");
  show("scr-chat");
  $("turn-input").focus();
}

function endGame() {
  const won = state.status === "WIN";
  const scn = chars[charId].scenario;
  $("result-title").textContent = won ? "설득 성공 🎉" : "다시 도전";
  $("result-line").textContent = firstInputSaved ? `“${firstInputSaved}”` : "";
  $("result-turns").textContent = state.turn + "턴";
  $("result-grade").textContent = won ? resultBand(state.turn, cfg) : "—";
  const note = won ? scn.winScene?.historicalNote : scn.loseScene?.historicalNote;
  $("result-cta").textContent = note || "";
  show("scr-result");
}

async function getVerdict(input, mode) {
  const provider = $("provider").value;
  if (provider === "offline") return judgeOffline(input, character(), { mode, cfg, tone });
  try {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, charId, mode, tone, provider }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (err) {
    console.warn("판정 프록시 실패 → 오프라인 폴백", err);
    return judgeOffline(input, character(), { mode, cfg, tone });
  }
}

async function onTurn(e) {
  e.preventDefault();
  const input = $("turn-input").value.trim();
  if (!input || state.status !== "CONTINUE") return;
  if (!firstInputSaved) firstInputSaved = input;
  $("turn-input").value = "";
  addLine("나: " + input, "me");

  const mode = cfg.characters[charId]?.mode || "mixed";
  const btn = $("turn-form").querySelector("button");
  btn.disabled = true;
  const verdict = await getVerdict(input, mode);
  btn.disabled = false;
  state = applyGrade(state, verdict, cfg, charId);

  addLine(verdict.line, "npc");
  addSources(verdict.sources);
  const tag = { 탁월: "+50", 정합: "+35", 부분: "+15", 불합치: "0", 역효과: "-20" }[verdict.grade];
  const p = verdict.provider && verdict.provider !== "offline" ? " · " + verdict.provider : "";
  addLine(`[${verdict.grade} ${tag}${p}]`, "grade-tag");
  renderGauge();

  if (state.status !== "CONTINUE") setTimeout(endGame, 700);
}

document.querySelectorAll(".relic[data-char]").forEach((b) =>
  b.addEventListener("click", () => startGame(b.dataset.char))
);
$("turn-form").addEventListener("submit", onTurn);
$("retry").addEventListener("click", () => show("scr-map"));
$("tone-toggle").addEventListener("click", () => {
  tone = tone === "classic" ? "meme" : "classic";
  $("tone-toggle").textContent = tone === "classic" ? "정통" : "밈";
});
