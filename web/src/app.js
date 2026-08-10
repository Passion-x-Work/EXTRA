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
let deckSel = new Set(), deckCharId = null;          // 덱 편성 선택 상태(레거시)
const DECK_MAX = 3;                                  // 덱 최대 장수(레거시)
let dogamFrom = null;                                // "chat"이면 대화 중 도감 → 카드 '쓰기' 노출·복귀

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

// 두 문장의 유사도(0~1) — 글자 2-gram Jaccard. 공백·문장부호 무시. 짧은 한글 반박 비교용.
function simRatio(a, b) {
  const norm = (s) => (s || "").toLowerCase().replace(/[\s.,!?~…"'“”·]/g, "");
  const grams = (s) => { const g = new Set(); if (s.length < 2) { if (s) g.add(s); return g; } for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const A = grams(norm(a)), B = grams(norm(b));
  if (!A.size || !B.size) return norm(a) === norm(b) ? 1 : 0;
  let inter = 0; A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

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
// 구조: d[cid] = { [fragId]: "classic"|"meme" }  (그 카드를 '어느 말투로' 얻었는지 기록 — 앞면 이미지 결정)
// 구버전(배열)도 자동 승격. 반환은 [{ id, tone }] 정규형.
function dogamCards(cid, d = loadDogam()) {
  const raw = d[cid];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((id) => ({ id, tone: "classic" })); // 구버전: 말투 미기록 → 정통 취급
  return Object.entries(raw).map(([id, v]) => ({ id, tone: (typeof v === "string" ? v : v?.tone) || "classic" }));
}
function addToDogam(cid, ids, tn = "classic") {
  const d = loadDogam();
  let cur = d[cid];
  if (Array.isArray(cur)) { const o = {}; cur.forEach((id) => (o[id] = "classic")); cur = o; } // 배열 → 객체 승격
  if (!cur || typeof cur !== "object") cur = {};
  ids.forEach((id) => { if (!cur[id]) cur[id] = tn; }); // 이미 있으면 최초 획득 말투 유지
  d[cid] = cur;
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

// 사료 카드 앞면 표정: 같은 인물이라도 카드마다 다른 Phase(1~5) — id 해시로 결정론적 분산
const fragPhase = (id) => ([...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) + 1;

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
  snaps = [snapshot()]; // 시작(또는 복원) 스냅샷 = 되돌리기 하한
  show("scr-chat");
  if (resuming && state.turnLog.length) { retone(); $("turn-input").focus(); } // 이어하기: 로그 재구성(인트로 생략)
  else {
    const opening = scenario.openingLines?.[tone] || scenario.openingLines?.classic || "…";
    // 새 게임: 상황설정 인트로 타이핑 → 끝나면 인물 첫 대사(intro 없으면 바로 대사)
    playIntro(scenario.intro || [], () => { addLine(opening, "npc"); $("turn-input").focus(); });
  }
}

// ══════════ 번외: 역설득 흐름 (AI가 먼저 논거 → 반박 → 판정 → 다음 논거) ══════════
function renderRevGauge() {
  const g = Math.max(0, Math.min(100, rev.gauge));
  $("gauge-fill").style.width = g + "%";
  $("gauge-num").textContent = g;
  $("turn-count").textContent = `논거 ${Math.min(rev.index + 1, rev.cards.arguments.length)}/${rev.cards.arguments.length}`;
}

function startReverse(id, deck = null) {
  charId = id;
  const wc = chars[id].cards.winCondition || {};
  rev = { cards: chars[id].cards, scenario: chars[id].scenario, index: 0,
        gauge: wc.startGauge ?? REV_START_DEFAULT, goal: wc.goalGauge ?? REV_GOAL_DEFAULT,
        maxRebuttals: wc.maxRebuttals ?? 2, attempt: 0, speaker: null, done: false,
        log: [], cardsWon: [], usingCard: false, usedCards: 0, deck };
  state = null; snaps = [];
  $("log").innerHTML = "";
  $("scr-chat").dataset.theme = id;
  $("win-seal").classList.remove("stamped");
  $("axis-track").style.display = "none"; // 역모드엔 축 트랙 없음
  $("hint-btn").style.display = "none";   // MVP: 힌트 없음
  $("turn-input").placeholder = "받아칠지, 수긍할지 입력…";
  // 헤더를 첫 화자로 즉시 세팅(인트로 동안 이전 인물 이름이 남지 않게)
  { const a0 = rev.cards.arguments[0]; const p0 = rev.cards.personas.find((x) => x.id === a0?.speaker);
    $("char-name").textContent = p0?.name || rev.cards.figure?.displayName || "";
    $("char-diff").textContent = p0?.role || rev.scenario?.timeLabel || ""; }
  $("turn-input").disabled = false;
  $("turn-form").querySelector("button[type=submit]").disabled = false;
  $("char-portrait").src = ""; // 이미지 대기(자동 숨김)
  updateScene();
  renderRevGauge();
  show("scr-chat");
  // 도입부: 검은 화면에 나레이션을 타이핑으로 쫘르륵 → 끝나면 사라지고 첫 논거 시작
  playIntro(rev.scenario?.intro || [], () => { revOpen(0); $("turn-input").focus(); });
}

// 역모드 진입 인트로: 검은 화면 타이핑 연출. 다 나오면 자동으로(또는 탭하면 즉시) 사라지고 게임 시작.
function playIntro(lines, onDone) {
  if (!lines || !lines.length) { onDone && onDone(); return; }
  const ov = document.createElement("div");
  ov.className = "rev-intro";
  ov.innerHTML = `<div class="ri-text"></div><div class="ri-skip">탭하여 건너뛰기</div>`;
  $("scr-chat").appendChild(ov);
  const textEl = ov.querySelector(".ri-text");
  let li = 0, done = false, timer = null;
  const finish = () => {
    if (done) return; done = true; clearTimeout(timer);
    ov.classList.add("out");
    setTimeout(() => { ov.remove(); onDone && onDone(); }, 450);
  };
  const nextLine = () => {
    if (li >= lines.length) { ov.querySelector(".ri-skip").textContent = "탭하여 시작 ▶"; timer = setTimeout(finish, 1500); return; }
    const p = document.createElement("p"); p.className = "ri-line typing"; textEl.appendChild(p);
    const line = lines[li++]; let ci = 0;
    const type = () => {
      p.textContent = line.slice(0, ++ci);
      textEl.scrollTop = textEl.scrollHeight;
      if (ci < line.length) timer = setTimeout(type, 26);
      else { p.classList.remove("typing"); timer = setTimeout(nextLine, 520); }
    };
    type();
  };
  ov.addEventListener("click", finish); // 탭 = 건너뛰기(바로 시작)
  nextLine();
}

// 첫 획득 카드 플립 리빌: 뒤집히며 등장(획득 순간의 도파민). 논리 흐름을 막지 않고 위에 겹쳐 보여줌.
function revCardReveal(card, grade, philosophy) {
  const ov = document.createElement("div");
  ov.className = "card-reveal";
  ov.innerHTML =
    `<div class="cr-card card-${grade}">` +
      `<div class="cr-face cr-back">🃏</div>` +
      `<div class="cr-face cr-front card-${grade}">` +
        `<div class="cr-badge">NEW</div>` +
        `<div class="cr-grade">${GRADE_KO[grade]}</div>` +
        `<div class="cr-name">${card}</div>` +
        `<div class="cr-phil">${(philosophy || "").split("—")[0].trim()}</div>` +
        `<div class="cr-tag">철학 카드 획득</div>` +
      `</div>` +
    `</div>`;
  $("scr-chat").appendChild(ov);
  let done = false;
  const close = () => { if (done) return; done = true; ov.classList.add("out"); setTimeout(() => ov.remove(), 350); };
  const t = setTimeout(close, 1900);
  ov.addEventListener("click", () => { clearTimeout(t); close(); });
}

// 역모드 화자 초상: Assets/Reverse/<speaker>-<tone>-<mood>.webp (파일 없으면 자동 숨김)
const REV_SPEAKER_ID = { "하루": "haru", "쿠로다": "kuroda" };
function revPortrait(speaker, mood = "neutral") {
  const sid = REV_SPEAKER_ID[speaker] || "haru";
  if (rev) rev.mood = mood; // 현재 표정 저장(톤 토글 시 같은 표정으로 재로드)
  fadePortrait($("char-portrait"), `/Assets/Reverse/${sid}-${tone}-${mood}.webp`);
}
// 화자별 말풍선 클래스(S4 캐릭터 대비: 하루=따뜻/열정, 쿠로다=차가움/데이터)
const revSpeakerCls = (speaker) => REV_SPEAKER_ID[speaker] === "kuroda" ? "npc--kuroda" : "npc--haru";

// 카드 사용 제안: 이 논거에 대해 이전에 모은 철학 카드가 있으면, 내 반박을 꺼내 쓸 수 있게 칩 노출.
// 사용 시 저장된 반박이 자동입력되고(수정 가능), 제출하면 감쇠(60%) 적용 + '카드 의존' 기록.
function offerCard(argId) {
  const saved = loadRevDogam()[charId]?.[argId];
  if (!saved || !saved.myInput) return;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `card-use-chip card-${saved.grade || "silver"}`;
  chip.innerHTML = `🃏 <b>${saved.card}</b> 꺼내 쓰기 <small>(감쇠 60%)</small>`;
  chip.addEventListener("click", () => {
    $("turn-input").value = saved.myInput;
    rev.usingCard = true;
    chip.remove();
    $("turn-input").focus();
  });
  $("log").appendChild(chip);
  $("log").scrollTop = $("log").scrollHeight;
}

// 대화 중 도감에서 카드 '쓰기' → 입력창에 채우고 대화로 복귀
function useSaryoCard(content) { // 정방향: 사료 사실을 논거로
  dogamFrom = null; show("scr-chat");
  const inp = $("turn-input"); inp.value = content; inp.focus();
}
function useRebuttalCard(myInput) { // 역방향: 저장한 반박 꺼내 쓰기(감쇠 적용)
  if (rev && !rev.done) rev.usingCard = true;
  dogamFrom = null; show("scr-chat");
  const inp = $("turn-input"); inp.value = myInput; inp.focus();
}

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
  const showArg = () => {
    $("char-name").textContent = t.speaker;
    $("char-diff").textContent = t.speakerRole || rev.scenario?.timeLabel || "";
    addLine(`${t.speaker}: "${t.aiLine}"`, "npc " + revSpeakerCls(t.speaker)); // 화자별 말풍선 대비(S4)
    revPortrait(t.speaker, "neutral");
    renderRevGauge();
    offerCard(t.argId); // 이전에 모은 카드가 있으면 '카드 사용' 제안
  };
  // 화자/장면 전환(브릿지)은 검은 타이핑 오버레이로 — 읽고 탭하면 대사 시작(전환이 급하지 않게).
  // 첫 논거(0)는 진입 인트로 직후라 브릿지를 인라인으로 처리.
  if (t.bridge && index > 0) playIntro([t.bridge], showArg);
  else { if (t.bridge) addBridge(t.bridge); showArg(); }
}

// 플레이어 반박 판정(프록시 → 실패 시 오프라인 폴백) + 멀티턴 흐름
async function onReverseTurn(e) {
  e.preventDefault();
  const input = $("turn-input").value.trim();
  if (!input || !rev || rev.done) return;
  $("turn-input").value = "";
  const reused = !!rev.usingCard; rev.usingCard = false; // 카드 사용 여부(감쇠 적용)
  const preGauge = rev.gauge;
  addLine((reused ? "나 🃏: " : "나: ") + input, "me");
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

  // 카드 재사용 감쇠: 저장한 반박을 그대로 쓰면 리워드 60%만(균형 · 방어 성공 시).
  if (reused && r.defended && r.delta > 0) {
    r.delta = Math.round(r.delta * 0.6);
    r.gauge = Math.max(0, Math.min(100, preGauge + r.delta));
    rev.usedCards = (rev.usedCards || 0) + 1;
  }
  rev.gauge = r.gauge;
  addLine(r.verdict.line, "npc");
  const excellent = r.verdict.grade === "탁월" && !reused; // 재사용은 탁월 연출 제외
  const tagLabel = (excellent               ? `[✨ 탁월 방어 +${r.delta} ✨]`
                 : r.outcome === "strong"  ? `[방어 +${r.delta}]`
                 : r.outcome === "weak"    ? `[약한 방어 +${r.delta}]`
                 : `[동조 ${r.delta}]`) + (reused ? " · 🃏카드(감쇠)" : "");
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
  if (r.cardWon && !reused) { // 재사용은 이미 보유한 카드 → 재획득/승급 안 함
    rev.cardsWon.push({ argId: curArg.id, card: r.cardWon, myInput: input, grade });
    const res = addRevCard(curArg.id, r.cardWon, curArg.targetPhilosophy, input, rev.speaker, grade);
    // 획득/승급 연출
    if (res.status === "upgrade")
      addLine(`⬆️ ${r.cardWon} 등급 상승! ${GRADE_KO[res.from]} → ${GRADE_KO[grade]}`, `grade-tag card-toast card-${grade}`);
    else
      addLine(`🃏 ${r.cardWon} 획득 · ${GRADE_KO[grade]}`, `grade-tag card-toast card-${grade}`);
    if (res.status === "new") revCardReveal(r.cardWon, grade, curArg.targetPhilosophy); // 첫 획득 = 플립 리빌
  }

  const lastArg = rev.index + 1 >= rev.cards.arguments.length;

  // strong: 논거 확실히 방어 → 다음 논거(마지막이면 종료)
  if (r.outcome === "strong") {
    if (lastArg) return revEnd(rev.gauge >= rev.goal);
    return void setTimeout(() => revOpen(rev.index + 1), 1600); // 응답 읽을 시간(전환 브릿지 뜨기 전)
  }

  // weak/comply인데 아직 공방 여유 있음 → 같은 화자가 이어간다
  // weak: 각도를 바꿔 재설득 / comply: "정말 넘어온 거냐" 확인(되돌릴 기회)
  rev.attempt++;
  if (rev.attempt < rev.maxRebuttals) {
    const rt = getRetryLine(rev.cards, rev.index, rev.attempt - 1, r.outcome);
    return void setTimeout(() => {
      addLine(`${rt.speaker}: "${rt.line}"`, "npc " + revSpeakerCls(rt.speaker));
      revPortrait(rev.speaker, r.outcome === "comply" ? "smug" : "pressing");
    }, 1200);
  }

  // 공방 소진 → 철학을 놓쳤음을 명시(어떤 카드를 잃었고, 게이지가 어떻게 됐는지)
  const missed = rev.cards.arguments[rev.index];
  addMissedNotice(missed, r.outcome);

  // 다음 논거(마지막이면 종료)
  if (lastArg) return revEnd(rev.gauge >= rev.goal);
  setTimeout(() => revOpen(rev.index + 1), 1900);
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
  $("result-grade").textContent = win ? (rev.usedCards ? "정복 · 카드 의존" : "정복") : "—";
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
    showVictoryClip(); // 승리: 하루/쿠로다 댄스 클립 랜덤
    requestAnimationFrame(() => {
      $("result-card").classList.add("pop-in"); // 카드 팝인
      seal.classList.add("stamped");            // 낙관 쾅
      burstConfetti();                          // 축하 꽃가루
    });
  } else showRevLoseClip(); // 패배: 나를 꺾은 화자의 킹받는 클립(taunt와 세트)
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
    const prev = new Set(dogamCards(charId).map((c) => c.id));
    const got = [...(state.collected || [])];
    const fresh = got.filter((id) => !prev.has(id));
    addToDogam(charId, got, tone); // 지금 말투로 획득 기록(앞면 이미지 결정)
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
    showVictoryClip(); // 승리 클립(해당 인물 클립이 있으면 랜덤 재생)
    requestAnimationFrame(() => {
      $("result-card").classList.add("pop-in"); // 카드 팝인
      seal.classList.add("stamped");            // 낙관 쾅
      burstConfetti();                          // 축하 꽃가루
    });
  } else hideVictoryClip();
}

// ── 결과 클립: 인물별 클립 풀에서 랜덤 재생(webm 우선 + mp4 폴백) ──
// 소리 포함. 결과 화면은 '결과 보기 ▶' 클릭 직후라 대부분 소리 재생 허용되지만,
// 정책상 거부되면 음소거로 폴백해 영상은 항상 나오게 한다.
// 난이도별 승리 클립. 값이 배열이면 그 안에서 랜덤, 문자열이면 단일 클립.
//   세종·고흐: 난이도마다 다른 안무 1개씩
//   미야모토: easy=쿠로다 part1~3 랜덤 / mid=하루 part1~3 랜덤 / hard=듀오(누끼 합동 댄스)
const VICTORY_CLIPS = {
  sejong: {
    easy: "/Assets/Sejong/victory/SJ-victory-easy",
    mid:  "/Assets/Sejong/victory/SJ-victory-mid",
    hard: "/Assets/Sejong/victory/SJ-victory-hard",
  },
  vangogh: {
    easy: "/Assets/gogh/victory/GH-victory-easy",
    mid:  "/Assets/gogh/victory/GH-victory-mid",
    hard: "/Assets/gogh/victory/GH-victory-hard",
  },
  miyamoto: {
    easy: [1, 2, 3].map((n) => `/Assets/Reverse/victory/KR-victory-part${n}`),
    mid:  [1, 2, 3].map((n) => `/Assets/Reverse/victory/HR-victory-part${n}`),
    hard: "/Assets/Reverse/victory/MYA-victory-duo",
  },
};
// 역모드 패배: 나를 꺾은 화자가 킹받게 놀리는 클립(taunt 대사와 세트)
const LOSE_CLIPS = {
  haru: ["/Assets/Reverse/victory/HR-kingbada"],
  kuroda: ["/Assets/Reverse/victory/KR-kingbada"],
};
function playResultClip(pool) {
  const box = $("victory-clip"), video = $("victory-video");
  if (!box || !video || !pool || !pool.length) { if (box) box.hidden = true; return; }
  const base = pool[Math.floor(Math.random() * pool.length)];
  video.innerHTML =
    `<source src="${base}.webm" type="video/webm" />` +
    `<source src="${base}.mp4" type="video/mp4" />`;
  video.load();
  box.hidden = false;
  video.muted = false;
  video.play().catch(() => { video.muted = true; video.play().catch(() => {}); }); // 소리 거부 시 음소거 폴백
}
// 난이도별 풀 해석: 배열이면 랜덤 픽, 문자열이면 단일. 해당 난이도 항목 없으면 숨김.
function showVictoryClip() {
  const byDiff = VICTORY_CLIPS[charId];
  const entry = byDiff ? byDiff[difficulty] : null;
  playResultClip(Array.isArray(entry) ? entry : entry ? [entry] : null);
}
// 역모드 패배 클립: 마지막 화자(나를 꺾은 쪽)의 kingbada. 없으면 숨김.
const showRevLoseClip = () => playResultClip(LOSE_CLIPS[REV_SPEAKER_ID[rev?.speaker] || ""]);
function hideVictoryClip() {
  const box = $("victory-clip"), video = $("victory-video");
  if (!box || !video) return;
  video.pause(); video.innerHTML = ""; box.hidden = true;
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

// ── 덱 편성 (역모드 진입 전, 모은 카드 중 이번 판에 꺼내 쓸 카드 선택) ──
function openDeck(id) {
  deckCharId = id; deckSel = new Set();
  renderDeck(id);
  show("scr-deck");
}
function renderDeck(id) {
  const data = chars[id].cards;
  const earned = loadRevDogam()[id] || {};
  $("deck-max").textContent = DECK_MAX;
  $("deck-grid").innerHTML = data.arguments.map((a) => {
    const c = earned[a.id];
    if (!c) return `<div class="phil-slot locked"><div class="ps-name">🔒 ？？？</div><div class="ps-phil">미획득</div></div>`;
    const cg = c.grade || "bronze";
    return `<button type="button" class="phil-slot deck-slot card-${cg}" data-arg="${a.id}">` +
      `<div class="ps-grade">${GRADE_KO[cg]}</div>` +
      `<div class="ps-name">${c.card}</div>` +
      `<div class="ps-mine">“${c.myInput.slice(0, 38)}${c.myInput.length > 38 ? "…" : ""}”</div>` +
      `</button>`;
  }).join("");
  $("deck-grid").querySelectorAll(".deck-slot").forEach((b) =>
    b.addEventListener("click", () => {
      const arg = b.dataset.arg;
      if (deckSel.has(arg)) { deckSel.delete(arg); b.classList.remove("selected"); }
      else if (deckSel.size < DECK_MAX) { deckSel.add(arg); b.classList.add("selected"); }
      $("deck-count").textContent = `덱 ${deckSel.size}/${DECK_MAX}`;
    })
  );
  $("deck-count").textContent = `덱 0/${DECK_MAX}`;
}

// ── 사료 도감 렌더 (정방향 사료 카드 + 역모드 철학 카드 통합) ──
function renderDogam() {
  const d = loadDogam();
  const rd = loadRevDogam();
  const el = $("dogam-list");
  const revChars = Object.keys(chars).filter((id) => chars[id].cards);
  const hasRev = revChars.some((cid) => Object.keys(rd[cid] || {}).length);
  // 정방향 사료: [cid, [{id,tone}]] 정규형(구버전 배열 자동 승격)
  const fwd = Object.keys(d).map((cid) => [cid, dogamCards(cid, d)]).filter(([cid, cs]) => chars[cid] && cs.length);

  if (!fwd.length && !hasRev) {
    el.innerHTML = `<p class="dogam-empty">아직 모은 카드가 없어요.<br />인물을 설득해 사료 카드를, 철학을 지켜 철학 카드를 모아보세요.</p>`;
    return;
  }

  // 상단 요약: 모은 총량 한눈에
  const saryoCount = fwd.reduce((n, [, cs]) => n + cs.length, 0);
  const philOwned = revChars.reduce((n, cid) => n + Object.keys(rd[cid] || {}).length, 0);
  const philTotal = revChars.reduce((n, cid) => n + (chars[cid].cards.arguments?.length || 0), 0);
  let html = `<div class="dogam-summary"><span class="ds-chip">📜 사료 ${saryoCount}장</span><span class="ds-chip">🃏 철학 ${philOwned}/${philTotal}</span></div>`;

  // 정방향: 사료 카드 — 작은 썸네일(앞면=인물 이미지, 획득 말투). 누르면 중앙 패널에서 크게 열려 뒤집힘.
  if (fwd.length) {
    const toneKo = { meme: "밈", classic: "정통" };
    html += `<div class="dogam-section">📜 사료 카드</div>`;
    html += fwd.map(([cid, cs]) => {
      const ch = chars[cid]; const a = ASSETS[cid] || {};
      const rows = cs.map((entry) => {
        const f = ch.knowledge.fragments.find((x) => x.id === entry.id);
        if (!f) return "";
        const series = entry.tone === "meme" ? a.meme : a.classic;
        const img = series ? `/Assets/${a.dir}/${series}-Phase0${fragPhase(entry.id)}.webp` : "";
        return `<button type="button" class="saryo-thumb tone-${entry.tone}" data-cid="${cid}" data-frag="${entry.id}" data-tone="${entry.tone}">` +
          `<span class="st-noimg">${ch.profile.displayName}</span>` +
          (img ? `<img class="st-img" src="${img}" alt="" />` : "") +
          `<span class="st-badge">${toneKo[entry.tone] || "정통"}</span>` +
          `<span class="st-topic">${f.topic}</span>` +
        `</button>`;
      }).join("");
      return `<div class="dogam-group"><h3>${ch.profile.displayName} · ${cs.length}장</h3><div class="saryo-grid">${rows}</div></div>`;
    }).join("");
  }

  // 역모드: 철학 카드 — 획득한 것 먼저(등급 높은 순), 🔒 미획득은 뒤로
  html += `<div class="dogam-section">🃏 철학 카드</div>`;
  const KIND_LABEL = { temptation: "달콤한 유혹", trap: "함정", bait: "가짜 명언" };
  // 타로풍 상징(철학별) + 로마숫자. 그림 없으면 이 엠블럼이 폴백.
  const TAROT = { "arg-01": "☀", "arg-02": "🕹", "arg-03": "🏆", "arg-04": "🌙", "arg-05": "🌍" };
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  html += revChars.map((cid) => {
    const data = chars[cid].cards;
    const name = data.figure?.displayName || cid;
    const args = data.arguments || [];
    const personas = data.personas || [];
    const speakerName = (id) => personas.find((p) => p.id === id)?.name || "동료";
    const numOf = {}; args.forEach((x, i) => (numOf[x.id] = ROMAN[i + 1] || ""));
    const earned = rd[cid] || {};
    const owned = Object.keys(earned).length;
    const total = args.length;
    const gold = Object.values(earned).filter((c) => c.grade === "gold").length;
    const pct = total ? Math.round((owned / total) * 100) : 0;
    const mastered = owned === total && total > 0;
    const allGold = mastered && gold === total;
    const ownedSlots = args.filter((a) => earned[a.id]).sort((x, y) => (GRADE_RANK[earned[y.id].grade] || 0) - (GRADE_RANK[earned[x.id].grade] || 0));
    const lockedSlots = args.filter((a) => !earned[a.id]);
    const slot = (a) => {
      const c = earned[a.id];
      const emblem = TAROT[a.id] || "✦";
      const num = numOf[a.id] || "";
      // 미획득 티저: 뒤집힌 타로처럼(엠블럼 감춤) + '누가·어떤 종류'만 흘려 궁금증 유발
      if (!c) return `<div class="phil-slot tarot locked">` +
        `<div class="pt-art"><span class="pt-emblem">🔒</span><span class="pt-num">${num}</span></div>` +
        `<div class="ps-name">？？？</div>` +
        `<div class="ps-phil">${speakerName(a.speaker)}의 ${KIND_LABEL[a.kind] || "설득"}…</div></div>`;
      const cg = c.grade || "bronze"; // 옛 저장 데이터에 등급 없으면 브론즈로(‘undefined’ 표시 방지)
      const useBtn = (dogamFrom === "chat" && rev && !rev.done && cid === charId)
        ? `<button type="button" class="ps-use" data-usecid="${cid}" data-usearg="${a.id}">🃏 이 반박 꺼내 쓰기 <small>(감쇠 60%)</small></button>` : "";
      const art = `<div class="pt-art"><img class="pt-img" src="/Assets/Reverse/tarot/${a.id}.webp" alt="" /><span class="pt-emblem">${emblem}</span><span class="pt-num">${num}</span></div>`;
      return `<div class="phil-slot tarot card-${cg}">` + art +
        `<div class="ps-grade">${GRADE_KO[cg]}</div>` +
        `<div class="ps-name">${c.card}</div>` +
        `<div class="ps-phil">${(c.philosophy || "").split("—")[0].trim()}</div>` +
        `<div class="ps-mine">내 반박 — “${c.myInput}”</div>` +
        useBtn +
        `</div>`;
    };
    // 완성 보상 배너 / 다음 목표 넛지
    const banner = allGold
      ? `<div class="dg-master allgold">👑 완전 정복 · 모든 철학 골드!</div>`
      : mastered
        ? `<div class="dg-master">🏆 도감 완성 · ${name} 마스터<small>남은 목표: ${total - gold}장을 골드로 → 완전 정복</small></div>`
        : `<div class="dg-nudge">다음 목표: <b>${total - owned}장</b> 더 모으면 도감 완성 🏆</div>`;
    return `<div class="dogam-group dogam-group--rev${mastered ? " mastered" : ""}">` +
      `<h3>${name} · ${owned}/${total} <small class="dg-prog">골드 ${gold}/${total}</small></h3>` +
      `<div class="dg-bar"><div class="dg-bar-fill${allGold ? " gold" : ""}" style="width:${pct}%"></div></div>` +
      banner +
      `<div class="phil-grid">` +
      [...ownedSlots, ...lockedSlots].map(slot).join("") +
      `</div></div>`;
  }).join("");

  el.innerHTML = html;
  // 사료 썸네일: 이미지 404 폴백 + 클릭하면 중앙 패널로 크게 열기
  el.querySelectorAll(".saryo-thumb .st-img, .pt-img").forEach((img) => { img.onerror = () => { img.onerror = null; img.style.display = "none"; }; });
  el.querySelectorAll(".saryo-thumb").forEach((btn) =>
    btn.addEventListener("click", () => openSaryoCard(btn.dataset.cid, btn.dataset.frag, btn.dataset.tone)));
  // 역모드 반박 카드 '꺼내 쓰기'(대화 중에만 노출)
  el.querySelectorAll(".ps-use").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const saved = loadRevDogam()[btn.dataset.usecid]?.[btn.dataset.usearg];
      if (saved?.myInput) useRebuttalCard(saved.myInput);
    }));
}

// 사료 카드 확대 패널: 중앙에 크게 열리고, 카드를 누르면 뒤집혀 원문·출처가 보인다.
function openSaryoCard(cid, fragId, tone) {
  const ch = chars[cid]; if (!ch) return;
  const f = ch.knowledge.fragments.find((x) => x.id === fragId); if (!f) return;
  const a = ASSETS[cid] || {};
  const series = tone === "meme" ? a.meme : a.classic;
  const img = series ? `/Assets/${a.dir}/${series}-Phase0${fragPhase(fragId)}.webp` : "";
  const src = (f.source || "").split("/")[0].slice(0, 80);
  const toneKo = tone === "meme" ? "밈" : "정통";
  // 대화 중(이 인물의 정방향 게임 진행 중)이면 '이 사료로 논거 쓰기' 노출
  const canUse = dogamFrom === "chat" && state && !rev && cid === charId;
  const ov = document.createElement("div");
  ov.className = "saryo-modal";
  ov.innerHTML =
    `<button type="button" class="saryo-modal-close" aria-label="닫기">✕</button>` +
    `<button type="button" class="saryo-card big tone-${tone}"><div class="sc-inner">` +
      `<div class="sc-front">` +
        `<span class="sc-noimg">${ch.profile.displayName}</span>` +
        (img ? `<img class="sc-img" src="${img}" alt="" />` : "") +
        `<span class="sc-tone-badge">${toneKo}</span>` +
        `<span class="sc-front-foot">${f.topic}<small>눌러서 뒤집기 ↻</small></span>` +
      `</div>` +
      `<div class="sc-back">` +
        `<div class="sc-topic-b">${f.topic}</div>` +
        `<div class="sc-content">${f.content}</div>` +
        `<div class="sc-src">${src}</div>` +
      `</div>` +
    `</div></button>` +
    (canUse ? `<button type="button" class="saryo-use">📎 이 사료로 논거 쓰기</button>` : "");
  $("app").appendChild(ov);
  if (canUse) ov.querySelector(".saryo-use").addEventListener("click", () => { ov.remove(); useSaryoCard(f.content); });
  const card = ov.querySelector(".saryo-card");
  const imgEl = card.querySelector(".sc-img");
  if (imgEl) imgEl.onerror = () => { imgEl.onerror = null; imgEl.style.display = "none"; };
  card.addEventListener("click", () => card.classList.toggle("flipped"));
  // 배경(도감 목록) 스크롤 잠금 — 단, 뒷면 내용(.sc-content)은 스크롤 허용해 긴 원문도 다 읽게
  const block = (e) => { if (!e.target.closest(".sc-content")) e.preventDefault(); };
  ov.addEventListener("wheel", block, { passive: false });
  ov.addEventListener("touchmove", block, { passive: false });
  const close = () => ov.remove(); // 리스너는 ov 제거 시 함께 정리됨
  ov.querySelector(".saryo-modal-close").addEventListener("click", close);
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); }); // 바깥(백드롭) 클릭 = 닫기
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

  // 대표 반박: 등급 높은 순(동점=먼저 지켜낸 말, 안정 정렬). 단 다른 반박과 너무 비슷한(겹치는) 말은
  // 뒤로 미뤄, 구별되는 말을 대표로. 모두 비슷하면(뺄 게 없으면) 그냥 최고 등급 유지.
  const won = rev.cardsWon.slice().sort((a, b) => (GRADE_RANK[b.grade] || 0) - (GRADE_RANK[a.grade] || 0));
  const isDup = (c) => won.some((o) => o !== c && simRatio(c.myInput, o.myInput) >= 0.5);
  const distinct = won.filter((c) => !isDup(c));
  const bestWon = distinct[0] || won[0];
  const rep = bestWon?.myInput || rev.log.find((l) => l.outcome === "strong")?.myInput;
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
// 터치 기기: 첫 탭 = 이름 카드 열기(pin--peek), 두 번째 탭 = 입장 (호버 프리뷰 대체)
const isTouch = window.matchMedia("(hover: none)").matches;
document.querySelectorAll(".relic[data-char]").forEach((b) =>
  b.addEventListener("click", () => {
    const id = b.dataset.char;
    if (isTouch && b.classList.contains("pin") && !b.classList.contains("pin--peek")) {
      document.querySelectorAll(".pin--peek").forEach((p) => p.classList.remove("pin--peek"));
      b.classList.add("pin--peek"); // 첫 탭: 어떤 유적인지 확인만
      return;
    }
    if (isReverseChar(id)) startReverse(id); // 덱 선택 제거 — 바로 시작(카드는 대화 중 도감에서 꺼내 씀)
    else startGame(id, !!loadSaves()[id]);
  })
);
// 지도 빈 곳 탭 → 열려있던 이름 카드 닫기
$("scr-map").addEventListener("click", (e) => {
  if (isTouch && !e.target.closest(".pin")) document.querySelectorAll(".pin--peek").forEach((p) => p.classList.remove("pin--peek"));
});

// ── 지구본 팬: 지도 3벌을 이어붙여 무한 순환(어느 방향으로 돌려도 계속 이어짐).
//    기본 화면 = 한국이 정가운데. 드래그(마우스)/스와이프(터치)로 굴린다. ──
const wmScroll = document.querySelector(".wm-scroll");
if (wmScroll) {
  // 지도 복제 2벌 추가(원본 포함 총 3벌: [복제A][원본][복제B])
  const original = wmScroll.querySelector(".worldmap");
  if (original && !wmScroll.dataset.looped) {
    wmScroll.dataset.looped = "1";
    const cloneA = original.cloneNode(true), cloneB = original.cloneNode(true);
    // 복제본 핀도 클릭 되도록 위임(아래 startGame 리스너는 원본에만 붙었으므로)
    for (const c of [cloneA, cloneB]) c.querySelectorAll(".relic[data-char]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.char;
      if (isTouch && b.classList.contains("pin") && !b.classList.contains("pin--peek")) {
        document.querySelectorAll(".pin--peek").forEach((p) => p.classList.remove("pin--peek"));
        b.classList.add("pin--peek");
        return;
      }
      if (isReverseChar(id)) startReverse(id);
      else startGame(id, !!loadSaves()[id]);
    }));
    wmScroll.insertBefore(cloneA, original);
    wmScroll.appendChild(cloneB);
  }
  const mapW = () => wmScroll.scrollWidth / 3; // 한 벌 너비
  // 한국(핀 --x 85.27%)이 뷰포트 정가운데 오도록: 가운데 벌 기준
  const parkKorea = () => {
    const w = mapW();
    wmScroll.scrollLeft = w + w * 0.8527 - wmScroll.clientWidth / 2;
  };
  requestAnimationFrame(parkKorea);
  window.addEventListener("load", parkKorea, { once: true });
  // 무한 랩: 가장자리 벌로 넘어가면 티 안 나게 가운데 벌로 점프
  wmScroll.addEventListener("scroll", () => {
    const w = mapW();
    if (wmScroll.scrollLeft < w * 0.25) wmScroll.scrollLeft += w;
    else if (wmScroll.scrollLeft > w * 1.75) wmScroll.scrollLeft -= w;
  }, { passive: true });
  // 데스크톱 마우스 드래그 팬(터치는 네이티브 스크롤)
  let panning = false, panX = 0, panL = 0, moved = 0;
  wmScroll.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    panning = true; panX = e.clientX; panL = wmScroll.scrollLeft; moved = 0;
    wmScroll.classList.add("grabbing");
  });
  wmScroll.addEventListener("pointermove", (e) => {
    if (!panning) return;
    const dx = e.clientX - panX;
    moved = Math.max(moved, Math.abs(dx));
    wmScroll.scrollLeft = panL - dx;
  });
  const endPan = () => { panning = false; wmScroll.classList.remove("grabbing"); };
  wmScroll.addEventListener("pointerup", endPan);
  wmScroll.addEventListener("pointerleave", endPan);
  // 드래그였다면 핀 클릭 무시(팬과 클릭 충돌 방지)
  wmScroll.addEventListener("click", (e) => { if (moved > 6) { e.stopPropagation(); e.preventDefault(); } }, true);
}
// 폼 제출: 역모드 진행 중이면 역판정, 아니면 정방향
$("turn-form").addEventListener("submit", (e) => { (rev && !rev.done) ? onReverseTurn(e) : onTurn(e); });
$("hint-btn").addEventListener("click", () => unlockHint()); // 수동 힌트(예산 차감)
$("save-card").addEventListener("click", saveCard);
$("retry").addEventListener("click", () => { hideVictoryClip(); rev = null; refreshMapSaves(); show("scr-map"); });
// 결과화면 → 도감 보기(닫으면 지도로)
$("result-dogam").addEventListener("click", () => { dogamFrom = null; hideVictoryClip(); renderDogam(); show("scr-dogam"); });
// 뒤로가기: 진행 자동 저장 후 지도로 (역모드는 저장 없이 나감)
$("back-map").addEventListener("click", () => { if (!rev) saveGame(); rev = null; refreshMapSaves(); show("scr-map"); });
// 말투 슬라이딩 스위치(정통↔밈): 즉시 로그를 새 말투로 리렌더
$("tone-toggle").addEventListener("click", () => {
  tone = tone === "classic" ? "meme" : "classic";
  syncToneUI();
  if (rev && !rev.done) revPortrait(rev.speaker, rev.mood || "neutral"); // 역모드: 하루/쿠로다 초상 정통↔밈 교체
  else if (state) { retone(); updateScene(); } // 정방향: 로그 리렌더 + 캐릭터 시리즈 교체
});
// 난이도 선택
document.querySelectorAll("#diff-select .diff").forEach((b) =>
  b.addEventListener("click", () => { difficulty = b.dataset.diff; syncDiffUI(); })
);
// 도감 — 지도/결과에서 열면 열람(dogamFrom=null), 대화 중 헤더 📖로 열면 '쓰기' 노출
$("open-dogam").addEventListener("click", () => { dogamFrom = null; renderDogam(); show("scr-dogam"); });
$("chat-dogam").addEventListener("click", () => { dogamFrom = "chat"; renderDogam(); show("scr-dogam"); });
$("close-dogam").addEventListener("click", () => {
  if (dogamFrom === "chat") { dogamFrom = null; show("scr-chat"); $("turn-input")?.focus(); } // 대화로 복귀
  else { refreshMapSaves(); show("scr-map"); }
});
// 덱 편성: 출전(선택 카드로 시작) · 닫기(지도로)
$("deck-go").addEventListener("click", () => startReverse(deckCharId, new Set(deckSel)));
$("deck-close").addEventListener("click", () => show("scr-map"));
// 탭을 닫거나 새로고침해도 진행 보존
window.addEventListener("pagehide", saveGame);
window.addEventListener("beforeunload", saveGame);
// 판정 프록시 상태 확인(비동기 — 실패해도 게임엔 지장 없음)
checkHealth();
refreshMapSaves(); // 시작 시 이어하기 표시 반영
