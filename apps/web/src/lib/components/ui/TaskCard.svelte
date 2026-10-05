<script lang="ts">
  import type { UiComponentProps } from "./registry";

  let { component, onaction }: UiComponentProps = $props();

  const text = (key: string): string | undefined => {
    const value = component.props[key];
    return typeof value === "string" ? value : undefined;
  };

  const title = $derived(text("title") ?? "Untitled task");
  const notes = $derived(text("notes"));
  const due = $derived(text("due"));
  const area = $derived(text("area"));
  const effort = $derived(
    typeof component.props.effort === "number" ? component.props.effort : undefined,
  );

  let done = $state(false);

  const act = (action: "done" | "snooze" | "open") => {
    if (action === "done") done = true;
    onaction({ id: component.id, payload: { action } });
  };
</script>

<article class="task-card" class:done>
  <header class="head">
    <h3 class="title">{title}</h3>
    {#if area}
      <span class="area small">{area}</span>
    {/if}
  </header>
  {#if notes}
    <p class="notes muted">{notes}</p>
  {/if}
  <p class="meta small muted">
    {#if due}<span>Due {due}</span>{/if}
    {#if effort !== undefined}<span>{effort} {effort === 1 ? "spoon" : "spoons"}</span>{/if}
  </p>
  <div class="actions">
    <button type="button" class="btn" disabled={done} onclick={() => act("done")}>
      {done ? "Done" : "Mark done"}
    </button>
    <button type="button" class="btn btn-quiet" disabled={done} onclick={() => act("snooze")}>
      Snooze
    </button>
    <button type="button" class="btn btn-quiet" onclick={() => act("open")}>Open</button>
  </div>
</article>

<style>
  .task-card {
    display: grid;
    gap: var(--space-2);
  }

  .task-card.done .title {
    text-decoration: line-through;
    color: var(--color-ink-muted);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .area {
    color: var(--color-ink-muted);
    background: var(--color-sage-soft);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
  }

  .meta {
    display: flex;
    gap: var(--space-3);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
