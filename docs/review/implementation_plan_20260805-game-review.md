# 배경·캐릭터 Phase 시스템 개선 — 최종 구현 계획

> 기존 제안에 대한 사용자 코멘트를 반영한 확정 계획

---

## 코멘트 답변 & 확정 사항

### 1. 난이도별 시작 Phase 분석

난이도에 따라 시작 게이지가 달라지고, 이것이 시작 Phase(캐릭터 표정)에 영향을 줍니다:

| 난이도 | 기본 gauge_start | 보정값 | **실제 시작 게이지** | **시작 Phase** | 캐릭터 표정 |
|--------|-----------------|--------|---------------------|---------------|------------|
| 이지 | 40 | +15 | **55** | **Phase 3** | 😶 냉담/경계 |
| 미디움 | 40 | 0 | **40** | **Phase 2** | 🙂 담담/중립 |
| 하드 | 40 | -8 | **32** | **Phase 2** | 🙂 담담/중립 |

> [!NOTE]
> **결론**: 이지에서만 Phase3으로 시작하고, 미디움/하드는 둘 다 Phase2에서 시작합니다.
> Phase2가 "중립 표정"이라 자연스럽습니다. 이지의 Phase3 시작도 "조금 더 관심 있는 표정"이니 난이도 쉬운 느낌과 맞습니다.
> **별도 처리 불필요** — 현재 공식이 난이도와 자연스럽게 연동됩니다. ✅

### 2. 배경 Phase 연동 → ✅ 채택

초반 어두운 분위기(BG02) → 설득될수록 밝은 분위기(BG01)로 전환:

| 게이지 구간 | BG | 분위기 |
|------------|-----|--------|
| 0~50 | `BG02.png` (어두운 측면) | 긴장감, 불확실 |
| 51~100 | `BG01.png` (밝은 전경) | 열림, 설득 분위기 |

### 3. 정통/밈에 따른 캐릭터 시리즈 → ✅ 확정

| 톤 모드 | 캐릭터 시리즈 | 설명 |
|---------|-------------|------|
| **정통** (classic) | `Front-NoBG-Phase0X.png` | 상반신, 정통 곤룡포 |
| **밈** (meme) | `Hip-Front-NoBG-Phase0X.png` | 전신, 캐주얼한 느낌 |

톤 전환 시 같은 Phase 번호의 다른 시리즈 이미지로 즉시 교체.

### 4. 레이아웃: 좌 1/3 캐릭터 + 우 2/3 대화창 → ✅ 확정

```
┌──────────┬───────────────────────────┐
│          │  [헤더: 이름·게이지·토글]     │
│  캐릭터   │                            │
│  (1/3)   │  [대화 로그 영역]            │
│          │  지난 대화 → 투명하게         │
│ Phase별  │  현재 대화 → 뚜렷하게/크게    │
│ 표정 변화 │                            │
│          │  [입력창]                    │
└──────────┴───────────────────────────┘
```

### 5. 대화 말풍선 스타일 → ✅ 확정

- **지난 대화**: `opacity: 0.55` 정도로 투명하게
- **최신 대화**: 기본 불투명 + `font-weight: 700` 또는 `font-size` 살짝 크게
- 새 메시지 추가 시 이전 메시지들의 opacity를 낮추는 방식

### 6. Phase 전환 → 페이드 애니메이션 ✅ 확정

CSS `transition: opacity 0.4s` + JS에서 이미지 교체 시:
1. 현재 이미지 `opacity → 0` (0.3s)
2. `src` 교체
3. `onload` 후 `opacity → 1` (0.3s)

---

## Unity 필요 여부

> [!TIP]
> **Unity 불필요합니다.** 이 게임에 필요한 것은 전부 웹 기술로 충분합니다:
>
> | 기능 | 현재 기술 | Unity가 필요한 경우 |
> |------|----------|-------------------|
> | 캐릭터 표정 전환 | CSS 페이드 + 이미지 교체 ✅ | 3D 모델 실시간 애니메이션 |
> | 배경 전환 | CSS transition ✅ | 3D 환경/파티클 |
> | 대화 UI | HTML/CSS ✅ | 복잡한 물리 기반 UI |
> | AI 판정 | Fetch API → Claude ✅ | 동일 |
> | 게이지/애니메이션 | CSS animation ✅ | 실시간 물리 시뮬레이션 |
>
> 이 게임의 핵심은 **텍스트 대화 + AI 판정**이고, 비주얼은 2D 이미지 레이어 기반입니다.
> Vite + 바닐라 JS로 완벽히 구현 가능하며, 오히려 웹이 **배포·접근성·반응형**에서 유리합니다.

---

## 수정할 파일 상세

### [MODIFY] [style.css](file:///c:/2026/_%20NHN%20Game%20x%20AI%20Hackathon/PxW/EXTRA_Jhun/EXTRA/web/src/style.css)

**변경 1 — 레이아웃 구조**: `#scr-chat`을 `flex` 가로 배치 (좌: 캐릭터 1/3, 우: 대화 2/3)

```css
#scr-chat {
  display: flex;
  flex-direction: row;   /* 가로 배치 */
}
#char-panel {
  width: 33%;            /* 좌측 1/3 캐릭터 영역 */
  position: relative;
  display: flex;
  align-items: flex-end;  /* 캐릭터 하단 정렬 */
  justify-content: center;
}
.chat-main {
  width: 67%;            /* 우측 2/3 대화 영역 */
  display: flex;
  flex-direction: column;
}
```

**변경 2 — 배경 레이어**: `::before`를 BG 이미지 전용으로

```css
#scr-chat[data-theme]::before {
  background: var(--scene-bg) center / cover no-repeat;
}
```

**변경 3 — 캐릭터 이미지 스타일**:

```css
#char-portrait {
  width: 100%;
  max-height: 80vh;
  object-fit: contain;
  object-position: bottom center;
  transition: opacity 0.35s ease;
  z-index: 1;
}
```

**변경 4 — 대화 말풍선 페이드**:

```css
.msg.faded { opacity: 0.55; }                    /* 지난 대화 */
.msg.latest { font-weight: 700; font-size: 1rem; } /* 최신 대화 */
```

---

### [MODIFY] [app.js](file:///c:/2026/_%20NHN%20Game%20x%20AI%20Hackathon/PxW/EXTRA_Jhun/EXTRA/web/src/app.js)

**변경 1 — `updateScene()` 리팩터**:

```js
function updateScene() {
  const sc = $("scr-chat");
  const portrait = $("char-portrait");
  const ph = phaseFromGauge(state.gauge);

  if (charId === "sejong") {
    // 배경: 게이지에 따라 BG 전환
    const bg = state.gauge > 50
      ? "/Assets/Sejong/BG01.png"
      : "/Assets/Sejong/BG02.png";
    sc.style.setProperty("--scene-bg", `url("${bg}")`);

    // 캐릭터: 톤에 따라 시리즈 선택
    const series = tone === "meme"
      ? "Hip-Front-NoBG"
      : "Front-NoBG";
    fadePortrait(portrait, `/Assets/Sejong/${series}-Phase0${ph}.png`);

  } else if (charId === "vangogh") {
    const bg = state.gauge > 50
      ? "/Assets/gogh/Gogh-BG01.png"
      : "/Assets/gogh/Gogh-BG02_night.png";
    sc.style.setProperty("--scene-bg", `url("${bg}")`);

    const series = tone === "meme"
      ? "Hip-NoBG_Gogh"
      : "NoBG_Gogh";
    fadePortrait(portrait, `/Assets/gogh/${series}-Phase0${ph}.png`);
  }
}
```

**변경 2 — 페이드 전환 함수**:

```js
function fadePortrait(el, newSrc) {
  if (el.src.endsWith(newSrc)) return; // 같은 이미지면 스킵
  el.style.opacity = "0";
  setTimeout(() => {
    el.src = newSrc;
    el.onload = () => { el.style.opacity = "1"; };
  }, 300);
}
```

**변경 3 — 대화 말풍선 페이드 처리**:

```js
function addLine(text, cls) {
  // 기존 최신 메시지에서 latest 제거 + faded 추가
  document.querySelectorAll(".msg.latest").forEach(m => {
    m.classList.remove("latest");
    m.classList.add("faded");
  });
  const div = document.createElement("div");
  div.className = "msg " + cls + " latest";
  div.textContent = text;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}
```

**변경 4 — 톤 전환 시 캐릭터 시리즈 교체**:

기존 톤 전환 핸들러에 `updateScene()` 호출 추가 (톤 바뀌면 Front-NoBG ↔ Hip-Front-NoBG 교체)

---

### [MODIFY] [index.html](file:///c:/2026/_%20NHN%20Game%20x%20AI%20Hackathon/PxW/EXTRA_Jhun/EXTRA/web/index.html)

`#scr-chat` 내부를 좌우 분할 구조로 변경:

```html
<section id="scr-chat" class="screen" data-theme="">
  <!-- 좌측: 캐릭터 패널 -->
  <div id="char-panel">
    <img id="char-portrait" src="" alt="캐릭터" />
  </div>
  <!-- 우측: 대화 영역 -->
  <div class="chat-main">
    <div class="chat-head">...</div>
    <div class="log" id="log">...</div>
    <form id="turn-form">...</form>
  </div>
</section>
```

---

## 모바일 대응

> [!WARNING]
> 현재 `max-width: 480px`로 모바일 퍼스트 디자인입니다. 좌 1/3 + 우 2/3 배치는 480px에서 캐릭터 영역이 ~160px로 좁을 수 있습니다.
>
> **대안**: 모바일에서는 캐릭터를 상단 작은 원형 프로필로 표시하고, 데스크톱에서만 좌측 패널로 표시하는 반응형 처리를 고려할 수 있습니다. 이 부분은 구현 후 실제로 보고 조정하면 됩니다.

---

## 검증 계획

1. `npm run dev`로 실행 후 브라우저에서 확인
2. 세종 선택 → BG02 어두운 배경 + Phase02 캐릭터 표시 확인
3. 대화 진행 → 게이지 상승 시 캐릭터 표정 페이드 전환 확인
4. 게이지 50 초과 시 BG02 → BG01 배경 전환 확인
5. 정통↔밈 토글 시 Front-NoBG ↔ Hip-Front-NoBG 전환 확인
6. 지난 대화 투명화 + 최신 대화 강조 확인
7. 반 고흐도 동일 동작 확인
