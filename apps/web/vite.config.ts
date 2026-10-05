import adapterStatic from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },

      // Bloom is a single-page app: every route is client-rendered (see
      // src/routes/+layout.ts) and the Bun server serves this build from "/"
      // with 200.html as the SPA fallback. See docs/adrs/0004-single-origin-web-and-api.md.
      adapter: adapterStatic({ fallback: "200.html" }),
    }),
  ],

  server: {
    // Dev only: the browser talks to one origin. /api (including /api/auth) is
    // proxied to the Bun server so cookies and passkeys bind to the web origin.
    // BLOOM_API_PROXY points it at a server on another port (scripts/e2e.sh).
    proxy: {
      "/api": {
        target: process.env["BLOOM_API_PROXY"] ?? "http://localhost:3000",
        changeOrigin: false,
      },
    },
  },
});
