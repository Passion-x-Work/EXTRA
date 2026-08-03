// web/src/app.js — 오프라인 판정으로 도는 세종 데모(키 없이 즉시 플레이).
import cfg from "../../config/difficulty.json";
import profile from "../../content/characters/sejong/profile.json";
import knowledge from "../../content/characters/sejong/knowledge.json";
import debate from "../../content/characters/sejong/debate.json";
import { initState, applyGrade, resultBand } from "../../server/engine/applyGrade.js";
import { judgeOffline } from "../../server/ai/judge.js";

const character = { profile, knowledge, debate };
const $ = (id) => document.getElementById(id);
let state, tone = "classic", firstInputSaved = "";

function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screen).classList.add("active");
}

function renderGauge() {
  const pct = Math.max(0, Math.min(100, state.gauge));
  $("gauge-fill").style.width = pct + "%";
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
  div.textContent = "근거: " + sources.map((s) => s.source.split(".")[0].slice(0, 40)).join(" / ");
  $("log").appendChild(div);
}

function startGame() {
  state = initState(cfg, "sejong");
  firstInputSaved = "";
  $("log").innerHTML = "";
  $("char-name").textContent = profile.displayName;
  renderGauge();
  addLine(
    "세종: 그대는 어인 일로 과인을 찾았는가. 새 문자를 만들려 하니 다들 '중국의 글이 있는데 무엇하러' 하는구나. 그대라면 나를 도와 신하들을 설득할 수 있겠는가?",
    "npc"
  );
  show("scr-chat");
  $("turn-input").focus();
}

function endGame() {
  const won = state.status === "WIN";
  $("result-title").textContent = won ? "세종대왕의 뜻을 굳혔습니다" : "설득에 실패했습니다";
  $("result-line").textContent = firstInputSaved ? `“${firstInputSaved}”` : "";
  $("result-turns").textContent = state.turn + "턴";
  $("result-grade").textContent = won ? resultBand(state.turn, cfg) : "—";
  show("scr-result");
}

function onTurn(e) {
  e.preventDefault();
  const input = $("turn-input").value.trim();
  if (!input || state.status !== "CONTINUE") return;
  if (!firstInputSaved) firstInputSaved = input;
  $("turn-input").value = "";
  addLine("나: " + input, "me");

  const mode = cfg.characters.sejong.mode || "mixed";
  const verdict = judgeOffline(input, character, { mode, cfg, tone });
  state = applyGrade(state, verdict, cfg, "sejong");

  addLine(verdict.line, "npc");
  addSources(verdict.sources);
  const tag = { 탁월: "+50", 정합: "+35", 부분: "+15", 불합치: "0", 역효과: "-20" }[verdict.grade];
  addLine(`[${verdict.grade} ${tag}]`, "grade-tag");
  renderGauge();

  if (state.status !== "CONTINUE") setTimeout(endGame, 700);
}

// 이벤트 바인딩
document.querySelectorAll(".relic[data-char]").forEach((b) =>
  b.addEventListener("click", startGame)
);
$("turn-form").addEventListener("submit", onTurn);
$("retry").addEventListener("click", () => show("scr-map"));
$("tone-toggle").addEventListener("click", () => {
  tone = tone === "classic" ? "meme" : "classic";
  $("tone-toggle").textContent = tone === "classic" ? "정통" : "밈";
});
