<script lang="ts">
  import { resolve } from "$app/paths";
  import Flower from "./Flower.svelte";
  import type { FlowerState } from "./Flower.svelte";

  interface Props {
    flower?: FlowerState;
    signedIn?: boolean;
  }

  let { flower = "open", signedIn = false }: Props = $props();
</script>

<header class="header">
  <a class="brand" href={resolve("/")} aria-label="Bloom home">
    <Flower state={flower} size={28} />
    <span class="name">Bloom</span>
  </a>
  {#if signedIn}
    <nav class="nav" aria-label="Sections">
      <a class="nav-link" href={resolve("/captures")}>Captures</a>
      <a class="nav-link" href={resolve("/passkeys")}>Passkeys</a>
    </nav>
  {/if}
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-page) 88%, transparent);
    backdrop-filter: blur(8px);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-ink);
    text-decoration: none;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .name {
    font-size: var(--text-lg);
  }

  .nav-link {
    color: var(--color-ink-muted);
    text-decoration: none;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    transition: background var(--transition);
  }

  .nav-link:hover {
    background: var(--color-surface-muted);
    color: var(--color-ink);
  }
</style>
