<script lang="ts">
  import { dueLabel } from "../../format";
  import type { TaskId, TaskJson, TaskStatus } from "../../types";

  interface Props {
    tasks: ReadonlyArray<TaskJson>;
    onrefresh: () => void;
    oncomplete: (id: TaskId) => void;
    loading?: boolean;
    /** Id of the task whose "done" request is in flight, or null. */
    completing?: TaskId | null;
    error?: string | null;
  }

  let {
    tasks,
    onrefresh,
    oncomplete,
    loading = false,
    completing = null,
    error = null,
  }: Props = $props();

  const OPEN: ReadonlyArray<TaskStatus> = ["inbox", "next", "scheduled", "waiting"];

  const open = $derived(tasks.filter((task) => OPEN.includes(task.status)));
  const done = $derived(tasks.filter((task) => task.status === "done"));

  const statusLabel: Record<TaskStatus, string> = {
    inbox: "Inbox",
    next: "Next",
    scheduled: "Scheduled",
    waiting: "Waiting",
    done: "Done",
    dropped: "Dropped",
  };

  const whenLabel = (task: TaskJson): string | null => {
    if (task.due !== null) return `Due ${dueLabel(task.due)}`;
    if (task.scheduledFor !== null) return dueLabel(task.scheduledFor);
    return null;
  };
</script>

<aside class="tasks" aria-label="Tasks" data-testid="task-list">
  <header class="head">
    <h2>Tasks</h2>
    <button type="button" class="btn btn-quiet small" onclick={onrefresh} disabled={loading}>
      {loading ? "Refreshing" : "Refresh"}
    </button>
  </header>

  {#if open.length === 0}
    <p class="muted small">{loading ? "Looking" : "Nothing waiting on you."}</p>
  {:else}
    <ul class="list">
      {#each open as task (task.id)}
        <li class="task card" data-status={task.status} data-testid="task-item">
          <div class="row">
            <span class="title">{task.title}</span>
            <span class="chip small" data-status={task.status}>{statusLabel[task.status]}</span>
          </div>
          <div class="meta small muted">
            {#if task.area}<span>{task.area}</span>{/if}
            {#if whenLabel(task)}<span>{whenLabel(task)}</span>{/if}
            {#if task.effort !== null}
              <span>{task.effort} {task.effort === 1 ? "spoon" : "spoons"}</span>
            {/if}
          </div>
          <div class="actions">
            <button
              type="button"
              class="btn small"
              data-testid="task-done"
              disabled={completing !== null}
              onclick={() => oncomplete(task.id)}
            >
              {completing === task.id ? "Saving" : "Done"}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <p class="error small" role="alert">{error}</p>
  {/if}

  {#if done.length > 0}
    <details class="done">
      <summary class="small muted">Done ({done.length})</summary>
      <ul class="list">
        {#each done as task (task.id)}
          <li class="done-task small muted">{task.title}</li>
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

  .task[data-status="waiting"] {
    opacity: 0.75;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
  }

  .chip {
    flex-shrink: 0;
    color: var(--color-ink-muted);
    background: var(--color-surface-muted);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
  }

  .chip[data-status="next"] {
    background: var(--color-sage-soft);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-1);
  }

  .error {
    color: var(--color-danger);
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
