// server/ai/judge.js
// 판정기 provider 추상화:
//   - judgeOffline : API 키 없이 동작(폴백·즉시 테스트·심사자 실행 보장)
//   - judgeGPT     : OpenAI(GPT) 구조화 판정(function calling)
//   - judgeClaude  : Anthropic(Claude) 구조화 판정(tool use)
//   - judge()      : provider 선택 디스패처 (opts.provider | env.AI_PROVIDER)
// 모두 동일한 Verdict를 돌려준다:
//   Verdict = { grade, line, sources:[{id,source,url}], anachronism, matchedIssue, input, provider }

import { retrieve } from "../rag/retrieve.js";

const ANACHRONISM = ["민주주의", "표현의 자유", "인권", "기본권", "투표", "평등", "gdp", "경제성장", "자본주의"];
const BACKFIRE = ["최고", "위대하신", "짱", "굽신", "제발", "부탁드립니다요", "돈"];
const has = (input, list) => { const t = (input || "").toLowerCase(); return list.some((w) => t.includes(w)); };

// ── 공통 판정 스키마 (등급·대사·사료·시대착오) ──────────────────────────
const VERDICT_PROPS = {
  grade: { type: "string", enum: ["탁월", "정합", "부분", "불합치", "역효과"] },
  matchedIssue: { type: ["string", "null"], description: "매칭된 쟁점 id 또는 null" },
  sources: { type: "array", items: { type: "string" }, description: "인용한 사료 조각 id 목록" },
  anachronism: { type: "boolean", description: "당대에 없던 시대착오 개념 여부" },
  line: { type: "string", description: "인물 1인칭 대사" },
};
const VERDICT_REQUIRED = ["grade", "line", "anachronism"];

function makeVerdict(grade, line, sources, anachronism, matchedIssue, input, provider) {
  return { grade, line, sources, anachronism, matchedIssue, input, provider };
}

function resolveSources(ids, knowledge) {
  return (ids || []).map((id) => {
    const f = (knowledge.fragments || []).find((x) => x.id === id);
    return f ? { id: f.id, source: f.source, url: f.sourceUrl } : { id };
  });
}

function buildSystemPrompt(profile, fragments, mode, tone) {
  const src = fragments.map((f) => `- [${f.id}] ${f.content} (출처: ${f.source})`).join("\n") || "(관련 사료 없음)";
  return [
    profile.systemPromptBase,
    "\n[규칙]",
    "- 역사·사실은 아래 사료에서만 인용한다. 없으면 지어내지 말고 '그건 기록에 없네'라고 답한다.",
    "- 게이지 수치·승패는 절대 언급하지 않는다. 너는 부합도 등급(탁월/정합/부분/불합치/역효과)만 낸다.",
    tone === "meme" ? "- 말투는 현대적 밈 허용, 단 사료 인용부엔 유행어 금지." : "- 말투는 차분한 사극체.",
    "- 시대착오(민주주의·표현의 자유 등 당대에 없던 개념)면 못 알아듣는 연기 + 불합치.",
    `\n[검색된 사료]\n${src}`,
  ].join("\n");
}

// ── 오프라인(휴리스틱) ────────────────────────────────────────────────
export function judgeOffline(input, character, opts = {}) {
  const { profile, knowledge, debate } = character;
  const mode = opts.mode || debate.avoidanceMode || "mixed";
  const modeCfg = opts.cfg?.modes?.[mode] || { avoid_grade: "불합치", hidden_grade: "탁월" };

  if (has(input, ANACHRONISM))
    return makeVerdict("불합치", `${profile.displayName}: "그게 무슨 말인고? 나는 도무지 모르겠네."`, [], true, null, input, "offline");
  if (has(input, BACKFIRE))
    return makeVerdict("역효과", `${profile.displayName}: "그런 말로 나를 움직이려 하는가. 자중하게."`, [], false, null, input, "offline");

  const { issue, fragments, matchScore } = retrieve(input, knowledge, debate);
  const sources = fragments.map((f) => ({ id: f.id, source: f.source, url: f.sourceUrl }));

  if (!issue || matchScore === 0)
    return makeVerdict("불합치", `${profile.displayName}: "그건 내 뜻과 잘 닿지 않네. 다시 일러보게."`, [], false, null, input, "offline");

  if (issue.sejongResponded === false) {
    const strong = matchScore >= 2;
    const grade = strong ? modeCfg.hidden_grade : modeCfg.avoid_grade;
    const line = strong
      ? `${profile.displayName}: "허, 그 말은 미처 생각지 못했네. 옳은 지적이야."`
      : (issue.playerEffect?.[mode]?.reaction || issue.playerEffect?.strict?.reaction || `${profile.displayName}: "그 이야기는 다음에 하지."`);
    return makeVerdict(grade, line, sources, false, issue.id, input, "offline");
  }

  const grade = matchScore >= 2 ? "탁월" : "정합";
  const line = issue.sejongRebuttal
    ? `${profile.displayName}: "${issue.sejongRebuttal}"`
    : `${profile.displayName}: "옳도다. 그 말에 뜻이 더욱 굳어지는구나."`;
  return makeVerdict(grade, line, sources, false, issue.id, input, "offline");
}

// ── OpenAI (GPT) ─────────────────────────────────────────────────────
export async function judgeGPT(input, character, opts = {}) {
  const key = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!key) return judgeOffline(input, character, opts);

  const { profile, knowledge, debate } = character;
  const { fragments } = retrieve(input, knowledge, debate);
  const system = buildSystemPrompt(profile, fragments, opts.mode, opts.tone);

  const body = {
    model: opts.model || process.env.OPENAI_MODEL || "gpt-4o",
    messages: [{ role: "system", content: system }, { role: "user", content: input }],
    tools: [{ type: "function", function: { name: "verdict", description: "플레이어 논거를 판정하고 대사를 낸다.", parameters: { type: "object", properties: VERDICT_PROPS, required: VERDICT_REQUIRED } } }],
    tool_choice: { type: "function", function: { name: "verdict" } },
    max_tokens: 512,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const call = data.choices?.[0]?.message?.tool_calls?.[0];
      const v = call ? JSON.parse(call.function.arguments) : null;
      if (v?.grade) return makeVerdict(v.grade, v.line, resolveSources(v.sources, knowledge), !!v.anachronism, v.matchedIssue ?? null, input, "gpt");
    } catch (_) { /* 재시도 */ }
  }
  return judgeOffline(input, character, opts);
}

// ── Anthropic (Claude) ───────────────────────────────────────────────
export async function judgeClaude(input, character, opts = {}) {
  const key = opts.apiKey || process.env.CLAUDE_API_KEY;
  if (!key) return judgeOffline(input, character, opts);

  const { profile, knowledge, debate } = character;
  const { fragments } = retrieve(input, knowledge, debate);
  const system = buildSystemPrompt(profile, fragments, opts.mode, opts.tone);

  const body = {
    model: opts.model || process.env.CLAUDE_MODEL || "claude-opus-4-8",
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: input }],
    tools: [{ name: "verdict", description: "플레이어 논거를 판정하고 대사를 낸다.", input_schema: { type: "object", properties: VERDICT_PROPS, required: VERDICT_REQUIRED } }],
    tool_choice: { type: "tool", name: "verdict" },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const call = (data.content || []).find((c) => c.type === "tool_use");
      const v = call?.input;
      if (v?.grade) return makeVerdict(v.grade, v.line, resolveSources(v.sources, knowledge), !!v.anachronism, v.matchedIssue ?? null, input, "claude");
    } catch (_) { /* 재시도 */ }
  }
  return judgeOffline(input, character, opts);
}

// ── 디스패처 ─────────────────────────────────────────────────────────
export function judge(input, character, opts = {}) {
  const provider = opts.provider || process.env.AI_PROVIDER || "offline";
  if (provider === "gpt") return judgeGPT(input, character, opts);
  if (provider === "claude") return judgeClaude(input, character, opts);
  return judgeOffline(input, character, opts); // 동기 반환
}
