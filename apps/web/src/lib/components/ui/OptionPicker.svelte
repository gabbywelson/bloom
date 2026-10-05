<script lang="ts">
  import type { OptionPicker, UiActionHandler, UiOption } from "../../types";

  interface Props {
    component: OptionPicker;
    /** A reply is streaming; the choice could not be sent yet, so the buttons wait. */
    busy?: boolean;
    onaction: UiActionHandler;
  }

  let { component, busy = false, onaction }: Props = $props();

  /** The option whose action is in flight. */
  let pending = $state<string | null>(null);
  /** The option Bloom received; set only once the handler confirms it. */
  let chosen = $state<string | null>(null);

  const locked = $derived(busy || pending !== null || chosen !== null);

  const choose = async (option: UiOption) => {
    if (locked) return;
    pending = option.id;
    try {
      if (await onaction({ kind: "option_picker", choice: option })) chosen = option.id;
    } finally {
      pending = null;
    }
  };
</script>

<div class="picker">
  <p class="prompt">{component.prompt}</p>
  <div class="options" role="group" aria-label={component.prompt}>
    {#each component.options as option (option.id)}
      <button
        type="button"
        class="btn option"
        class:chosen={chosen === option.id}
        aria-pressed={chosen === option.id}
        aria-busy={pending === option.id}
        disabled={locked && chosen !== option.id}
        onclick={() => void choose(option)}
      >
        {option.label}
      </button>
    {/each}
    {#if component.options.length === 0}
      <p class="small muted">No options were provided.</p>
    {/if}
  </div>
</div>

<style>
  .prompt {
    margin-bottom: var(--space-3);
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .option {
    border-radius: var(--radius-sm);
    text-align: left;
  }

  .option.chosen {
    border-color: var(--color-sage);
    background: var(--color-sage-soft);
  }
</style>
