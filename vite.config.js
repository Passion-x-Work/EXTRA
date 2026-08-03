import { defineConfig } from "vite";

// web/ 을 루트로 쓰되, 형제 폴더(server·config·content)의 순수 모듈/JSON을 import 허용.
export default defineConfig({
  root: "web",
  server: { fs: { allow: [".."] } },
  build: { outDir: "../dist", emptyOutDir: true },
});
