<script lang="ts">
  import { dueLabel } from "../../format";
  import type { SnoozeChoice, SnoozePicker, UiActionHandler } from "../../types";

  interface Props {
    component: SnoozePicker;
    /** A reply is streaming; the choice could not be sent yet, so the buttons wait. */
    busy?: boolean;
    onaction: UiActionHandler;
  }

  let { component, busy = false, onaction }: Props = $props();

  /** The choice whose action is in flight. */
  let pending = $state<string | null>(null);
  /** The choice Bloom received; set only once the handler confirms it. */
  let picked = $state<string | null>(null);

  const locked = $derived(busy || pending !== null || picked !== null);

  const pick = async (choice: SnoozeChoice) => {
    if (locked) return;
    pending = choice.id;
    try {
      if (await onaction({ kind: "snooze_picker", choice })) picked = choice.id;
    } finally {
      pending = null;
    }
  };
</script>

<div class="snooze">
  <p class="muted">{component.prompt}</p>
  <div class="choices" role="group" aria-label={component.prompt}>
    {#each component.choices as choice (choice.id)}
      <button
        type="button"
        class="btn choice"
        class:picked={picked === choice.id}
        aria-pressed={picked === choice.id}
        aria-busy={pending === choice.id}
        disabled={locked && picked !== choice.id}
        onclick={() => void pick(choice)}
      >
        <span>{choice.label}</span>
        <span class="small muted">{dueLabel(choice.until)}</span>
      </button>
    {/each}
    {#if component.choices.length === 0}
      <p class="small muted">No snooze options were provided.</p>
    {/if}
  </div>
</div>

<style>
  .snooze {
    display: grid;
    gap: var(--space-3);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .choice {
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    border-radius: var(--radius-sm);
    text-align: left;
  }

  .picked {
    border-color: var(--color-sage);
    background: var(--color-sage-soft);
  }
</style>
