// server/ai/judge.js
// 판정기: (1) judgeOffline — API 키 없이 동작(폴백·즉시 테스트·심사자 실행 보장)
//         (2) judgeClaude  — 실제 Claude 구조화 판정(키 필요, 프록시에서만)
// 둘 다 동일한 Verdict 스키마를 돌려준다.
//   Verdict = { grade, line, sources:[{id,source,url}], anachronism:boolean, matchedIssue }

import { retrieve } from "../rag/retrieve.js";

// 시대착오(당대에 없던 개념) — 감지되면 못 알아듣고 게이지 정체
const ANACHRONISM = ["민주주의", "표현의 자유", "인권", "기본권", "투표", "평등", "gdp", "경제성장", "자본주의"];
// 역효과 트리거 — 아첨/비굴/임금 사치 취급
const BACKFIRE = ["최고", "위대하신", "짱", "굽신", "제발", "부탁드립니다요", "돈"];

function has(input, list) {
  const t = (input || "").toLowerCase();
  return list.some((w) => t.includes(w));
}

/**
 * 오프라인 휴리스틱 판정. debate.json의 쟁점/모드를 규칙으로 사용.
 */
export function judgeOffline(input, character, opts) {
  const { profile, knowledge, debate } = character;
  const mode = opts.mode || debate.avoidanceMode || "mixed";
  const modeCfg = opts.cfg?.modes?.[mode] || { avoid_grade: "불합치", hidden_grade: "탁월" };

  // 1) 시대착오
  if (has(input, ANACHRONISM)) {
    return verdict("불합치", `${profile.displayName}: "그게 무슨 말인고? 나는 도무지 모르겠네."`, [], true, null, input);
  }
  // 2) 역효과(아첨·돈)
  if (has(input, BACKFIRE)) {
    return verdict("역효과", `${profile.displayName}: "그런 말로 나를 움직이려 하는가. 자중하게."`, [], false, null, input);
  }

  // 3) 쟁점 매칭
  const { issue, fragments, matchScore } = retrieve(input, knowledge, debate);
  const sources = fragments.map((f) => ({ id: f.id, source: f.source, url: f.sourceUrl }));

  if (!issue || matchScore === 0) {
    return verdict("불합치", `${profile.displayName}: "그건 내 뜻과 잘 닿지 않네. 다시 일러보게."`, [], false, null, input);
  }

  // 회피 논거(2·4조 등): sejongResponded === false
  if (issue.sejongResponded === false) {
    const strong = matchScore >= 2; // 빈틈을 잘 메웠다고 판단
    const grade = strong ? modeCfg.hidden_grade : modeCfg.avoid_grade;
    const line = strong
      ? `${profile.displayName}: "허, 그 말은 미처 생각지 못했네. 옳은 지적이야."`
      : (issue.playerEffect?.[mode]?.reaction || issue.playerEffect?.strict?.reaction || `${profile.displayName}: "그 이야기는 다음에 하지."`);
    return verdict(grade, line, sources, false, issue.id, input);
  }

  // 세종이 직접 반박한 쟁점: 매칭 강도로 등급
  const grade = matchScore >= 2 ? "탁월" : "정합";
  const line = issue.sejongRebuttal
    ? `${profile.displayName}: "${issue.sejongRebuttal}"`
    : `${profile.displayName}: "옳도다. 그 말에 뜻이 더욱 굳어지는구나."`;
  return verdict(grade, line, sources, false, issue.id, input);
}

/**
 * 실제 Claude 판정(구조화 출력 + 재시도 + 실패 시 오프라인 폴백).
 * 프록시(server/api)에서만 호출. 키는 process.env.CLAUDE_API_KEY.
 */
export async function judgeClaude(input, character, opts) {
  const key = opts.apiKey || process.env.CLAUDE_API_KEY;
  if (!key) return judgeOffline(input, character, opts); // 키 없으면 폴백

  const { profile, knowledge, debate } = character;
  const { fragments } = retrieve(input, knowledge, debate);
  const system = buildSystemPrompt(profile, fragments, opts.mode, opts.tone);

  const body = {
    model: opts.model || "claude-opus-4-8",
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: input }],
    tools: [VERDICT_TOOL],
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
      if (v && v.grade) {
        const sources = (v.사용_사료 || v.sources || []).map((id) => {
          const f = (knowledge.fragments || []).find((x) => x.id === id);
          return f ? { id: f.id, source: f.source, url: f.sourceUrl } : { id };
        });
        return verdict(v.grade, v.line || v.대사, sources, !!(v.anachronism ?? v.시대착오), v.matchedIssue ?? null, input);
      }
    } catch (e) {
      /* 재시도 */
    }
  }
  return judgeOffline(input, character, opts); // 최종 폴백
}

function buildSystemPrompt(profile, fragments, mode, tone) {
  const src = fragments.map((f) => `- [${f.id}] ${f.content} (출처: ${f.source})`).join("\n") || "(관련 사료 없음)";
  return [
    profile.systemPromptBase,
    "\n[규칙]",
    "- 역사·사실은 아래 사료에서만 인용한다. 없으면 지어내지 말고 '그건 기록에 없네'라고 답한다.",
    "- 게이지 수치·승패는 절대 언급하지 않는다. 너는 '부합도 등급'만 낸다.",
    tone === "meme" ? "- 말투는 현대적 밈 허용, 단 사료 인용부엔 유행어 금지." : "- 말투는 차분한 사극체.",
    `\n[검색된 사료]\n${src}`,
  ].join("\n");
}

const VERDICT_TOOL = {
  name: "verdict",
  description: "플레이어 논거를 판정하고 인물 대사를 낸다.",
  input_schema: {
    type: "object",
    properties: {
      grade: { type: "string", enum: ["탁월", "정합", "부분", "불합치", "역효과"] },
      matchedIssue: { type: ["string", "null"] },
      사용_사료: { type: "array", items: { type: "string" } },
      시대착오: { type: "boolean" },
      line: { type: "string", description: "인물 1인칭 대사" },
    },
    required: ["grade", "line", "시대착오"],
  },
};

function verdict(grade, line, sources, anachronism, matchedIssue, input) {
  return { grade, line, sources, anachronism, matchedIssue, input };
}
