// server/rag/retrieve.js
// 사료 검색 = 쟁점-사료 직접 매핑(sourceRef). 조각이 8개뿐이라 벡터DB 불필요.
// (Graph RAG / 벡터검색은 확장 로드맵) — 2026-08-03 결정.

/** 아주 가벼운 토크나이저: 한글·영문 2글자 이상 토막 */
function tokens(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^가-힣a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** 부분 문자열 기반 키워드 매칭 점수 */
function score(inputToks, keywords) {
  let s = 0;
  for (const kw of keywords || []) {
    const k = kw.toLowerCase();
    if (inputToks.some((t) => t.includes(k) || k.includes(t))) s += 1;
  }
  return s;
}

/**
 * 플레이어 발화에 가장 관련 있는 쟁점(issue)과 사료 조각(fragment)을 찾는다.
 * @param {string} input      플레이어 논거
 * @param {object} knowledge  knowledge.json (fragments[])
 * @param {object} debate     debate.json (issues[])
 * @returns {{ issue, fragments, matchScore }}
 */
export function retrieve(input, knowledge, debate) {
  const toks = tokens(input);
  const fragById = Object.fromEntries((knowledge.fragments || []).map((f) => [f.id, f]));

  let best = { issue: null, fragments: [], matchScore: 0 };
  for (const issue of debate.issues || []) {
    // 쟁점 관련 사료 조각들의 키워드 + 쟁점 문구로 매칭
    const refFrags = (issue.sourceRef || []).map((id) => fragById[id]).filter(Boolean);
    const kw = [
      ...refFrags.flatMap((f) => f.keywords || []),
      ...tokens(issue.opponentClaim),
      ...tokens(issue.playerEffect?.goodMove || issue.playerEffect?.mixed?.hiddenTrigger || ""),
    ];
    const s = score(toks, kw);
    if (s > best.matchScore) best = { issue, fragments: refFrags, matchScore: s };
  }

  // 매칭이 아예 없으면 빈 결과 → 판정기가 "기록에 없네" 경로로 처리
  return best;
}
