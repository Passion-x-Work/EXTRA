// .env 로더. 프로젝트 .env 값이 시스템 환경변수를 '덮어쓴다'(override).
// (이 PC의 시스템 OPENAI_API_KEY 가 무효라, 프로젝트 .env 가 우선해야 GPT가 동작함)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const p = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(p)) {
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
