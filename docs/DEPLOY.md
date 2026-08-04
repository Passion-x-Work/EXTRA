# EXTRA · 배포 가이드 (Vercel)

> **담당: 배정윤** (2026-08-03 결정). 코드·설정은 준비 완료 — 아래 절차대로 계정 인증 후 배포만 하면 됨.

링크 하나로 심사위원이 바로 플레이 + 폰 테스트. 프론트(Vite 정적) + 판정 함수(`api/judge.js`)를 함께 배포한다.

## 구조
- 정적: `web/` → 빌드 시 `dist/` (배경 `bg-sejong.svg`·`bg-vangogh.jpg` 포함)
- API: `api/judge.js` (Vercel 서버리스). 키는 **Vercel 환경변수**로만.
- 설정: `vercel.json` (빌드 커맨드·출력 폴더·함수에 `config/`·`content/` 포함)

## 처음 배포
```bash
cd C:\Users\yoon\nhn\EXTRA-fresh
npm i -g vercel      # 또는 npx vercel
vercel login
vercel               # 프로젝트 연결(첫 배포). 프롬프트는 기본값 Enter로 진행
```

## Provider 전략
- **제출·배포 = Claude 전용** (NHN 클로드 도입·심사위원 상용 도구와 정합). 프로덕션 `AI_PROVIDER=claude`.
- **개발·테스트 = GPT + Claude 둘 다** (드롭다운에서 전환하며 비교). 로컬 `.env`에 둘 다 키 넣어 테스트.
- 플레이어 선택지엔 오프라인 없음(비상 폴백으로만 자동 동작 — 키/네트워크 죽어도 심사 중 안 깨짐).

## 환경변수 (Vercel 대시보드 또는 CLI)
```bash
vercel env add AI_PROVIDER       # 배포는 claude
vercel env add CLAUDE_API_KEY    # 유효한 Claude 키 (필수)
vercel env add OPENAI_API_KEY    # (선택) 테스트/비교용 GPT 키
```
> 키가 없거나 오류여도 게임은 **오프라인 폴백으로 동작**한다(심사자 실행 보장). 실 AI 판정만 키 필요.

## 프로덕션 배포
```bash
vercel --prod
```
→ 출력된 `https://<프로젝트>.vercel.app` 링크가 제출용.

## 확인
- 링크 접속 → 세종/반고흐 플레이
- 드롭다운 GPT/Claude 선택 시 실 AI 판정(환경변수 설정 시). 미설정/오류 시 오프라인 폴백.
- `GET /api/health` 는 로컬 프록시 전용(서버리스엔 없음).

## 로컬 개발(참고)
```bash
npm run server   # 프록시 :8787 (.env 사용)
npm run dev      # Vite :5173 ( /api → :8787 프록시)
```
