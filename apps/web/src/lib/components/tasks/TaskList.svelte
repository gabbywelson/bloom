<script lang="ts">
  import type { UiTask } from "../../types";

  interface Props {
    tasks: ReadonlyArray<UiTask>;
    onrefresh: () => void;
    loading?: boolean;
  }

  let { tasks, onrefresh, loading = false }: Props = $props();

  const open = $derived(tasks.filter((t) => t.status !== "done"));
  const done = $derived(tasks.filter((t) => t.status === "done"));

  const dueLabel = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };
</script>

<aside class="tasks" aria-label="Tasks">
  <header class="head">
    <h2>Today</h2>
    <button type="button" class="btn btn-quiet small" onclick={onrefresh} disabled={loading}>
      {loading ? "Refreshing" : "Refresh"}
    </button>
  </header>

  {#if open.length === 0}
    <p class="muted small">Nothing waiting on you.</p>
  {:else}
    <ul class="list">
      {#each open as task (task.id)}
        <li class="task card" data-status={task.status}>
          <div class="row">
            <span class="title">{task.title}</span>
            {#if task.effort !== undefined}
              <span class="spoons small muted">
                {task.effort} {task.effort === 1 ? "spoon" : "spoons"}
              </span>
            {/if}
          </div>
          <div class="meta small muted">
            {#if task.area}<span>{task.area}</span>{/if}
            {#if task.due}<span>{dueLabel(task.due)}</span>{/if}
            {#if task.status === "snoozed"}<span>snoozed</span>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if done.length > 0}
    <details class="done">
      <summary class="small muted">Done ({done.length})</summary>
      <ul class="list">
        {#each done as task (task.id)}
          <li class="task done-task small muted">{task.title}</li>
        {/each}
      </ul>
    </details>
  {/if}
</aside>

<style>
  .tasks {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }

  .task {
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-1);
  }

  .task[data-status="snoozed"] {
    opacity: 0.7;
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .spoons {
    flex-shrink: 0;
  }

  .meta {
    display: flex;
    gap: var(--space-3);
  }

  .done summary {
    cursor: pointer;
    padding: var(--space-1) 0;
  }

  .done-task {
    padding: var(--space-1) var(--space-2);
    text-decoration: line-through;
  }
</style>
