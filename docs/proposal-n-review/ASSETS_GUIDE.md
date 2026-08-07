# EXTRA · 캐릭터 이미지 규약 (담당: 배정윤)

> 이 규약대로 파일만 넣으면 **코드 수정 없이** 게임에 바로 붙습니다.
> 파일이 없으면 초상은 자동으로 숨겨지고 배경은 임시 테마 그라디언트로 대체돼요(깨진 이미지 안 뜸).
> 연결 로직: `web/src/app.js`의 `ASSETS` 맵 · `updateScene()`.

## 1. 넣는 위치 · 형식
- **폴더:** `web/public/Assets/<인물폴더>/` (예: `web/public/Assets/Hokusai/`)
- **형식:** `.webp` (원본 PNG로 작업 후 webp로 변환해 넣기 — 기존 세종/고흐도 PNG→webp)
- 웹에서는 `/Assets/<인물폴더>/<파일>.webp` 로 서빙됨.

## 2. 파일 종류 — 인물당 12장
### 배경 2장 (신념 게이지 연동)
| 파일명 | 언제 |
|---|---|
| `<bgDark>.webp` | 게이지 **≤50** (설득 초반·부정적, 어두운 톤) |
| `<bgLight>.webp` | 게이지 **>50** (설득이 먹히는 중, 밝은 톤) |

### 초상 10장 = 말투 2종 × Phase 5단계
- **말투:** 정통(사극체) 시리즈 + 밈(현대체) 시리즈 — 플레이어가 토글로 전환.
- **Phase:** 신념 게이지에 따라 **표정이 바뀜**. `Phase = ceil(게이지 / 20)`, 1~5.
  - Phase01 = 게이지 1~20 (완강히 거부/무표정) → Phase05 = 81~100 (마음이 열림/설득됨)
  - **표정이 점점 긍정적으로** 바뀌는 5단계 연속 컷.
- 파일명: `<series>-Phase01.webp` ~ `<series>-Phase05.webp`

## 3. 호쿠사이 (지금 필요한 것) — `web/public/Assets/Hokusai/`
| # | 파일명 | 내용 |
|---|---|---|
| 1 | `Hokusai-BG02.webp` | 배경(어두움, 게이지 ≤50) — 노년의 가난한 에도 화실 |
| 2 | `Hokusai-BG01.webp` | 배경(밝음, 게이지 >50) — 다시 붓을 든 화실 |
| 3~7 | `Hokusai-Phase01.webp` … `Hokusai-Phase05.webp` | **정통** 말투 초상 5단계 |
| 8~12 | `Hip-Hokusai-Phase01.webp` … `Hip-Hokusai-Phase05.webp` | **밈** 말투 초상 5단계 |

- 시대: 1834년경 에도 · 여든 가까운 노화가. 우키요에 화풍 참고(『가나가와 파도』).
- 임시 테마색(에셋 오기 전 대체 배경): 파도 인디고→한지 크림. 참고만.

## 4. 초상 규격 (기존 세종/고흐와 동일)
- **배경 투명(NoBG)** PNG로 작업 → webp. 인물만 오려낸 세로형.
- 화면에서 **하단 정렬 · 가운데** 배치(`object-fit: contain`, 하단 기준). 발끝~머리가 잘리지 않게 여백 확보.
- 좌측 인물 패널 폭 = 화면의 36%(데스크톱) / 모바일은 하단에 흐리게 깔림. 세로로 긴 비율 권장.
- 5개 Phase는 **같은 구도·같은 크기**로(표정만 변화) — 페이드 전환 시 자연스럽게.

## 5. 새 인물을 추가할 때(참고)
`web/src/app.js`의 `ASSETS`에 한 줄 추가하면 끝:
```js
const ASSETS = {
  ...,
  hokusai: { dir: "Hokusai", bgDark: "Hokusai-BG02", bgLight: "Hokusai-BG01", classic: "Hokusai", meme: "Hip-Hokusai" },
  // 새 인물: { dir: "<폴더>", bgDark, bgLight, classic: "<정통접두>", meme: "<밈접두>" }
};
```
초상 파일명 = `<classic|meme>-Phase0N.webp`. 파일이 없으면 자동 숨김이라 부분만 먼저 넣어도 안전.

---
_참고: 기존 예시 — 세종 `Assets/Sejong/`(정통 `Front-NoBG-Phase0N` · 밈 `Hip-Front-NoBG-Phase0N`), 고흐 `Assets/gogh/`(정통 `NoBG_Gogh-Phase0N` · 밈 `Hip-NoBG_Gogh-Phase0N`)._
