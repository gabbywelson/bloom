<script lang="ts">
  /**
   * Captures waiting for triage (ADR 0019): from the phone's share sheet, the
   * iOS quick-capture surfaces, and the field below. Newest first; dismiss
   * takes one off the list without filing it anywhere.
   */
  import { onMount } from "svelte";
  import { captureText, dismissCapture, loadNewCaptures } from "#lib/api.js";
  import { captureSummary } from "#lib/captures.js";
  import Flower from "#lib/components/Flower.svelte";
  import { dueLabel, timeLabel } from "#lib/format.js";
  import type { CaptureId, CaptureJson } from "#lib/types.js";

  let captures = $state.raw<ReadonlyArray<CaptureJson>>([]);
  let loading = $state(true);
  let saving = $state(false);
  let dismissing = $state<CaptureId | null>(null);
  let error = $state<string | null>(null);
  let draft = $state("");

  const kindLabel: Record<CaptureJson["kind"], string> = {
    text: "Note",
    share: "Link",
    image: "Photo",
    voice: "Voice",
  };

  const load = async () => {
    loading = true;
    error = null;
    try {
      captures = (await loadNewCaptures()).toReversed();
    } catch {
      error = "Couldn't load captures just now.";
    } finally {
      loading = false;
    }
  };

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || saving) return;
    saving = true;
    error = null;
    try {
      const capture = await captureText(text);
      captures = [capture, ...captures];
      draft = "";
    } catch {
      error = "That didn't save. Give it a moment and try again.";
    } finally {
      saving = false;
    }
  };

  const dismiss = async (id: CaptureId) => {
    if (dismissing !== null) return;
    dismissing = id;
    error = null;
    try {
      await dismissCapture(id);
      captures = captures.filter((capture) => capture.id !== id);
    } catch {
      error = "Couldn't dismiss that just now.";
    } finally {
      dismissing = null;
    }
  };

  onMount(() => {
    void load();
  });
</script>

<section class="captures" aria-label="Captures" data-testid="captures">
  <header class="head">
    <h1>Captures</h1>
    <button type="button" class="btn btn-quiet small" onclick={() => void load()} disabled={loading}>
      {loading ? "Refreshing" : "Refresh"}
    </button>
  </header>
  <p class="muted small">
    Captures wait here until Bloom sorts them. Share links and photos from the phone's share
    sheet, or jot something down.
  </p>

  <form class="jot card" onsubmit={save}>
    <label class="visually-hidden" for="jot">Jot something down</label>
    <input
      id="jot"
      class="input"
      placeholder="Jot something down"
      autocomplete="off"
      data-testid="capture-input"
      bind:value={draft}
      disabled={saving}
    />
    <button type="submit" class="btn btn-primary" disabled={saving || draft.trim().length === 0}>
      {saving ? "Saving" : "Capture"}
    </button>
  </form>

  {#if error}
    <p class="error small" role="alert">{error}</p>
  {/if}

  {#if captures.length === 0}
    <div class="empty">
      <Flower state={loading ? "opening" : "closed"} size={40} />
      <p class="muted">{loading ? "Looking" : "Nothing captured yet."}</p>
    </div>
  {:else}
    <ul class="list">
      {#each captures as capture (capture.id)}
        {@const summary = captureSummary(capture)}
        <li class="item card" data-testid="capture-item" data-kind={capture.kind}>
          {#if summary.image}
            <img class="thumb" src={summary.image} alt={summary.title} />
          {/if}
          <div class="body">
            <span class="chip small">{kindLabel[capture.kind]}</span>
            {#if summary.url}
              <a class="title" href={summary.url} target="_blank" rel="noopener noreferrer">
                {summary.title}
              </a>
            {:else}
              <span class="title">{summary.title}</span>
            {/if}
            {#if summary.detail}
              <span class="small muted">{summary.detail}</span>
            {/if}
            <time class="small muted">
              {dueLabel(capture.createdAt)}, {timeLabel(capture.createdAt)}
            </time>
          </div>
          <button
            type="button"
            class="btn btn-quiet small"
            onclick={() => void dismiss(capture.id)}
            disabled={dismissing !== null}
          >
            {dismissing === capture.id ? "Dismissing" : "Dismiss"}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .captures {
    width: 100%;
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-5);
    display: grid;
    gap: var(--space-4);
    align-content: start;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h1 {
    font-size: var(--text-xl);
    margin: 0;
  }

  .jot {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .input {
    flex: 1;
    border: none;
    background: transparent;
    padding: var(--space-2);
  }

  .input:focus-visible {
    outline: none;
  }

  .jot:focus-within {
    outline: 2px solid var(--color-sage);
    outline-offset: 2px;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }

  .item {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .thumb {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }

  .body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: var(--space-1);
  }

  .title {
    color: var(--color-ink);
    overflow-wrap: anywhere;
  }

  .chip {
    justify-self: start;
    color: var(--color-ink-muted);
    background: var(--color-surface-muted);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-7) 0;
  }

  .error {
    color: var(--color-danger);
  }
</style>
