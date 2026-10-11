import { defineConfig } from "vitest/config";
import path from "path";

// Standalone vitest config: kept separate from `vite.config.ts` so
// `npm run build` (tsc + vite build) never touches the test-time deps.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // src-tauri and node_modules never contain frontend tests.
    exclude: ["node_modules/**", "dist/**", "src-tauri/**"],
  },
});
