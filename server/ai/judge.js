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

// 오프라인 리액션 대사 풀(입력 해시로 다양화). 사료 인용부엔 섞지 않는다 — 리액션에만.
const MEME = {
  praise: ["오, 그거 좀 맞는 말인데? 인정.", "와 그건 팩트네.", "말 되네 진짜.", "오 이건 좀 설득력 있는데?", "음 그 포인트 좋다."],
  neutral: ["음~ 그건 좀 아닌 듯?", "노노, 그건 결이 다르지.", "글쎄, 와닿진 않는데?", "흠… 그걸론 좀 약한데?", "그게 핵심은 아닌 것 같은데?"],
  weak: ["오 방향은 맞는데 좀 더 풀어봐.", "느낌은 오는데 근거가 약해. 더 말해봐.", "그래서? 좀 더 구체적으로."],
  repeat: ["그건 아까 들었잖아 ㅋㅋ 다른 건?", "또 그 얘기? 새로운 각도로 가보자.", "그 말은 이미 접수함. 다른 이유는?"],
  reject: ["갑자기 그런 말은 좀… 예의 챙기시게.", "그런 수작은 안 통하네.", "어허, 선 넘네."],
  confused: ["엥? 그게 무슨 말임? 처음 듣는데.", "그건 내 세상엔 없는 말인데?", "음? 무슨 소린지 모르겠소만."],
};
// 정통(사극체) 리액션 풀
const CLASSIC = {
  neutral: ["그건 내 뜻과 잘 닿지 않네. 다시 일러보게.", "흠, 그 말로는 나를 움직이기 어렵네.", "무슨 뜻인지 좀 더 소상히 일러보게.", "그 말이 과인의 마음엔 미치지 못하는구나."],
  weak: ["그 뜻이 어렴풋이 닿네만, 좀 더 깊이 일러보게.", "말의 뜻은 알겠으나, 무엇을 위함인지 밝히게.", "조금 더 그 까닭을 소상히 말해보게."],
  repeat: ["그 이야기는 아까 들었네. 다른 까닭은 없는가?", "그 말은 이미 들었네. 또 다른 이유가 있는가?", "그 뜻은 알겠네. 헌데 다른 근거는 없는가?"],
};

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
  const { profile, knowledge } = character;
  const meme = opts.tone === "meme";
  const name = profile.displayName;
  const V = profile.values || {};
  const covered = new Set(opts.covered || []); // 이번 판에 이미 커버한 가치 축
  const hash = [...(input || "")].reduce((a, c) => a + c.charCodeAt(0), 0); // 입력 내용 기반 결정론적 픽(길이 아님)
  const pick = (arr) => (arr && arr.length ? arr[hash % arr.length] : "");
  const react = (cat) => `${name}: "${pick(meme ? (MEME[cat] || MEME.neutral) : (CLASSIC[cat] || CLASSIC.neutral))}"`;
  const score = (kws) => (kws || []).reduce((s, k) => s + (input.includes(k) ? 1 : 0), 0);
  const best = (list) => (list || []).reduce((b, it) => { const s = score(it.keywords); return s > b.score ? { item: it, score: s } : b; }, { item: null, score: 0 });
  const srcOf = (ids) => (ids || []).map((id) => { const f = knowledge.fragments.find((x) => x.id === id); return f ? { id: f.id, source: f.source, url: f.sourceUrl } : { id }; });

  // 1. 시대착오
  if ((V.시대착오 || ANACHRONISM).some((w) => input.includes(w)))
    return makeVerdict("불합치", react("confused"), [], true, null, input, "offline");

  // 2. 역효과 (아첨·돈 회유 등)
  const bad = best(V.역효과);
  const pro = best(V.통하는_가치);
  const anti = best(V.안_통하는_것);
  if (bad.score > 0 && bad.score >= pro.score)
    return makeVerdict("역효과", meme ? react("reject") : `${name}: "${bad.item.line}"`, [], false, null, input, "offline");

  // 3. 안 통하는 축이 통하는 축보다 강하면 불합치
  if (anti.score > 0 && anti.score >= pro.score)
    return makeVerdict("불합치", meme ? react("neutral") : `${name}: "${anti.item.line}"`, [], false, anti.item.axis, input, "offline");

  // 4. 통하는 가치 축 — 진전은 '새로운 축을 깊이 있게(키워드 2+)' 짚어야만.
  if (pro.score > 0) {
    const axis = pro.item.axis;
    const sources = srcOf(pro.item["근거_사료"]);
    if (covered.has(axis)) // 이미 커버한 축 반복 → 진전 없음. '이미 들었네, 다른 근거는?'
      return makeVerdict("불합치", react("repeat"), sources, false, axis, input, "offline");
    if (pro.score >= 2) { // 강한 새 축 → 정합, 사료 근거 대사 공개(축 잠금)
      const line = meme ? `${name}: "${pick(MEME.praise)} ${pro.item.line}"` : `${name}: "${pro.item.line}"`;
      return makeVerdict("정합", line, sources, false, axis, input, "offline");
    }
    // 약한 단일 키워드 → 진전 없음(스팸 방지). 방향은 맞으니 '더 깊이' 요구.
    return makeVerdict("불합치", react("weak"), [], false, null, input, "offline");
  }

  // 5. 매칭 없음
  return makeVerdict("불합치", react("neutral"), [], false, null, input, "offline");
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
