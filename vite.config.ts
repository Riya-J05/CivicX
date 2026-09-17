// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// Publishable Supabase connection details for the existing Lovable Cloud
// backend. These are NOT secrets — they are the same anon/publishable values
// the browser already ships, and Row Level Security enforces every access.
// They are compiled in as build-time fallbacks because deployment pipelines
// (e.g. Vercel) do not receive the project's .env file, which previously left
// the production bundle with no Supabase URL/key at all. Real environment
// variables of the same name always win over these fallbacks.
const SUPABASE_URL_FALLBACK = "https://hnabjzqzfimxepbyycfx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY_FALLBACK =
  "sb_publishable_AT4OIfr1L75T3Z00Mr1eKA_Z7qTKv45";

// The lovable wrapper takes a plain options object, so env is resolved eagerly.
const env = loadEnv(
  process.env["NODE_ENV"] === "production" ? "production" : "development",
  process.cwd(),
  "",
);

const supabaseUrl =
  process.env["VITE_SUPABASE_URL"] ??
  env["VITE_SUPABASE_URL"] ??
  process.env["SUPABASE_URL"] ??
  env["SUPABASE_URL"] ??
  SUPABASE_URL_FALLBACK;

const supabaseKey =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  env["SUPABASE_PUBLISHABLE_KEY"] ??
  SUPABASE_PUBLISHABLE_KEY_FALLBACK;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // maplibre-gl ships its own web worker; pre-bundling drops the worker chunk
    optimizeDeps: { exclude: ["maplibre-gl"] },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":
        JSON.stringify(supabaseKey),
      // The generated server auth middleware reads process.env.SUPABASE_URL /
      // SUPABASE_PUBLISHABLE_KEY at runtime; hosts like Vercel have neither,
      // which broke every AI server function. Publishable values only.
      "process.env.SUPABASE_URL": JSON.stringify(supabaseUrl),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
    },
  },
});
