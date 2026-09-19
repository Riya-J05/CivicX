import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

const SUPABASE_URL_FALLBACK =
  "https://hnabjzqzfimxepbyycfx.supabase.co";

const SUPABASE_PUBLISHABLE_KEY_FALLBACK =
  "sb_publishable_AT4OIfr1L75T3Z00Mr1eKA_Z7qTKv45";

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
    server: { entry: "server" },
  },
  vite: {
    optimizeDeps: {
      exclude: ["maplibre-gl"],
    },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":
        JSON.stringify(supabaseKey),
      "process.env.SUPABASE_URL": JSON.stringify(supabaseUrl),
      "process.env.SUPABASE_PUBLISHABLE_KEY":
        JSON.stringify(supabaseKey),
    },
  },
});