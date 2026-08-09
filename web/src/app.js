// web/src/app.js — 멀티 캐릭터. 오프라인 판정으로 즉시 플레이, provider 드롭다운으로 GPT/Claude 전환.
import cfg from "../../config/difficulty.json";
import { initState, applyGrade, resultBand } from "../../server/engine/applyGrade.js";
import { judgeOffline } from "../../server/ai/judge.js";
import { openTurn, judgeRebuttal, getRetryLine } from "../../server/engine/miyamotoEngine.js";

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
let snaps = [];              // 턴별 상태 스냅샷 스택(베끼기 응징 = 되돌리기용)
const PARROT_ROLLBACK = 2;   // 사료 베끼기 감지 시 되돌릴 턴 수

// ── 번외(역설득) 세션 상태 ──
// 밸런스는 cards.winCondition이 단일 출처(Q1: 시작 20 / 승리 80). 조기 종료 없이 5논거 전부 진행.
let rev = null;              // { cards, scenario, index, gauge, goal, done, log }
const REV_START_DEFAULT = 20, REV_GOAL_DEFAULT = 80; // winCondition 없을 때 폴백
const isReverseChar = (id) => !!chars[id]?.cards;    // cards.json 있으면 역설득 인물

// ── 역모드 기록: 반박 세션 로그 + 철학 카드 컬렉션(localStorage) ──
// REV_LOG: 최신 1판의 공방 전체(스펙 작업1 — 1차는 최신 1판만 유지).
// REV_DOGAM: 획득 철학 카드 누적 { miyamoto: { "arg-01": { card, philosophy, myInput, speaker, ts } } }
//   myInput = 그 카드를 얻어낸 '내 반박'(첫 strong 반박 고정 — 이후 판에서 더 잘 막아도 첫 기록 보존).
const REV_LOG_KEY = "extra_reverse_log_v1";
const REV_DOGAM_KEY = "extra_reverse_dogam_v1";
const loadRevLog = () => { try { return JSON.parse(localStorage.getItem(REV_LOG_KEY)) || {}; } catch (_) { return {}; } };
const loadRevDogam = () => { try { return JSON.parse(localStorage.getItem(REV_DOGAM_KEY)) || {}; } catch (_) { return {}; } };
function saveRevSession() {
  if (!rev || !rev.log?.length) return;
  const all = loadRevLog();
  all[charId] = { log: rev.log, gauge: rev.gauge, win: rev.gauge >= rev.goal, ts: Date.now() };
  try { localStorage.setItem(REV_LOG_KEY, JSON.stringify(all)); } catch (_) {}
}
// 반박 등급: 탁월=금(gold) / 정합=은(silver) / 그 외 방어=동(bronze)
const GRADE_RANK = { bronze: 1, silver: 2, gold: 3 };
const GRADE_KO = { bronze: "브론즈", silver: "실버", gold: "골드" };
const cardGrade = (verdictGrade) => verdictGrade === "탁월" ? "gold" : verdictGrade === "정합" ? "silver" : "bronze";

// 철학 카드 획득/성장 기록(인물별·논거별). 더 높은 등급 반박으로만 갱신(best-rebuttal).
// 반환: { status: "new"|"upgrade"|"keep", grade, from? } → 획득/승급 연출용
function addRevCard(argId, card, philosophy, myInput, speaker, grade = "silver") {
  const d = loadRevDogam();
  const mine = (d[charId] ??= {});
  const cur = mine[argId];
  let status = "keep", from = null;
  if (!cur) status = "new";
  else if ((GRADE_RANK[grade] || 0) > (GRADE_RANK[cur.grade] || 0)) { status = "upgrade"; from = cur.grade; }
  if (status !== "keep") {
    mine[argId] = { card, philosophy, myInput, speaker, grade, ts: Date.now() };
    try { localStorage.setItem(REV_DOGAM_KEY, JSON.stringify(d)); } catch (_) {}
  }
  return { status, grade, from };
}

// ── 사료 도감(localStorage) ──
const DOGAM_KEY = "extra_dogam_v1";
const loadDogam = () => { try { return JSON.parse(localStorage.getItem(DOGAM_KEY)) || {}; } catch (_) { return {}; } };
function addToDogam(cid, ids) {
  const d = loadDogam(); const set = new Set(d[cid] || []);
  ids.forEach((i) => set.add(i)); d[cid] = [...set];
  localStorage.setItem(DOGAM_KEY, JSON.stringify(d));
}
const fragTopic = (cid, id) => chars[cid]?.knowledge.fragments.find((f) => f.id === id)?.topic || id;

// ── 보너스 힌트 카드(클리어 보상, localStorage) ──
// 이지 클리어 → 미디움용 +1, 미디움 클리어 → 하드용 +1. 난이도별 최대 2장 보유.
const BONUS_KEY = "extra_bonus_hints_v1";
const NEXT_DIFF = { easy: "mid", mid: "hard" };
const DIFF_LABEL = { easy: "이지", mid: "미디움", hard: "하드" };
const BONUS_CAP = 2;
const loadBonus = () => { try { return JSON.parse(localStorage.getItem(BONUS_KEY)) || {}; } catch (_) { return {}; } };
const saveBonus = (b) => localStorage.setItem(BONUS_KEY, JSON.stringify(b));

// ── 진행 저장/이어하기(localStorage, 인물별) ──
const SAVE_KEY = "extra_save_v1";
const loadSaves = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (_) { return {}; } };
function saveGame() {
  if (!state || !charId || state.status !== "CONTINUE" || (state.turn || 0) < 1) return; // 의미 있는 진행만
  const all = loadSaves();
  all[charId] = {
    gauge: state.gauge, turn: state.turn, consecutiveBad: state.consecutiveBad, status: state.status,
    hintIdx: state.hintIdx, hintsLeft: state.hintsLeft, baseBudget: state.baseBudget, bonusAvail: state.bonusAvail,
    coveredAxes: [...state.coveredAxes], collected: [...state.collected],
    history: state.history, turnLog: state.turnLog, tone, difficulty, firstInputSaved, ts: Date.now(),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch (_) {}
}
function clearSave(id) {
  const all = loadSaves(); delete all[id];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch (_) {}
}
// 지도 유적에 '이어하기 · 턴 N' 표시 + 처음부터(↺) 버튼 갱신
function refreshMapSaves() {
  const saves = loadSaves();
  document.querySelectorAll(".relic[data-char]").forEach((b) => {
    const id = b.dataset.char, sub = b.querySelector(".relic-sub");
    if (!sub) return;
    if (b.dataset.sub0 == null) b.dataset.sub0 = sub.textContent;
    const sv = saves[id];
    let x = b.querySelector(".relic-fresh");
    if (sv && sv.status === "CONTINUE") {
      sub.textContent = `이어하기 · 턴 ${sv.turn}`;
      b.classList.add("relic--resume");
      if (!x) {
        x = document.createElement("span");
        x.className = "relic-fresh"; x.textContent = "↺"; x.title = "처음부터 시작";
        x.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); clearSave(id); refreshMapSaves(); });
        b.appendChild(x);
      }
    } else {
      sub.textContent = b.dataset.sub0;
      b.classList.remove("relic--resume");
      if (x) x.remove();
    }
  });
}

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

// 신념 게이지 → 인물 단계(Phase 1~5). 설득될수록 표정/자세가 바뀜.
const phaseFromGauge = (g) => Math.max(1, Math.min(5, Math.ceil((g || 0) / 20) || 1));

// 캐릭터 이미지 페이드 전환(같은 이미지는 스킵). 파일이 없으면(에셋 미제작) 초상 숨김.
function fadePortrait(el, newSrc) {
  if (!el || el.getAttribute("src") === newSrc) return;
  el.style.opacity = "0";
  setTimeout(() => {
    el.onload = () => { el.style.opacity = "1"; };
    el.onerror = () => { el.onerror = null; el.src = ""; }; // 404 → [src=""]로 숨김
    el.src = newSrc;
  }, 300);
}

// 인물별 에셋 규약(파일명은 docs/ASSETS_GUIDE.md). 새 인물은 여기 한 줄만 추가하면 됨.
//   dir     : /Assets/<dir>/ 하위(웹 서빙 경로, 파일은 web/public/Assets/<dir>/, 확장자 .webp)
//   bgDark  : 게이지 ≤50 배경 파일명(확장자 제외) · bgLight: >50 배경
//   classic : 정통 말투 초상 시리즈 접두 · meme: 밈 말투 초상 시리즈 접두
//   초상 파일명 = `<series>-Phase0N.webp` (N=1~5). 파일이 없으면 자동으로 숨겨짐(onerror).
const ASSETS = {
  sejong:  { dir: "Sejong", bgDark: "BG02",             bgLight: "BG01",      classic: "Front-NoBG", meme: "Hip-Front-NoBG" },
  vangogh: { dir: "gogh",   bgDark: "Gogh-BG02_night",  bgLight: "Gogh-BG01", classic: "NoBG_Gogh",  meme: "Hip-NoBG_Gogh" },
  hokusai: { dir: "Hokusai", bgDark: "Hokusai-BG02",    bgLight: "Hokusai-BG01", classic: "Hokusai", meme: "Hip-Hokusai" },
};

// 배경(게이지 연동: ≤50 어두움 → >50 밝음) + 캐릭터(톤별 시리즈 × Phase별 표정)
function updateScene() {
  const sc = $("scr-chat");
  const portrait = $("char-portrait");
  const a = ASSETS[charId];
  if (!a || !state) { sc.style.removeProperty("--scene-image"); if (portrait) { portrait.src = ""; } return; } // 에셋 없음 or 역모드(state=null)
  const ph = phaseFromGauge(state.gauge);
  // 배경: 파일이 없으면 CSS --scene-fallback(테마 그라디언트)이 자동으로 비쳐 보임.
  const bg = (state.gauge > 50 ? a.bgLight : a.bgDark);
  sc.style.setProperty("--scene-image", `url("/Assets/${a.dir}/${bg}.webp")`);
  // 초상: 톤별 시리즈 × Phase. 파일 없으면 fadePortrait의 onerror가 숨김 처리.
  const series = tone === "meme" ? a.meme : a.classic;
  fadePortrait(portrait, `/Assets/${a.dir}/${series}-Phase0${ph}.webp`);
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
  // 지난 대화는 투명하게, 최신 대화는 강조 (NPC/나 말풍선만 — 등급태그·출처는 제외)
  if (cls === "npc" || cls === "me") {
    document.querySelectorAll("#log .msg.latest").forEach((m) => {
      m.classList.remove("latest");
      m.classList.add("faded");
    });
  }
  const div = document.createElement("div");
  div.className = "msg " + cls + (cls === "npc" || cls === "me" ? " latest" : "");
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

// 말투 스위치 / 난이도 버튼의 표시를 현재 tone·difficulty 값과 동기화(이어하기 복원 시에도 사용)
function syncToneUI() {
  const sw = $("tone-toggle"); if (!sw) return;
  const on = tone === "meme";
  sw.dataset.on = on ? "true" : "false";
  sw.setAttribute("aria-checked", on ? "true" : "false");
  const cap = sw.querySelector(".ts-cap"); if (cap) cap.textContent = on ? "밈" : "정통";
}
function syncDiffUI() {
  document.querySelectorAll("#diff-select .diff").forEach((x) => x.classList.toggle("active", x.dataset.diff === difficulty));
}

function startGame(id, resume = false) {
  charId = id;
  const { profile, scenario } = chars[charId];
  const sv = resume ? loadSaves()[id] : null;
  const resuming = !!(sv && sv.status === "CONTINUE");
  state = initState(cfg, charId);

  if (resuming) {
    // 저장된 진행 복원(난이도·말투도 저장 시점 값으로)
    difficulty = sv.difficulty || difficulty;
    tone = sv.tone || tone;
    Object.assign(state, { gauge: sv.gauge, turn: sv.turn, consecutiveBad: sv.consecutiveBad, status: "CONTINUE", history: sv.history || [] });
    state.collected = new Set(sv.collected || []);
    state.coveredAxes = new Set(sv.coveredAxes || []);
    state.hintIdx = sv.hintIdx || 0;
    state.baseBudget = sv.baseBudget ?? (cfg.hint_unlock?.hint_budget?.[difficulty] ?? 2);
    state.bonusAvail = sv.bonusAvail ?? 0;
    state.hintsLeft = sv.hintsLeft ?? state.baseBudget;
    state.turnLog = sv.turnLog || [];
    firstInputSaved = sv.firstInputSaved || "";
  } else {
    state.gauge = Math.max(0, Math.min(100, state.gauge + (DIFF_START[difficulty] || 0))); // 난이도 보정
    state.collected = new Set(); // 이번 판에 만난 사료 카드
    state.coveredAxes = new Set(); // 이번 판에 커버한 가치 축(설득 깊이)
    state.hintIdx = 0; // 열어준 힌트 개수
    // 난이도별 힌트 예산(자동+수동 공용) + 클리어 보상 보너스 힌트 합산
    // (보너스는 게임 종료 시 '기본 예산을 초과해 실제로 쓴 만큼만' 차감 — 중도이탈 시 보존)
    state.baseBudget = cfg.hint_unlock?.hint_budget?.[difficulty] ?? 2;
    state.bonusAvail = Math.min(loadBonus()[difficulty] || 0, BONUS_CAP);
    state.hintsLeft = state.baseBudget + state.bonusAvail;
    state.turnLog = []; // 톤 전환 시 리렌더용 기록
    firstInputSaved = "";
  }

  syncToneUI(); syncDiffUI();
  $("log").innerHTML = "";
  $("scr-chat").dataset.theme = charId; // 인물별 세계 배경/테마
  $("win-seal").classList.remove("stamped");
  $("char-name").textContent = profile.displayName;
  $("char-diff").textContent = scenario.timeLabel || DIFF_KO[profile.difficulty] || "";
  $("turn-input").placeholder = `${profile.displayName}에게 건넬 논거를 입력…`;
  rev = null; // 정방향 시작 → 역모드 해제
  $("axis-track").style.display = ""; $("hint-btn").style.display = ""; $("save-card").style.display = "";
  renderGauge();
  renderAxisTrack();
  renderHintBtn();
  updateScene();
  if (resuming && state.turnLog.length) retone(); // 저장된 로그(오프닝+대화) 전체 재구성
  else addLine(scenario.openingLines?.[tone] || scenario.openingLines?.classic || "…", "npc");
  snaps = [snapshot()]; // 시작(또는 복원) 스냅샷 = 되돌리기 하한
  show("scr-chat");
  $("turn-input").focus();
}

// ══════════ 번외: 역설득 흐름 (AI가 먼저 논거 → 반박 → 판정 → 다음 논거) ══════════
function renderRevGauge() {
  const g = Math.max(0, Math.min(100, rev.gauge));
  $("gauge-fill").style.width = g + "%";
  $("gauge-num").textContent = g;
  $("turn-count").textContent = `논거 ${Math.min(rev.index + 1, rev.cards.arguments.length)}/${rev.cards.arguments.length}`;
}

function startReverse(id) {
  charId = id;
  const wc = chars[id].cards.winCondition || {};
  rev = { cards: chars[id].cards, scenario: chars[id].scenario, index: 0,
        gauge: wc.startGauge ?? REV_START_DEFAULT, goal: wc.goalGauge ?? REV_GOAL_DEFAULT,
        maxRebuttals: wc.maxRebuttals ?? 2, attempt: 0, speaker: null, done: false,
        log: [], cardsWon: [] };
  state = null; snaps = [];
  $("log").innerHTML = "";
  $("scr-chat").dataset.theme = id;
  $("win-seal").classList.remove("stamped");
  $("axis-track").style.display = "none"; // 역모드엔 축 트랙 없음
  $("hint-btn").style.display = "none";   // MVP: 힌트 없음
  $("turn-input").placeholder = "반박을 입력…";
  $("turn-input").disabled = false;
  $("turn-form").querySelector("button[type=submit]").disabled = false;
  $("char-portrait").src = ""; // 이미지 대기(자동 숨김)
  updateScene();
  renderRevGauge();
  // 도입부: 상황 설정 내레이션 전체(당신=거장, 회의 중, 두 동료 소개)
  (rev.scenario?.intro || []).forEach((line) => addBridge(line));
  show("scr-chat");
  revOpen(0);
  $("turn-input").focus();
}

// 역모드 화자 초상: Assets/Reverse/<speaker>-<tone>-<mood>.webp (파일 없으면 자동 숨김)
const REV_SPEAKER_ID = { "하루": "haru", "쿠로다": "kuroda" };
function revPortrait(speaker, mood = "neutral") {
  const sid = REV_SPEAKER_ID[speaker] || "haru";
  fadePortrait($("char-portrait"), `/Assets/Reverse/${sid}-${tone}-${mood}.webp`);
}
// 화자별 말풍선 클래스(S4 캐릭터 대비: 하루=따뜻/열정, 쿠로다=차가움/데이터)
const revSpeakerCls = (speaker) => REV_SPEAKER_ID[speaker] === "kuroda" ? "npc--kuroda" : "npc--haru";

// 상황 내레이션(브릿지) — 화자/시간 전환을 자연스럽게 잇는 무대 지시문
function addBridge(text) {
  const div = document.createElement("div");
  div.className = "msg bridge";
  div.textContent = text;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}

// 공방 소진 시 논거 마무리 안내.
//   comply(동조) → 💔 철학을 놓쳤다(카드 유실)
//   weak(약한 방어) → 😮‍💨 겨우 넘겼다(게이지는 방어했지만 확신이 없어 카드는 미획득)
function addMissedNotice(arg, outcome) {
  const div = document.createElement("div");
  const phil = arg.targetPhilosophy.split("—")[0].trim();
  if (outcome === "comply") {
    div.className = "msg missed";
    div.innerHTML = `💔 <b>철학을 놓쳤다</b> — 유혹에 동조해 <b>${arg.card || "이 논거의 카드"}</b>를 지키지 못했다.<br/><small>놓친 철학: ${phil} · 대화는 다음 주제로 넘어간다</small>`;
  } else {
    div.className = "msg missed missed--barely";
    div.innerHTML = `😮‍💨 <b>겨우 넘겼다</b> — 흔들리지는 않았지만, 확신이 부족해 <b>${arg.card || "카드"}</b>는 얻지 못했다.<br/><small>${phil} · 대화는 다음 주제로 넘어간다</small>`;
  }
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}

// AI 화자(하루/쿠로다)가 논거[index]를 던진다
function revOpen(index) {
  const t = openTurn(rev.cards, index);
  if (!t) return revEnd(rev.gauge >= rev.goal);
  rev.index = index;
  rev.attempt = 0;          // 새 논거 → 공방 카운트 리셋
  rev.speaker = t.speaker;  // 재설득 시 같은 화자로 이어가기
  $("char-name").textContent = t.speaker;
  $("char-diff").textContent = t.speakerRole || rev.scenario?.timeLabel || "";
  if (t.bridge) addBridge(t.bridge); // 상황 전환 내레이션(같은 날 시간 경과·화자 교대)
  addLine(`${t.speaker}: "${t.aiLine}"`, "npc " + revSpeakerCls(t.speaker)); // 화자별 말풍선 대비(S4)
  revPortrait(t.speaker, "neutral");
  renderRevGauge();
}

// 플레이어 반박 판정(프록시 → 실패 시 오프라인 폴백) + 멀티턴 흐름
async function onReverseTurn(e) {
  e.preventDefault();
  const input = $("turn-input").value.trim();
  if (!input || !rev || rev.done) return;
  $("turn-input").value = "";
  addLine("나: " + input, "me");
  const btn = $("turn-form").querySelector("button[type=submit]");
  btn.disabled = true;

  // 이번이 이 논거의 마지막 공방인가(카운트 소진 직전)
  const isFinal = rev.attempt + 1 >= rev.maxRebuttals;
  const provider = $("provider").value;
  let r;
  try {
    const res = await fetch("/api/judgeReverse", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ charId, argIndex: rev.index, input, gauge: rev.gauge, provider, tone, isFinal }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    r = await res.json();
  } catch (_) {
    r = await judgeRebuttal(rev.cards, rev.index, input, rev.gauge, { provider: "offline", mode: "reverse-persuasion", tone, isFinal });
  }
  btn.disabled = false;

  rev.gauge = r.gauge;
  addLine(r.verdict.line, "npc");
  const excellent = r.verdict.grade === "탁월";
  const tagLabel = excellent               ? `[✨ 탁월 방어 +${r.delta} ✨]`
                 : r.outcome === "strong"  ? `[방어 +${r.delta}]`
                 : r.outcome === "weak"    ? `[약한 방어 +${r.delta}]`
                 : `[동조 ${r.delta}]`;
  addLine(tagLabel, "grade-tag" + (excellent ? " grade-tag--excellent" : ""));
  if (excellent) excellentBurst();
  revPortrait(rev.speaker, r.mood);   // 판정 mood로 표정 전환
  renderRevGauge();

  // 공방 기록(작업1) + 철학 카드 즉시 수집/성장(작업2: 카드 + 그때의 내 반박 + 등급)
  const curArg = rev.cards.arguments[rev.index];
  const grade = cardGrade(r.verdict.grade); // 탁월=gold / 정합=silver / 그 외=bronze
  rev.log.push({ argId: curArg.id, speaker: rev.speaker, aiLine: curArg.aiLine,
                 myInput: input, outcome: r.outcome, grade: r.verdict.grade,
                 delta: r.delta, cardWon: r.cardWon || null });
  if (r.cardWon) {
    rev.cardsWon.push({ argId: curArg.id, card: r.cardWon, myInput: input, grade });
    const res = addRevCard(curArg.id, r.cardWon, curArg.targetPhilosophy, input, rev.speaker, grade);
    // 획득/승급 연출
    if (res.status === "upgrade")
      addLine(`⬆️ ${r.cardWon} 등급 상승! ${GRADE_KO[res.from]} → ${GRADE_KO[grade]}`, `grade-tag card-toast card-${grade}`);
    else
      addLine(`🃏 ${r.cardWon} 획득 · ${GRADE_KO[grade]}`, `grade-tag card-toast card-${grade}`);
  }

  const lastArg = rev.index + 1 >= rev.cards.arguments.length;

  // strong: 논거 확실히 방어 → 다음 논거(마지막이면 종료)
  if (r.outcome === "strong") {
    if (lastArg) return revEnd(rev.gauge >= rev.goal);
    return void setTimeout(() => revOpen(rev.index + 1), 800);
  }

  // weak/comply인데 아직 공방 여유 있음 → 같은 화자가 이어간다
  // weak: 각도를 바꿔 재설득 / comply: "정말 넘어온 거냐" 확인(되돌릴 기회)
  rev.attempt++;
  if (rev.attempt < rev.maxRebuttals) {
    const rt = getRetryLine(rev.cards, rev.index, rev.attempt - 1, r.outcome);
    return void setTimeout(() => {
      addLine(`${rt.speaker}: "${rt.line}"`, "npc " + revSpeakerCls(rt.speaker));
      revPortrait(rev.speaker, r.outcome === "comply" ? "smug" : "pressing");
    }, 800);
  }

  // 공방 소진 → 철학을 놓쳤음을 명시(어떤 카드를 잃었고, 게이지가 어떻게 됐는지)
  const missed = rev.cards.arguments[rev.index];
  addMissedNotice(missed, r.outcome);

  // 다음 논거(마지막이면 종료)
  if (lastArg) return revEnd(rev.gauge >= rev.goal);
  setTimeout(() => revOpen(rev.index + 1), 1400);
}

function revEnd(win) {
  if (!rev || rev.done) return;
  rev.done = true;
  saveRevSession(); // 이번 판 공방 기록 저장(작업1 — 최신 1판)
  // 마지막 대사 읽을 시간 → "결과 보기 ▶"(또는 7초) → 결과화면
  showEndGate(win, () => revShowResult(win));
}

// 실제 결과화면 렌더(게이트 통과 후 호출)
function revShowResult(win) {
  const sc = rev.scenario || {};
  $("result-title").textContent = win ? "철학을 지켰다" : "흔들렸다";
  const rl = $("result-line");
  if (win) {
    rl.textContent = sc.winScene?.text || "";
    rl.classList.remove("taunt");
  } else {
    // 패배 = 하루/쿠로다가 의기양양하게 놀린다(킹받는 엔딩)
    const t = pickTaunt(sc.loseScene?.taunt, rev.index + (rev.log?.length || 0)) || sc.loseScene?.text || "";
    rl.textContent = `${rev.speaker || "하루"}: "${t}"`;
    rl.classList.add("taunt");
  }
  $("result-turns").textContent = `${Math.min(rev.index + 1, rev.cards.arguments.length)}논거`;
  $("result-grade").textContent = win ? "정복" : "—";
  $("result-cta").textContent = win ? (sc.winScene?.historicalNote || "") : (sc.loseScene?.encouragement || "");

  // 이번 판 획득 철학 카드 + 내 반박(작업2: "이 철학을, 나는 이런 말로 지켜냈다")
  const rc = $("result-cards");
  rc.innerHTML = rev.cardsWon.length
    ? `<div class="rc-title">철학 카드 ${rev.cardsWon.length}장 획득</div>` +
      rev.cardsWon.map((c) =>
        `<div class="rev-won"><span class="rc-chip">🃏 ${c.card}</span><small class="rev-won-input">“${c.myInput.slice(0, 60)}${c.myInput.length > 60 ? "…" : ""}”</small></div>`
      ).join("")
    : `<div class="rc-title muted">획득한 철학 카드가 없습니다</div>`;

  $("save-card").style.display = ""; // 역모드 공유 카드(작업4) 지원
  show("scr-result");
  const seal = $("win-seal");
  seal.classList.remove("stamped");
  $("result-card").classList.remove("pop-in");
  if (win) {
    requestAnimationFrame(() => {
      $("result-card").classList.add("pop-in"); // 카드 팝인
      seal.classList.add("stamped");            // 낙관 쾅
      burstConfetti();                          // 축하 꽃가루
    });
  }
}

// 패배 놀림 대사 픽(배열에서 seed로 결정론적 선택)
const pickTaunt = (arr, seed = 0) => (arr && arr.length) ? arr[Math.abs(seed) % arr.length] : null;

function endGame() {
  const won = state.status === "WIN";
  const scn = chars[charId].scenario;
  $("result-title").textContent = won ? "설득 성공" : "다시 도전";
  const rl = $("result-line");
  if (won) {
    rl.textContent = firstInputSaved ? `“${firstInputSaved}”` : "";
    rl.classList.remove("taunt");
  } else {
    // 패배 = 인물이 의기양양하게 놀린다(킹받는 엔딩 → 복수심 재도전)
    const t = pickTaunt(scn.loseScene?.taunt, state.turn + (firstInputSaved.length || 0)) || scn.loseScene?.text || "";
    rl.textContent = `${chars[charId].profile.displayName}: "${t}"`;
    rl.classList.add("taunt");
  }
  $("result-turns").textContent = state.turn + "턴";
  $("result-grade").textContent = won ? resultBand(state.turn, cfg) : "—";
  const note = won ? scn.winScene?.historicalNote : scn.loseScene?.historicalNote;
  $("result-cta").textContent = note || "";

  // 보너스 힌트 정산: 기본 예산을 초과해 쓴 만큼만 차감
  const used = (state.baseBudget + state.bonusAvail) - state.hintsLeft;
  const bonusSpent = Math.max(0, used - state.baseBudget);
  if (bonusSpent > 0) {
    const b = loadBonus();
    b[difficulty] = Math.max(0, (b[difficulty] || 0) - bonusSpent);
    saveBonus(b);
  }

  // 승리 보상: 사료 카드 도감 수집 + 다음 난이도용 보너스 힌트 카드
  const rc = $("result-cards");
  if (won) {
    const prev = new Set(loadDogam()[charId] || []);
    const got = [...(state.collected || [])];
    const fresh = got.filter((id) => !prev.has(id));
    addToDogam(charId, got);
    let html = fresh.length
      ? `<div class="rc-title">사료 카드 ${fresh.length}장 획득</div>` +
        fresh.map((id) => `<span class="rc-chip">${fragTopic(charId, id)}</span>`).join("")
      : `<div class="rc-title muted">이미 모은 사료였습니다</div>`;

    // 클리어 보상: 다음 난이도용 힌트 카드 +1 (난이도별 보유 상한 BONUS_CAP)
    const next = NEXT_DIFF[difficulty];
    if (next) {
      const b = loadBonus();
      if ((b[next] || 0) < BONUS_CAP) {
        b[next] = (b[next] || 0) + 1;
        saveBonus(b);
        html += `<div class="rc-bonus">🎁 보상 카드 — <b>${DIFF_LABEL[next]}</b> 난이도 힌트 <b>+1</b><small>다음 ${DIFF_LABEL[next]} 도전 시 힌트 예산에 자동 합산 (보유 ${b[next]}/${BONUS_CAP})</small></div>`;
      } else {
        html += `<div class="rc-bonus muted">🎁 ${DIFF_LABEL[next]} 힌트 카드 보유 한도 도달 (${BONUS_CAP}/${BONUS_CAP})</div>`;
      }
    }
    rc.innerHTML = html;
  } else rc.innerHTML = "";

  show("scr-result");
  const seal = $("win-seal");
  seal.classList.remove("stamped");
  $("result-card").classList.remove("pop-in");
  if (won) {
    requestAnimationFrame(() => {
      $("result-card").classList.add("pop-in"); // 카드 팝인
      seal.classList.add("stamped");            // 낙관 쾅
      burstConfetti();                          // 축하 꽃가루
    });
  }
}

// ── 축하 꽃가루(승리 시) — 의존성 없는 경량 캔버스 애니메이션 ──
function burstConfetti() {
  const host = $("scr-result");
  const cv = document.createElement("canvas");
  cv.className = "confetti";
  cv.width = host.clientWidth; cv.height = host.clientHeight;
  host.appendChild(cv);
  const g = cv.getContext("2d");
  const colors = ["#a8322a", "#ad8234", "#2f6f9e", "#e8c96a", "#fdf6e6"];
  const parts = Array.from({ length: 90 }, () => ({
    x: cv.width / 2 + (Math.random() - 0.5) * cv.width * 0.4,
    y: cv.height * 0.35,
    vx: (Math.random() - 0.5) * 11,
    vy: -(4 + Math.random() * 9),
    w: 6 + Math.random() * 6, h: 4 + Math.random() * 5,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  let frame = 0;
  (function tick() {
    g.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
      g.fillStyle = p.c; g.globalAlpha = Math.max(0, 1 - frame / 120);
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (++frame < 130) requestAnimationFrame(tick);
    else cv.remove();
  })();
}

// ── 사료 도감 렌더 (정방향 사료 카드 + 역모드 철학 카드 통합) ──
function renderDogam() {
  const d = loadDogam();
  const rd = loadRevDogam();
  const el = $("dogam-list");
  const entries = Object.entries(d).filter(([, ids]) => ids && ids.length);
  const revEntries = Object.entries(rd).filter(([, cards]) => cards && Object.keys(cards).length);

  if (!entries.length && !revEntries.length) {
    el.innerHTML = `<p class="dogam-empty">아직 모은 카드가 없어요.<br />인물을 설득해 사료 카드를, 철학을 지켜 철학 카드를 모아보세요.</p>`;
    return;
  }

  // 정방향: 사료 카드
  let html = entries.map(([cid, ids]) => {
    const ch = chars[cid]; if (!ch) return "";
    const cards = ids.map((id) => ch.knowledge.fragments.find((f) => f.id === id)).filter(Boolean);
    return `<div class="dogam-group"><h3>${ch.profile.displayName} · ${cards.length}장</h3>` +
      cards.map((f) => `<div class="dogam-card"><div class="dc-topic">${f.topic}</div><div class="dc-content">${f.content}</div><div class="dc-src">${f.source.split("/")[0].slice(0, 46)}</div></div>`).join("") +
      `</div>`;
  }).join("");

  // 역모드: 철학 카드 — 전체 슬롯(획득/🔒미획득) + 등급 + 진척도("이 철학을 나는 이런 말로 지켜냈다")
  const revChars = Object.keys(chars).filter((id) => chars[id].cards);
  html += revChars.map((cid) => {
    const data = chars[cid].cards;
    const name = data.figure?.displayName || cid;
    const args = data.arguments || [];
    const earned = rd[cid] || {};
    const owned = Object.keys(earned).length;
    const gold = Object.values(earned).filter((c) => c.grade === "gold").length;
    return `<div class="dogam-group dogam-group--rev">` +
      `<h3>🃏 ${name} 철학 카드 · ${owned}/${args.length} <small class="dg-prog">골드 ${gold}/${args.length}</small></h3>` +
      `<div class="phil-grid">` +
      args.map((a) => {
        const c = earned[a.id];
        if (!c) return `<div class="phil-slot locked"><div class="ps-name">🔒 ？？？</div><div class="ps-phil">아직 못 지킨 철학</div></div>`;
        return `<div class="phil-slot card-${c.grade}">` +
          `<div class="ps-grade">${GRADE_KO[c.grade]}</div>` +
          `<div class="ps-name">${c.card}</div>` +
          `<div class="ps-phil">${(c.philosophy || "").split("—")[0].trim()}</div>` +
          `<div class="ps-mine">내 반박 — “${c.myInput}”</div>` +
          `</div>`;
      }).join("") +
      `</div></div>`;
  }).join("");

  el.innerHTML = html;
}

// 시작 시 판정 프록시 health 체크 → 서버가 없거나 키가 없으면 드롭다운을 자동 조정
async function checkHealth() {
  const sel = $("provider");
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const h = await res.json();
    // 현재 선택된 provider의 키가 서버에 없으면 사용 가능한 쪽으로 전환.
    // (오프라인은 UI 선택지가 아니라 비상 폴백 — getVerdict의 catch가 자동 처리)
    if (sel.value === "gpt" && !h.providers?.gpt && h.providers?.claude) sel.value = "claude";
    else if (sel.value === "claude" && !h.providers?.claude && h.providers?.gpt) sel.value = "gpt";
  } catch (_) {
    // 프록시 서버 미실행 → 드롭다운은 그대로 두고, 판정 시 오프라인으로 자동 폴백
    console.warn("[EXTRA] 판정 프록시 응답 없음 → 오프라인 판정으로 폴백");
  }
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

// ── 베끼기 응징: 사료 원문을 그대로 옮기면 통하지 않음 → 화면 깜빡 + 2턴 되돌림 ──
// "낭독은 설득이 아니다." 사료를 자기 논거로 풀어 쓰게 강제한다.
const normText = (s) => (s || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
// 최장 공통 부분수열 길이(어미만 바꾼 복붙도 대부분 순서대로 남아 잡힘)
function lcsLen(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++)
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    const t = prev; prev = cur; cur = t; cur.fill(0);
  }
  return prev[m];
}
// 입력이 어떤 사료 조각을 거의 그대로 옮겼는가(조각 길이의 70% 이상을 순서대로 재현 + 최소 22자)
function isParroting(input) {
  const ni = normText(input);
  if (ni.length < 22) return false;
  const frags = chars[charId]?.knowledge?.fragments || [];
  for (const f of frags) {
    const nf = normText(f.content);
    if (nf.length < 24) continue;
    const l = lcsLen(nf, ni);
    if (l >= 22 && l / nf.length >= 0.7) return true;
  }
  return false;
}

// 현재 상태 스냅샷(엔진이 불변 객체를 반환하므로 얕은 복사 + 컬렉션만 새로 생성)
function snapshot() {
  return {
    gauge: state.gauge, turn: state.turn, consecutiveBad: state.consecutiveBad, status: state.status,
    hintIdx: state.hintIdx, hintsLeft: state.hintsLeft, baseBudget: state.baseBudget, bonusAvail: state.bonusAvail,
    coveredAxes: new Set(state.coveredAxes), collected: new Set(state.collected),
    history: state.history.slice(), turnLog: state.turnLog.slice(), firstInputSaved,
  };
}
function restore(s) {
  Object.assign(state, {
    gauge: s.gauge, turn: s.turn, consecutiveBad: s.consecutiveBad, status: s.status,
    hintIdx: s.hintIdx, hintsLeft: s.hintsLeft, baseBudget: s.baseBudget, bonusAvail: s.bonusAvail,
    coveredAxes: new Set(s.coveredAxes), collected: new Set(s.collected),
    history: s.history.slice(), turnLog: s.turnLog.slice(),
  });
  firstInputSaved = s.firstInputSaved;
}

function flashScreen() {
  const sc = $("scr-chat");
  const fx = document.createElement("div");
  fx.className = "parrot-flash";
  sc.appendChild(fx);
  sc.classList.add("shake");
  setTimeout(() => { fx.remove(); sc.classList.remove("shake"); }, 600);
}
function parrotToast() {
  const sc = $("scr-chat");
  const t = document.createElement("div");
  t.className = "parrot-toast";
  t.innerHTML = `✋ <b>베끼기는 통하지 않는다</b><br/><small>사료를 그대로 옮기지 말고, 네 논거로 설득하라 · 2턴 되돌림</small>`;
  sc.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, 2200);
}
// 베끼기 응징 실행: 방금 입력을 잠깐 보여준 뒤 깜빡이고 2턴 전 상태로 복원
function punishParrot(input) {
  addLine("나: " + input, "me");
  flashScreen();
  parrotToast();
  const target = Math.max(0, snaps.length - 1 - PARROT_ROLLBACK);
  setTimeout(() => {
    restore(snaps[target]);
    snaps.length = target + 1;
    retone();            // turnLog로 로그 재구성 → 베낀 줄 제거
    renderGauge(); renderAxisTrack(); updateScene(); renderHintBtn();
  }, 850);
}

async function onTurn(e) {
  e.preventDefault();
  const input = $("turn-input").value.trim();
  if (!input || state.status !== "CONTINUE") return;
  $("turn-input").value = "";
  if (isParroting(input)) { punishParrot(input); return; }
  if (!firstInputSaved) firstInputSaved = input;
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
  updateScene();
  maybeUnlockHint();
  renderHintBtn();

  if (state.status === "CONTINUE") { snaps.push(snapshot()); saveGame(); } // 되돌리기용 스냅샷 + 자동 저장
  else clearSave(charId); // 승부가 나면 저장 정리

  // 종료 시: 인물의 마지막 대사를 읽을 시간을 준다 → ▶ 클릭 또는 7초 후 자동 진행
  if (state.status !== "CONTINUE") showEndGate();
}

// ── 종료 게이트: 마지막 대사 확인 후 '결과 보기 ▶' 클릭으로만 진행(자동 진행 없음) ──
// win: 승리 여부, onGo: 결과화면으로 넘길 때 부를 함수(기본=정방향 endGame)
function showEndGate(win = state?.status === "WIN", onGo = endGame) {
  $("turn-input").disabled = true;
  $("turn-form").querySelector("button[type=submit]").disabled = true;
  const gate = document.createElement("button");
  gate.type = "button";
  gate.id = "end-gate";
  gate.className = "end-gate";
  gate.innerHTML = `<span class="eg-label">${win ? "설득이 통했다!" : "설득이 끝났다…"}</span><span class="eg-arrow">결과 보기 ▶</span>`;
  $("log").appendChild(gate);
  $("log").scrollTop = $("log").scrollHeight;
  gate.addEventListener("click", () => {
    $("turn-input").disabled = false;
    $("turn-form").querySelector("button[type=submit]").disabled = false;
    onGo();
  }, { once: true });
}

// 판정 결과(대사+출처+등급) 렌더
// ── 탁월(최고 등급) 특수 연출 ── "AI가 진짜 반응했다"는 와우 모먼트: 금빛 번쩍 + "✨ 탁월 ✨" 팝.
// 탁월은 GPT/Claude가 여러 축을 꿰뚫는 뛰어난 논거에만 주는 희소 등급 → 뜨면 크게 보상.
function excellentBurst(label = "탁월") {
  const sc = $("scr-chat");
  const fx = document.createElement("div");
  fx.className = "excellent-fx";
  fx.innerHTML = `<span class="ex-flash"></span><span class="ex-word">✨ ${label} ✨</span>`;
  sc.appendChild(fx);
  sc.classList.add("ex-shake");
  setTimeout(() => { fx.remove(); sc.classList.remove("ex-shake"); }, 1300);
}

function renderVerdict(v) {
  addLine(v.line, "npc");
  addSources(v.sources);
  const tag = { 탁월: "+50", 정합: "+35", 부분: "+15", 불합치: "0", 역효과: "-20" }[v.grade];
  const p = v.provider && v.provider !== "offline" ? " · " + v.provider : "";
  const excellent = v.grade === "탁월";
  addLine(`[${excellent ? "✨ 탁월 ✨" : v.grade} ${tag}${p}]`, "grade-tag" + (excellent ? " grade-tag--excellent" : ""));
  if (excellent) excellentBurst();
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

// ── 힌트 시스템: 난이도별 예산(이지3/미디움2/하드1), 자동+수동 병행 ──
// 자동: 연속 실패(trigger_fail_count)마다 / 수동: 틀린 직후 활성화되는 💡 버튼.
// 둘 다 같은 예산(state.hintsLeft)을 소모한다.

// 다음 순서의 사료 카드를 힌트로 연다(도감에도 수집). 성공 시 true.
function unlockHint() {
  if (state.status !== "CONTINUE") return false;
  if ((state.hintsLeft ?? 0) <= 0) return false;
  const order = cfg.hint_unlock?.order?.[charId] || chars[charId].knowledge.fragments.map((f) => f.id);
  if (state.hintIdx >= order.length) return false;
  const f = chars[charId].knowledge.fragments.find((x) => x.id === order[state.hintIdx]);
  state.hintIdx++;
  if (!f) return false;
  state.hintsLeft--;
  state.consecutiveBad = 0; // 힌트 후 카운터 리셋(6연속 실패 패배와 밸런스 유지)
  state.collected.add(f.id); // 힌트로 얻은 사료도 도감에
  state.turnLog.push({ type: "hint", fragId: f.id });
  addHintCard(f);
  renderHintBtn();
  return true;
}

// 자동 힌트: 연속 실패가 트리거에 도달하면 예산에서 차감하며 자동 공개
function maybeUnlockHint() {
  if (state.status !== "CONTINUE") return;
  const trig = cfg.hint_unlock?.trigger_fail_count || 3;
  if ((state.consecutiveBad || 0) < trig) return;
  unlockHint();
}

// 수동 힌트 버튼: 직전 판정이 틀렸을 때(불합치/역효과)만 활성화
function renderHintBtn() {
  const btn = $("hint-btn");
  if (!btn) return;
  const left = state?.hintsLeft ?? 0;
  const wrong = (state?.consecutiveBad || 0) > 0; // 직전 답이 틀렸는가
  const usable = state && state.status === "CONTINUE" && left > 0 && wrong;
  btn.textContent = `💡 ${left}`;
  btn.disabled = !usable;
  btn.title = usable
    ? `사료 힌트 보기 (남은 힌트 ${left}개)`
    : left <= 0 ? "힌트를 모두 사용했습니다" : "틀린 판정이 나오면 힌트를 쓸 수 있어요";
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
// 역모드 공유 카드(작업4): 지킨 철학 카드 + 대표 반박(첫 strong)
function buildRevShareCard() {
  const win = rev.gauge >= rev.goal;
  const figure = rev.cards.figure || {};
  const seal = "#a8322a", gold = "#ad8234", ink = "#221d15", accent = "#5a4b8a";
  const W = 1080, H = 1350, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");

  g.fillStyle = "#f4ecd7"; g.fillRect(0, 0, W, H);
  g.strokeStyle = gold; g.lineWidth = 3; g.strokeRect(40, 40, W - 80, H - 80);
  g.strokeStyle = "#cdbf9d"; g.lineWidth = 1.5; g.strokeRect(54, 54, W - 108, H - 108);
  g.fillStyle = accent; g.fillRect(54, 54, W - 108, 10);

  g.textBaseline = "top"; g.textAlign = "left";
  g.fillStyle = ink; g.font = "800 46px 'Nanum Myeongjo', serif"; g.fillText("EXTRA", 92, 96);
  g.fillStyle = "#7c7059"; g.font = "500 24px 'Noto Sans KR', sans-serif"; g.fillText("번외 · 역설득", 94, 152);
  g.save(); g.translate(W - 138, 132); g.rotate(-0.12);
  g.fillStyle = seal; roundRect(g, -46, -34, 92, 100, 10); g.fill();
  g.fillStyle = "#fff"; g.font = "800 42px 'Nanum Myeongjo', serif"; g.textAlign = "center";
  g.fillText("端", 0, -20); g.fillText("役", 0, 24); g.restore();

  g.textAlign = "center";
  g.fillStyle = seal; g.font = "800 66px 'Nanum Myeongjo', serif";
  g.fillText(win ? "철학을 지켰다" : "흔들렸다", W / 2, 290);
  g.fillStyle = ink; g.font = "700 42px 'Nanum Myeongjo', serif"; g.fillText(figure.displayName || "미야모토", W / 2, 384);
  g.fillStyle = "#7c7059"; g.font = "400 26px 'Noto Sans KR', sans-serif";
  g.fillText(`철학 이해도 ${rev.gauge} · 카드 ${rev.cardsWon.length}장`, W / 2, 440);

  // 획득 철학 카드 목록
  let y = 540;
  g.font = "700 34px 'Nanum Myeongjo', serif";
  for (const c of rev.cardsWon.slice(0, 5)) {
    g.fillStyle = "#fff8ea";
    roundRect(g, 160, y - 12, W - 320, 64, 12); g.fill();
    g.strokeStyle = gold; g.lineWidth = 2; roundRect(g, 160, y - 12, W - 320, 64, 12); g.stroke();
    g.fillStyle = gold; g.fillText(c.card, W / 2, y);
    y += 92;
  }
  if (!rev.cardsWon.length) {
    g.fillStyle = "#9a9078"; g.font = "400 30px 'Noto Sans KR', sans-serif";
    g.fillText("획득한 철학 카드가 없다", W / 2, y); y += 92;
  }

  // 대표 반박: 첫 strong(가장 먼저 철학을 지켜낸 말)
  const rep = rev.cardsWon[0]?.myInput || rev.log.find((l) => l.outcome === "strong")?.myInput;
  if (rep) {
    g.fillStyle = "#4a4132"; g.font = "italic 32px 'Nanum Myeongjo', serif";
    wrapText(g, `“${rep}”`, W - 280).slice(0, 3).forEach((ln, i) => g.fillText(ln, W / 2, y + 26 + i * 46));
  }

  g.fillStyle = seal; g.font = "700 40px 'Nanum Myeongjo', serif"; g.fillText("당신의 철학은 흔들리지 않는가?", W / 2, 1130);
  g.fillStyle = "#9a9078"; g.font = "400 24px 'Noto Sans KR', sans-serif"; g.fillText("EXTRA · 역사에 끼어든 단역", W / 2, 1210);
  g.textAlign = "left";
  return cv;
}

async function saveCard() {
  try { await document.fonts.ready; } catch (_) {}
  const cardCv = (rev && rev.done) ? buildRevShareCard() : buildShareCard();
  cardCv.toBlob(async (blob) => {
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

// 유적 클릭: 역설득 인물(cards.json)이면 역모드, 아니면 정방향(저장 있으면 이어하기)
document.querySelectorAll(".relic[data-char]").forEach((b) =>
  b.addEventListener("click", () => {
    const id = b.dataset.char;
    if (isReverseChar(id)) startReverse(id);
    else startGame(id, !!loadSaves()[id]);
  })
);
// 폼 제출: 역모드 진행 중이면 역판정, 아니면 정방향
$("turn-form").addEventListener("submit", (e) => { (rev && !rev.done) ? onReverseTurn(e) : onTurn(e); });
$("hint-btn").addEventListener("click", () => unlockHint()); // 수동 힌트(예산 차감)
$("save-card").addEventListener("click", saveCard);
$("retry").addEventListener("click", () => { rev = null; refreshMapSaves(); show("scr-map"); });
// 뒤로가기: 진행 자동 저장 후 지도로 (역모드는 저장 없이 나감)
$("back-map").addEventListener("click", () => { if (!rev) saveGame(); rev = null; refreshMapSaves(); show("scr-map"); });
// 말투 슬라이딩 스위치(정통↔밈): 즉시 로그를 새 말투로 리렌더
$("tone-toggle").addEventListener("click", () => {
  tone = tone === "classic" ? "meme" : "classic";
  syncToneUI();
  if (state) { retone(); updateScene(); } // 로그 리렌더 + 캐릭터 시리즈 교체(정통↔밈)
});
// 난이도 선택
document.querySelectorAll("#diff-select .diff").forEach((b) =>
  b.addEventListener("click", () => { difficulty = b.dataset.diff; syncDiffUI(); })
);
// 사료 도감
$("open-dogam").addEventListener("click", () => { renderDogam(); show("scr-dogam"); });
$("close-dogam").addEventListener("click", () => { refreshMapSaves(); show("scr-map"); });
// 탭을 닫거나 새로고침해도 진행 보존
window.addEventListener("pagehide", saveGame);
window.addEventListener("beforeunload", saveGame);
// 판정 프록시 상태 확인(비동기 — 실패해도 게임엔 지장 없음)
checkHealth();
refreshMapSaves(); // 시작 시 이어하기 표시 반영
