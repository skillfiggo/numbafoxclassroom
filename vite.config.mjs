import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  plugins: [
    cloudflare({
      viteEnvironment: { name: "worker" },
      config: {
        name: "jambandwaec-classroom",
        main: "./cloudflare/worker.mjs",
        compatibility_date: "2026-11-22",
        assets: { binding: "ASSETS", run_worker_first: ["/api/*", "/room/*"] },
        durable_objects: { bindings: [{ name: "CLASSROOM_ROOM", class_name: "ClassroomRoom" }] },
        migrations: [{ tag: "v1", new_sqlite_classes: ["ClassroomRoom"] }]
      }
    })
  ],
  environments: { worker: { build: { sourcemap: true } } }
});
