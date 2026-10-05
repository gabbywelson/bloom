<script lang="ts">
  /**
   * Main two-pane shell: the conversation on the left, tasks on the right.
   * Data comes from the typed client (`#lib/api`); the chat stream is folded
   * into `messages` one event at a time by the pure reducer in `#lib/chat`.
   */
  import { onMount } from "svelte";
  import { DateTime } from "effect";
  import { completeTask, loadMainThread, loadMessages, loadTasks, sendMessage } from "#lib/api.js";
  import { applyEvent } from "#lib/chat.js";
  import Flower from "#lib/components/Flower.svelte";
  import TaskList from "#lib/components/tasks/TaskList.svelte";
  import ThreadView from "#lib/components/thread/ThreadView.svelte";
  import {
    type ChatMessage,
    type TaskId,
    type TaskJson,
    type ThreadJson,
    toChatMessage,
    type UiAction,
    type UiActionHandler,
  } from "#lib/types.js";

  const CALM_FAILURE = "That didn't go through. Give it a moment and try again.";

  let thread = $state<ThreadJson | null>(null);
  // Replaced wholesale on every change, so no deep proxy is needed.
  let messages = $state.raw<ReadonlyArray<ChatMessage>>([]);
  let tasks = $state.raw<ReadonlyArray<TaskJson>>([]);

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let streaming = $state(false);
  let chatError = $state<string | null>(null);
  let tasksLoading = $state(false);
  let tasksError = $state<string | null>(null);
  let completing = $state<TaskId | null>(null);

  const refreshTasks = async () => {
    tasksLoading = true;
    tasksError = null;
    try {
      tasks = await loadTasks();
    } catch {
      tasksError = "Couldn't refresh tasks just now.";
    } finally {
      tasksLoading = false;
    }
  };

  const load = async () => {
    loading = true;
    loadError = null;
    try {
      const [main] = await Promise.all([loadMainThread(), refreshTasks()]);
      thread = main;
      messages = (await loadMessages(main.id)).map(toChatMessage);
    } catch {
      loadError = "Bloom couldn't open the conversation.";
    } finally {
      loading = false;
    }
  };

  // The layout only mounts this page once the session is ready (see +layout.svelte).
  onMount(() => {
    void load();
  });

  /** Sends one user turn; resolves `true` once the reply stream has ended normally. */
  const send = async (text: string): Promise<boolean> => {
    const target = thread;
    if (target === null || streaming) return false;
    chatError = null;
    messages = [
      ...messages,
      {
        id: `local-${crypto.randomUUID()}`,
        role: "user",
        parts: [{ type: "text", text }],
        createdAt: DateTime.nowUnsafe(),
      },
    ];
    streaming = true;
    try {
      await sendMessage(target.id, text, (event) => {
        messages = applyEvent(messages, event, DateTime.nowUnsafe());
        if (event.type === "tasks_changed") void refreshTasks();
        if (event.type === "error") chatError = event.message;
      });
      return true;
    } catch {
      chatError = CALM_FAILURE;
      return false;
    } finally {
      streaming = false;
    }
  };

  /** Marks a task done through the API; resolves `true` when the server accepted it. */
  const complete = async (id: TaskId): Promise<boolean> => {
    if (completing !== null) return false;
    completing = id;
    tasksError = null;
    try {
      await completeTask(id);
      await refreshTasks();
      return true;
    } catch {
      tasksError = "Couldn't mark that done just now.";
      return false;
    } finally {
      completing = null;
    }
  };

  // Generative-UI actions: task cards act directly through the API; everything
  // else goes back to Bloom as the user's reply, so the agent stays in the loop
  // and nothing consequential runs without it. The components disable their
  // buttons while a reply streams (`send` refuses then) and only show a choice
  // as made once the promise resolves `true`.
  const onaction: UiActionHandler = (action: UiAction) => {
    switch (action.kind) {
      case "task_card":
        return complete(action.taskId);
      case "option_picker":
        return send(action.choice.label);
      case "confirm":
        return send(action.label);
      case "snooze_picker":
        return send(`Snooze it until ${action.choice.label.toLowerCase()}.`);
    }
  };
</script>

{#if loading}
  <div class="centered" aria-busy="true">
    <Flower state="opening" size={48} label="Bloom is opening" />
    <p class="muted small">Opening</p>
  </div>
{:else if loadError !== null || thread === null}
  <div class="centered">
    <Flower state="closed" size={48} />
    <p class="error">{loadError ?? "Bloom couldn't open the conversation."}</p>
    <button type="button" class="btn" onclick={() => void load()}>Try again</button>
  </div>
{:else}
  <div class="shell">
    <div class="thread-pane">
      <ThreadView
        {messages}
        {streaming}
        error={chatError}
        onsend={(text) => void send(text)}
        {onaction}
      />
    </div>
    <div class="side-pane">
      <TaskList
        {tasks}
        onrefresh={() => void refreshTasks()}
        oncomplete={(id) => void complete(id)}
        loading={tasksLoading}
        {completing}
        error={tasksError}
      />
    </div>
  </div>
{/if}

<style>
  .centered {
    margin: auto;
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-7);
    text-align: center;
  }

  .error {
    color: var(--color-danger);
  }

  .shell {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--sidebar-width);
    gap: var(--space-5);
    padding: 0 var(--space-5);
    width: 100%;
    max-width: calc(var(--content-max) + var(--sidebar-width) + var(--space-5) * 3);
    margin: 0 auto;
  }

  .thread-pane {
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .side-pane {
    padding: var(--space-5) 0;
    border-left: 1px solid var(--color-border);
    padding-left: var(--space-5);
  }

  @media (max-width: 880px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      padding: 0 var(--space-3);
    }

    .thread-pane {
      height: auto;
      min-height: 60dvh;
    }

    .side-pane {
      border-left: none;
      padding-left: 0;
      border-top: 1px solid var(--color-border);
    }
  }
</style>
