// test/miyamoto-balance.mjs — 번외(역설득) offline 판정 정확도 QA.
// 실행: node test/miyamoto-balance.mjs
// 각 arg에 방어형/동조형 문장을 여러 개 넣고, offline 판정이 기대대로(방어/동조) 나오는지 %로 측정.
// 정확도 낮은 arg = defendKeywords/complyKeywords 튜닝 대상.
import { readFileSync } from "node:fs";
import { judgeRebuttal } from "../server/engine/miyamotoEngine.js";

const cards = JSON.parse(
  readFileSync(new URL("../content/characters/miyamoto/cards.json", import.meta.url), "utf-8")
);
const OFFLINE = { provider: "offline", mode: "reverse-persuasion", tone: "classic" };

// arg별 테스트 케이스: expect="defend"(방어 성공해야) | "comply"(동조로 잡혀야)
// 사람마다 표현이 제각각인 상황을 흉내내 다양한 문장을 넣는다.
const CASES = {
  "arg-01": {
    defend: [
      "평단보다 플레이어가 즐거운 게 먼저다. 항상 새롭고 재미있는 경험을 만드는 게 핵심이지.",
      "메시지보다 노는 재미가 우선이야. 사람들이 즐겁게 플레이할 새 경험을 만든다.",
      "예술적 인정보다 게임이 재미있는 게 중요하다.",
    ],
    comply: [
      "맞아요, 메시지가 담긴 예술적인 게임을 만들어서 평단에 인정받읍시다.",
      "그러네요, 평단이 인정하는 예술 게임으로 갑시다.",
    ],
  },
  "arg-02": {
    defend: [
      "스토리보다 게임 시스템, 가지고 노는 재미가 먼저다. 스토리는 재미를 끌어내는 한 방법일 뿐이야.",
      "먼저 플레이가 재미있어야 한다. 시스템이 먼저고 스토리는 그 다음.",
      "게임성부터 잡고 스토리는 거기 얹는 거지.",
    ],
    comply: [
      "좋아요, 멋진 스토리부터 완성하고 거기 맞춰 시스템을 짜죠.",
      "스토리 먼저 만들고 게임을 맞추는 게 낫겠네요.",
    ],
  },
  "arg-03": {
    defend: [
      "헷갈리는 조작은 다듬어야지. 플레이어가 해냈다는 성취감을 느껴야 한다.",
      "시간 없어도 조작은 명확해야 해. 만족감 없는 게임은 의미가 없다.",
      "그냥 넘어가면 안 돼. 성취감이 게임의 핵심이야.",
    ],
    comply: [
      "그러죠, 시간 없으니 헷갈리는 조작 그냥 두고 갑시다.",
      "맞아요 마감이 급하니 그대로 갑시다.",
    ],
  },
  "arg-04": {
    defend: [
      "그건 제가 한 말이 아닌데요. 출처가 의심스럽습니다.",
      "그거 진짜 미야모토가 한 말 맞아요? 누가 언제 한 말인지 확인해봤어요?",
      "유명하다고 다 사실은 아니죠. 근거가 뭡니까?",
      "그 명언 출처가 불분명해요. 제 말로 알려진 가짜입니다.",
    ],
    comply: [
      "역시 미야모토님 명언이네요. 그 말대로 마감 무시하고 무한정 미루죠.",
      "맞는 말이에요, 명언대로 계속 미룹시다.",
    ],
  },
  "arg-05": {
    defend: [
      "어려움 자체가 목적이 아니야. 누구나 쉽게 잡되 깊이가 있어야 한다.",
      "5세부터 95세까지 누구나 즐기는 게 중요하지. 접근성이 핵심이야.",
      "고수만을 위한 게 아니라 모두가 성취감을 느껴야 한다.",
    ],
    comply: [
      "맞아요, 어려울수록 고수들이 좋아하니까 어렵게 만듭시다.",
      "쉬우면 무시당하니 난도를 확 올리죠.",
    ],
  },
};

const out = [];
let gPass = 0, gTotal = 0;

for (let i = 0; i < cards.arguments.length; i++) {
  const arg = cards.arguments[i];
  const cases = CASES[arg.id];
  if (!cases) continue;

  out.push(`\n===== ${arg.id} (${arg.kind}, ${arg.speaker}) onDefend=+${arg.onDefend} onComply=${arg.onComply} =====`);

  let pass = 0, total = 0;
  for (const [expect, sentences] of Object.entries(cases)) {
    for (const s of sentences) {
      const r = await judgeRebuttal(cards, i, s, 50, OFFLINE);
      const got = r.defended ? "defend" : "comply";
      const ok = got === expect;
      pass += ok ? 1 : 0; total++;
      const mark = ok ? "✅" : "❌";
      out.push(`  ${mark} [기대:${expect} / 실제:${got}] ${r.verdict.grade} d=${r.delta} · "${s.slice(0, 30)}${s.length > 30 ? "…" : ""}"`);
    }
  }
  const pct = Math.round((pass / total) * 100);
  out.push(`  → 정확도 ${pass}/${total} (${pct}%)${pct < 80 ? "  ⚠️ 튜닝 권장" : ""}`);
  gPass += pass; gTotal += total;
}

const gPct = Math.round((gPass / gTotal) * 100);
out.push(`\n────────────────────────────`);
out.push(`전체 offline 판정 정확도: ${gPass}/${gTotal} (${gPct}%)`);
out.push(`80% 미만 arg는 cards.json의 defendKeywords/complyKeywords 보강 대상.`);
process.stdout.write(out.join("\n") + "\n");
