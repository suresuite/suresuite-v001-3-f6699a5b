import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";

// Build-provenance marker shown in the UI so "is the new code live?" is
// answerable at a glance. Prefer Vercel's commit SHA env var, else git.
function buildSha(): string {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
  // The simulation engine runs in a module Web Worker (src/lib/sim/engine.worker.ts)
  // that dynamically imports Pyodide's ESM build — so the worker bundle must be ESM.
  worker: {
    format: "es",
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  envPrefix: ["VITE_", "SUPABASE_"],
}));
