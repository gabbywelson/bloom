// Bloom is a client-rendered single-page app. Nothing is server-rendered or
// prerendered; adapter-static emits 200.html as the fallback for every route.
// See https://svelte.dev/docs/kit/single-page-apps.
export const ssr = false;
export const prerender = false;
