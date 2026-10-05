<script lang="ts">
  import "../app.css";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import Flower from "#lib/components/Flower.svelte";
  import Header from "#lib/components/Header.svelte";
  import { session } from "#lib/session.svelte.js";
  import type { LayoutProps } from "./$types";

  let { children }: LayoutProps = $props();

  const onLogin = $derived(page.route.id === "/login");
  const signedIn = $derived(session.current !== null);

  // Route guard: once the session has settled, anyone without a user goes to
  // /login. The login page itself is always reachable.
  $effect(() => {
    if (!session.loading && !signedIn && !onLogin) {
      void goto(resolve("/login"), { replace: true });
    }
  });

  const flowerState = $derived(session.loading ? "closed" : "open");
</script>

<div class="app">
  <Header flower={flowerState} {signedIn} />
  <main class="main">
    <div class="visually-hidden" aria-live="polite">{session.loading ? "Bloom is resting" : ""}</div>
    {#if session.loading}
      <div class="resting" aria-busy="true">
        <Flower state="closed" size={48} label="Bloom is resting" />
        <p class="muted small">Resting</p>
      </div>
    {:else if signedIn || onLogin}
      {@render children()}
    {/if}
  </main>
</div>

<style>
  .app {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .resting {
    margin: auto;
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-7);
  }
</style>
