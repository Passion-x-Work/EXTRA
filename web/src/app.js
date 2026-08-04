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
// 플레이어 난이도(이지/미디움/하드) → 회피 모드 + 시작 게이지 보정
const DIFF_MODE = { easy: "reward", mid: "mixed", hard: "strict" };
const DIFF_START = { easy: 15, mid: 0, hard: -8 };
const $ = (id) => document.getElementById(id);
let state, charId, tone = "classic", firstInputSaved = "", difficulty = "mid";

// ── 사료 도감(localStorage) ──
const DOGAM_KEY = "extra_dogam_v1";
const loadDogam = () => { try { return JSON.parse(localStorage.getItem(DOGAM_KEY)) || {}; } catch (_) { return {}; } };
function addToDogam(cid, ids) {
  const d = loadDogam(); const set = new Set(d[cid] || []);
  ids.forEach((i) => set.add(i)); d[cid] = [...set];
  localStorage.setItem(DOGAM_KEY, JSON.stringify(d));
}
const fragTopic = (cid, id) => chars[cid]?.knowledge.fragments.find((f) => f.id === id)?.topic || id;

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

// 설득의 축 진행 표시: 찾기 전엔 이름 가림(숨은조건 추리 유지), 커버하면 공개
function renderAxisTrack() {
  const axes = chars[charId]?.profile?.values?.["통하는_가치"] || [];
  const el = $("axis-track");
  el.innerHTML = axes.map((a) => {
    const on = state.coveredAxes.has(a.axis);
    return `<span class="axis-chip${on ? " on" : ""}">${on ? "✓ " + a.axis : "？"}</span>`;
  }).join("");
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
  state.gauge = Math.max(0, Math.min(100, state.gauge + (DIFF_START[difficulty] || 0))); // 난이도 보정
  state.collected = new Set(); // 이번 판에 만난 사료 카드
  state.coveredAxes = new Set(); // 이번 판에 커버한 가치 축(설득 깊이)
  state.hintIdx = 0; // 열어준 힌트 개수
  state.turnLog = []; // 톤 전환 시 리렌더용 기록
  firstInputSaved = "";
  $("log").innerHTML = "";
  $("scr-chat").dataset.theme = charId; // 인물별 세계 배경/테마
  $("win-seal").classList.remove("stamped");
  $("char-name").textContent = profile.displayName;
  $("char-diff").textContent = scenario.timeLabel || DIFF_KO[profile.difficulty] || "";
  $("turn-input").placeholder = `${profile.displayName}에게 건넬 논거를 입력…`;
  renderGauge();
  renderAxisTrack();
  addLine(scenario.openingLines?.[tone] || scenario.openingLines?.classic || "…", "npc");
  show("scr-chat");
  $("turn-input").focus();
}

function endGame() {
  const won = state.status === "WIN";
  const scn = chars[charId].scenario;
  $("result-title").textContent = won ? "설득 성공" : "다시 도전";
  $("result-line").textContent = firstInputSaved ? `“${firstInputSaved}”` : "";
  $("result-turns").textContent = state.turn + "턴";
  $("result-grade").textContent = won ? resultBand(state.turn, cfg) : "—";
  const note = won ? scn.winScene?.historicalNote : scn.loseScene?.historicalNote;
  $("result-cta").textContent = note || "";

  // 승리 보상: 이번 판에 만난 사료 카드를 도감에 수집
  const rc = $("result-cards");
  if (won) {
    const prev = new Set(loadDogam()[charId] || []);
    const got = [...(state.collected || [])];
    const fresh = got.filter((id) => !prev.has(id));
    addToDogam(charId, got);
    rc.innerHTML = fresh.length
      ? `<div class="rc-title">사료 카드 ${fresh.length}장 획득</div>` +
        fresh.map((id) => `<span class="rc-chip">${fragTopic(charId, id)}</span>`).join("")
      : `<div class="rc-title muted">이미 모은 사료였습니다</div>`;
  } else rc.innerHTML = "";

  show("scr-result");
  const seal = $("win-seal");
  seal.classList.remove("stamped");
  if (won) requestAnimationFrame(() => seal.classList.add("stamped")); // 낙관 쾅
}

// ── 사료 도감 렌더 ──
function renderDogam() {
  const d = loadDogam();
  const el = $("dogam-list");
  const entries = Object.entries(d).filter(([, ids]) => ids && ids.length);
  if (!entries.length) {
    el.innerHTML = `<p class="dogam-empty">아직 모은 사료가 없어요.<br />인물을 설득해 사료 카드를 모아보세요.</p>`;
    return;
  }
  el.innerHTML = entries.map(([cid, ids]) => {
    const ch = chars[cid]; if (!ch) return "";
    const cards = ids.map((id) => ch.knowledge.fragments.find((f) => f.id === id)).filter(Boolean);
    return `<div class="dogam-group"><h3>${ch.profile.displayName} · ${cards.length}장</h3>` +
      cards.map((f) => `<div class="dogam-card"><div class="dc-topic">${f.topic}</div><div class="dc-content">${f.content}</div><div class="dc-src">${f.source.split("/")[0].slice(0, 46)}</div></div>`).join("") +
      `</div>`;
  }).join("");
}

async function getVerdict(input, mode) {
  const provider = $("provider").value;
  const covered = [...state.coveredAxes];
  if (provider === "offline") return judgeOffline(input, character(), { mode, cfg, tone, covered });
  try {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, charId, mode, tone, provider, covered }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (err) {
    console.warn("판정 프록시 실패 → 오프라인 폴백", err);
    return judgeOffline(input, character(), { mode, cfg, tone, covered });
  }
}

async function onTurn(e) {
  e.preventDefault();
  const input = $("turn-input").value.trim();
  if (!input || state.status !== "CONTINUE") return;
  if (!firstInputSaved) firstInputSaved = input;
  $("turn-input").value = "";
  addLine("나: " + input, "me");

  const mode = DIFF_MODE[difficulty] || "mixed";
  const btn = $("turn-form").querySelector("button");
  btn.disabled = true;
  const verdict = await getVerdict(input, mode);
  btn.disabled = false;
  state = applyGrade(state, verdict, cfg, charId);
  (verdict.sources || []).forEach((s) => state.collected.add(s.id)); // 만난 사료 수집
  if (verdict.matchedIssue && (verdict.grade === "탁월" || verdict.grade === "정합"))
    state.coveredAxes.add(verdict.matchedIssue); // 새로 커버한 가치 축

  state.turnLog.push({ type: "turn", input, verdict });
  renderVerdict(verdict);
  renderGauge();
  renderAxisTrack();
  maybeUnlockHint();

  if (state.status !== "CONTINUE") setTimeout(endGame, 700);
}

// 판정 결과(대사+출처+등급) 렌더
function renderVerdict(v) {
  addLine(v.line, "npc");
  addSources(v.sources);
  const tag = { 탁월: "+50", 정합: "+35", 부분: "+15", 불합치: "0", 역효과: "-20" }[v.grade];
  const p = v.provider && v.provider !== "offline" ? " · " + v.provider : "";
  addLine(`[${v.grade} ${tag}${p}]`, "grade-tag");
}

// 사료 힌트 카드
function addHintCard(f) {
  if (!f) return;
  const div = document.createElement("div");
  div.className = "msg hint";
  div.innerHTML = `<b>사료 힌트</b> · ${f.topic}<br/>${f.content}<div class="hint-src">${f.source.split("/")[0].slice(0, 44)}</div>`;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}

// 톤 전환 시 로그 전체를 새 말투로 리렌더(오프라인 대사는 그 자리에서 재판정, 사료 근거 유지)
function retone() {
  if (!state || !state.turnLog) return;
  const { scenario } = chars[charId];
  $("log").innerHTML = "";
  addLine(scenario.openingLines?.[tone] || scenario.openingLines?.classic || "…", "npc");
  const covered = new Set();
  const mode = DIFF_MODE[difficulty] || "mixed";
  for (const e of state.turnLog) {
    if (e.type === "hint") { addHintCard(chars[charId].knowledge.fragments.find((f) => f.id === e.fragId)); continue; }
    addLine("나: " + e.input, "me");
    const v = e.verdict.provider === "offline"
      ? judgeOffline(e.input, character(), { mode, cfg, tone, covered: [...covered] })
      : e.verdict; // 실 AI 대사는 재생성 불가 → 원본 유지
    renderVerdict(v);
    if (v.matchedIssue && (v.grade === "탁월" || v.grade === "정합")) covered.add(v.matchedIssue);
  }
}

// 연속 실패 시 실제 사료 카드를 힌트로 열어준다(도감에도 수집).
function maybeUnlockHint() {
  if (state.status !== "CONTINUE") return;
  const trig = cfg.hint_unlock?.trigger_fail_count || 3;
  if ((state.consecutiveBad || 0) < trig) return;
  const order = cfg.hint_unlock?.order?.[charId] || chars[charId].knowledge.fragments.map((f) => f.id);
  if (state.hintIdx >= order.length) return;
  const f = chars[charId].knowledge.fragments.find((x) => x.id === order[state.hintIdx]);
  state.hintIdx++;
  state.consecutiveBad = 0; // 힌트 후 카운터 리셋
  if (!f) return;
  state.collected.add(f.id); // 힌트로 얻은 사료도 도감에
  state.turnLog.push({ type: "hint", fragId: f.id });
  addHintCard(f);
}

// ── 결과 공유 카드 (canvas → PNG). 숨은조건은 담지 않는다. ──
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrapText(g, text, maxW) {
  const lines = []; let line = "";
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}
function buildShareCard() {
  const won = state.status === "WIN";
  const { profile, scenario } = chars[charId];
  const grade = won ? resultBand(state.turn, cfg) : "—";
  const accent = charId === "vangogh" ? "#2c4ca8" : "#2f6f9e";
  const seal = "#a8322a", gold = "#ad8234", ink = "#221d15";
  const W = 1080, H = 1350, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");

  g.fillStyle = "#f4ecd7"; g.fillRect(0, 0, W, H);
  g.strokeStyle = gold; g.lineWidth = 3; g.strokeRect(40, 40, W - 80, H - 80);
  g.strokeStyle = "#cdbf9d"; g.lineWidth = 1.5; g.strokeRect(54, 54, W - 108, H - 108);
  g.fillStyle = accent; g.fillRect(54, 54, W - 108, 10);

  g.textBaseline = "top"; g.textAlign = "left";
  g.fillStyle = ink; g.font = "800 46px 'Nanum Myeongjo', serif"; g.fillText("EXTRA", 92, 96);
  g.fillStyle = "#7c7059"; g.font = "500 24px 'Noto Sans KR', sans-serif"; g.fillText("역사에 끼어든 단역", 94, 152);
  g.save(); g.translate(W - 138, 132); g.rotate(-0.12);
  g.fillStyle = seal; roundRect(g, -46, -34, 92, 100, 10); g.fill();
  g.fillStyle = "#fff"; g.font = "800 42px 'Nanum Myeongjo', serif"; g.textAlign = "center";
  g.fillText("端", 0, -20); g.fillText("役", 0, 24); g.restore();

  g.textAlign = "center";
  g.fillStyle = seal; g.font = "800 66px 'Nanum Myeongjo', serif"; g.fillText(won ? "설득 성공" : "다시 도전", W / 2, 300);
  g.fillStyle = ink; g.font = "700 42px 'Nanum Myeongjo', serif"; g.fillText(profile.displayName, W / 2, 392);
  g.fillStyle = "#7c7059"; g.font = "400 26px 'Noto Sans KR', sans-serif"; g.fillText(scenario.timeLabel || "", W / 2, 448);

  g.beginPath(); g.arc(W / 2, 600, 98, 0, Math.PI * 2);
  g.fillStyle = "#fff8ea"; g.fill(); g.strokeStyle = gold; g.lineWidth = 4; g.stroke();
  g.fillStyle = gold; g.font = "800 112px 'Nanum Myeongjo', serif"; g.textBaseline = "middle";
  g.fillText(grade, W / 2, 610); g.textBaseline = "top";

  if (firstInputSaved) {
    g.fillStyle = "#4a4132"; g.font = "italic 34px 'Nanum Myeongjo', serif";
    wrapText(g, `“${firstInputSaved}”`, W - 260).slice(0, 3).forEach((ln, i) => g.fillText(ln, W / 2, 780 + i * 50));
  }
  g.fillStyle = "#7c7059"; g.font = "500 28px 'Noto Sans KR', sans-serif";
  g.fillText(`${state.turn}턴${won ? " · " + grade + "등급" : ""}`, W / 2, 970);
  g.fillStyle = seal; g.font = "700 40px 'Nanum Myeongjo', serif"; g.fillText("당신도 설득할 수 있는가?", W / 2, 1130);
  g.fillStyle = "#9a9078"; g.font = "400 24px 'Noto Sans KR', sans-serif"; g.fillText("EXTRA · 역사에 끼어든 단역", W / 2, 1210);
  g.textAlign = "left";
  return cv;
}
async function saveCard() {
  try { await document.fonts.ready; } catch (_) {}
  buildShareCard().toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], "extra-card.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "EXTRA" }); return; } catch (_) {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "extra-card.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

document.querySelectorAll(".relic[data-char]").forEach((b) =>
  b.addEventListener("click", () => startGame(b.dataset.char))
);
$("turn-form").addEventListener("submit", onTurn);
$("save-card").addEventListener("click", saveCard);
$("retry").addEventListener("click", () => show("scr-map"));
// 말투 슬라이딩 스위치(정통↔밈): 즉시 로그를 새 말투로 리렌더
$("tone-toggle").addEventListener("click", () => {
  tone = tone === "classic" ? "meme" : "classic";
  const sw = $("tone-toggle"), on = tone === "meme";
  sw.dataset.on = on ? "true" : "false";
  sw.setAttribute("aria-checked", on ? "true" : "false");
  sw.querySelector(".ts-cap").textContent = on ? "밈" : "정통";
  if (state) retone();
});
// 난이도 선택
document.querySelectorAll("#diff-select .diff").forEach((b) =>
  b.addEventListener("click", () => {
    difficulty = b.dataset.diff;
    document.querySelectorAll("#diff-select .diff").forEach((x) => x.classList.toggle("active", x === b));
  })
);
// 사료 도감
$("open-dogam").addEventListener("click", () => { renderDogam(); show("scr-dogam"); });
$("close-dogam").addEventListener("click", () => show("scr-map"));
