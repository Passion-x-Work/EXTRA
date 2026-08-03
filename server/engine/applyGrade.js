// server/engine/applyGrade.js
// 결정론적 게임 상태 엔진. AI는 '등급'만 주고, 수치·게이지·승패는 여기서 계산한다.
// 숫자는 config/difficulty.json, 규칙은 이 파일. (2026-08-03 결정)

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {object} state  { gauge, turn, consecutiveBad, status, history }
 * @param {object} verdict { grade, line, sources, anachronism, matchedIssue }
 * @param {object} cfg     config/difficulty.json 전체
 * @param {string} charId  "sejong" 등
 * @returns {object} 새로운 state (불변)
 */
export function applyGrade(state, verdict, cfg, charId) {
  const ch = cfg.characters[charId] || {};
  const win = ch.win_threshold ?? 100;
  const failFloor = cfg.gauge_range?.min ?? 0;

  let pts = cfg.grade_to_points[verdict.grade] ?? 0;
  if (pts < 0) pts = Math.round(pts * (ch.penalty_multiplier ?? 1)); // 역효과는 인물별 페널티 배수

  const gauge = clamp(state.gauge + pts, failFloor, cfg.gauge_range?.max ?? 100);
  const turn = state.turn + 1;

  const isBad = verdict.grade === "역효과" || verdict.grade === "불합치";
  const consecutiveBad = isBad ? state.consecutiveBad + 1 : 0;

  let status = "CONTINUE";
  if (gauge >= win) status = "WIN";
  else if (consecutiveBad >= (cfg.fail_conditions?.consecutive_bad_lose ?? 3)) status = "LOSE";

  const entry = { input: verdict.input ?? null, grade: verdict.grade, delta: pts, gauge, line: verdict.line };

  return {
    ...state,
    gauge,
    turn,
    consecutiveBad,
    status,
    history: [...state.history, entry],
  };
}

/** 결과 등급(S/A/B/C) — 걸린 턴 수 기준 */
export function resultBand(turn, cfg) {
  const bands = cfg.result_grade_bands || {};
  for (const g of ["S", "A", "B", "C"]) {
    if (bands[g] && turn <= bands[g].max_turns) return g;
  }
  return "C";
}

/** 새 세션 초기 상태 */
export function initState(cfg, charId) {
  const ch = cfg.characters[charId] || {};
  return {
    charId,
    gauge: ch.gauge_start ?? 40,
    turn: 0,
    consecutiveBad: 0,
    status: "CONTINUE",
    history: [],
  };
}
