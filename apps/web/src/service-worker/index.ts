/**
 * Bloom service worker.
 *
 * SvelteKit bundles this file and registers it automatically (as a module)
 * because it lives at src/service-worker/index.ts and `serviceWorker.register`
 * is left at its default. See https://svelte.dev/docs/kit/service-workers.
 *
 * Strategy:
 * - install: precache the Vite build output (`immutable`) and `static/` files.
 * - activate: drop caches from previous versions.
 * - fetch: cache-first for precached assets; network-first for navigations
 *   with a cached fallback so the shell opens offline. `/api` is never cached.
 */
import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";
import { resolve } from "$app/paths";
import { self } from "$app/service-worker";

const CACHE = `bloom-${version}`;

/** The configured base path ("" unless `paths.base` is set). */
const BASE = resolve("/").replace(/\/$/, "");

// Manifest paths are relative to the base path. `resolve()` is typed against
// the app's route ids and static asset names, so prefix by hand here.
const withBase = (path: string) => `${BASE}/${path.replace(/^\//, "")}`;

const PRECACHE = [
  ...immutable.map((asset) => withBase(asset.path)),
  ...assets.map((asset) => withBase(asset.path)),
];

const PRECACHE_SET = new Set<string>(PRECACHE);

const API_PREFIX = `${BASE}/api`;

const isApi = (url: URL) =>
  url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`);

self.addEventListener("install", (event) => {
  const precache = async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  };
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  const cleanup = async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  };
  event.waitUntil(cleanup());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  const respond = async (): Promise<Response> => {
    const cache = await caches.open(CACHE);

    // Cache-first for anything we precached.
    if (PRECACHE_SET.has(url.pathname)) {
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
    }

    // Network-first for navigations and everything else, falling back to the
    // cache (and, for navigations, to the SPA shell) when offline.
    try {
      const response = await fetch(event.request);
      const cacheControl = response.headers.get("cache-control") ?? "";
      if (response.status === 200 && !cacheControl.includes("no-store")) {
        void cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") {
        const shell = await cache.match(resolve("/"));
        if (shell) return shell;
      }
      throw error;
    }
  };

  event.respondWith(respond());
});
