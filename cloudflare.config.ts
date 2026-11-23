import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "jambandwaec-classroom",
    compatibilityDate: "2026-11-22",
    entrypoint: "./cloudflare/worker.mjs",
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*", "/room/*"]
    },
    env: {
      ASSETS: bindings.assets(),
      CLASSROOM_ROOM: bindings.durableObject({
        worker: "jambandwaec-classroom",
        exportName: "ClassroomRoom"
      }),
      OPENAI_API_KEY: bindings.secret(),
      SUPABASE_PUBLISHABLE_KEY: bindings.secret(),
      SUPABASE_SECRET_KEY: bindings.secret(),
      SUPABASE_URL: bindings.secret()
    },
    exports: {
      ClassroomRoom: exports.durableObject({ storage: "sqlite" })
    }
  }
});
