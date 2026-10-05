<script lang="ts">
  /**
   * Main two-pane shell: the conversation on the left, today's tasks on the
   * right. Data is placeholder for now; the next wave swaps these arrays for
   * the typed @bloom/api client without touching ThreadView / TaskList.
   */
  import TaskList from "#lib/components/tasks/TaskList.svelte";
  import ThreadView from "#lib/components/thread/ThreadView.svelte";
  import type { UiAction, UiMessage, UiTask } from "#lib/types.js";

  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  let messages = $state<UiMessage[]>([
    {
      id: "m1",
      role: "assistant",
      createdAt: minutesAgo(32),
      parts: [
        {
          type: "text",
          text: "Morning. The week looks lighter than last one. Two things are due today and one of them is small.",
        },
      ],
    },
    {
      id: "m2",
      role: "user",
      createdAt: minutesAgo(30),
      parts: [{ type: "text", text: "Which one is small?" }],
    },
    {
      id: "m3",
      role: "assistant",
      createdAt: minutesAgo(29),
      parts: [
        { type: "tool_call", id: "t1", name: "list_tasks", args: { due: "today" } },
        { type: "tool_result", toolCallId: "t1", name: "list_tasks", result: { count: 2 } },
        { type: "text", text: "Renewing the library card. It takes a minute online." },
        {
          type: "ui_component",
          component: {
            id: "c1",
            kind: "task_card",
            props: {
              title: "Renew library card",
              notes: "The old one lapses Friday.",
              due: "today",
              effort: 1,
              area: "Home",
            },
          },
        },
      ],
    },
    {
      id: "m4",
      role: "assistant",
      createdAt: minutesAgo(28),
      parts: [
        { type: "text", text: "Want to do it now, or should I bring it back later?" },
        {
          type: "ui_component",
          component: {
            id: "c2",
            kind: "option_picker",
            props: {
              options: [
                { id: "now", label: "Now", hint: "I'll open the page" },
                { id: "later", label: "Later today" },
                { id: "skip", label: "Not this week" },
              ],
            },
          },
        },
      ],
    },
  ]);

  let streaming = $state(false);

  let tasks = $state<UiTask[]>([
    {
      id: "t1",
      title: "Renew library card",
      status: "open",
      due: new Date(now).toISOString(),
      effort: 1,
      area: "Home",
    },
    {
      id: "t2",
      title: "Reply to the landlord about the heating",
      status: "open",
      due: new Date(now).toISOString(),
      effort: 2,
      area: "Home",
    },
    {
      id: "t3",
      title: "Book a dentist check-up",
      status: "snoozed",
      due: new Date(now + 3 * 86_400_000).toISOString(),
      effort: 2,
      area: "Health",
    },
    { id: "t4", title: "Water the plants", status: "done", area: "Home" },
  ]);

  let refreshing = $state(false);

  const send = (text: string) => {
    messages.push({
      id: `local-${Date.now()}`,
      role: "user",
      createdAt: new Date().toISOString(),
      parts: [{ type: "text", text }],
    });
    // Placeholder reply until the API is wired in.
    streaming = true;
    setTimeout(() => {
      streaming = false;
      messages.push({
        id: `local-${Date.now()}`,
        role: "assistant",
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text: "Noted. I'm not connected to anything yet, but I heard you." }],
      });
    }, 1200);
  };

  const onaction = (action: UiAction) => {
    messages.push({
      id: `local-${Date.now()}`,
      role: "system",
      createdAt: new Date().toISOString(),
      parts: [{ type: "text", text: `Action from ${action.id}: ${JSON.stringify(action.payload)}` }],
    });
  };

  const refresh = () => {
    refreshing = true;
    setTimeout(() => {
      refreshing = false;
    }, 600);
  };
</script>

<div class="shell">
  <div class="thread-pane">
    <ThreadView {messages} {streaming} onsend={send} {onaction} />
  </div>
  <div class="side-pane">
    <TaskList {tasks} onrefresh={refresh} loading={refreshing} />
  </div>
</div>

<style>
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
