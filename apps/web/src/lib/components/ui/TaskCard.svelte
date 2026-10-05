<script lang="ts">
  import { dueLabel } from "../../format";
  import type { TaskCard, UiActionHandler } from "../../types";

  interface Props {
    component: TaskCard;
    onaction: UiActionHandler;
  }

  let { component, onaction }: Props = $props();

  /** The completion request is in flight. */
  let pending = $state(false);
  /** The server accepted the completion; set only once the handler confirms it. */
  let done = $state(false);

  const closed = $derived(done || component.status === "done" || component.status === "dropped");

  const markDone = async () => {
    if (closed || pending) return;
    pending = true;
    try {
      done = await onaction({ kind: "task_card", taskId: component.taskId, action: "done" });
    } finally {
      pending = false;
    }
  };
</script>

<article class="task-card" class:closed>
  <header class="head">
    <h3 class="title">{component.title}</h3>
    <span class="chip small">{closed ? "done" : component.status}</span>
  </header>
  {#if component.due !== null}
    <p class="meta small muted">Due {dueLabel(component.due)}</p>
  {/if}
  <div class="actions">
    <button
      type="button"
      class="btn"
      disabled={closed || pending}
      aria-busy={pending}
      onclick={() => void markDone()}
    >
      {closed ? "Done" : pending ? "Marking done" : "Mark done"}
    </button>
  </div>
</article>

<style>
  .task-card {
    display: grid;
    gap: var(--space-2);
  }

  .task-card.closed .title {
    text-decoration: line-through;
    color: var(--color-ink-muted);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .chip {
    color: var(--color-ink-muted);
    background: var(--color-sage-soft);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
