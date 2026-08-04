import { defineConfig } from "vite";

// web/ 을 루트로 쓰되, 형제 폴더(server·config·content)의 순수 모듈/JSON을 import 허용.
// /api 는 판정 프록시(server/index.mjs, :8787)로 프록시.
export default defineConfig({
  root: "web",
  server: {
    fs: { allow: [".."] },
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
