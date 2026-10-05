<script lang="ts">
  import type { UiComponentProps } from "./registry";

  let { component, onaction }: UiComponentProps = $props();

  interface Option {
    readonly id: string;
    readonly label: string;
    readonly hint?: string;
  }

  const prompt = $derived(
    typeof component.props.prompt === "string" ? component.props.prompt : undefined,
  );

  const options = $derived.by((): ReadonlyArray<Option> => {
    const raw = component.props.options;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item): Option[] => {
      if (typeof item === "string") return [{ id: item, label: item }];
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : undefined;
        const label = typeof record.label === "string" ? record.label : id;
        if (id === undefined || label === undefined) return [];
        const hint = typeof record.hint === "string" ? record.hint : undefined;
        return [hint === undefined ? { id, label } : { id, label, hint }];
      }
      return [];
    });
  });

  let chosen = $state<string | null>(null);

  const choose = (option: Option) => {
    chosen = option.id;
    onaction({ id: component.id, payload: { choice: option.id } });
  };
</script>

<div class="picker">
  {#if prompt}
    <p class="prompt">{prompt}</p>
  {/if}
  <div class="options" role="group" aria-label={prompt ?? "Options"}>
    {#each options as option (option.id)}
      <button
        type="button"
        class="btn option"
        class:chosen={chosen === option.id}
        aria-pressed={chosen === option.id}
        disabled={chosen !== null && chosen !== option.id}
        onclick={() => choose(option)}
      >
        <span>{option.label}</span>
        {#if option.hint}
          <span class="small muted">{option.hint}</span>
        {/if}
      </button>
    {/each}
    {#if options.length === 0}
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
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    border-radius: var(--radius-sm);
    text-align: left;
  }

  .option.chosen {
    border-color: var(--color-sage);
    background: var(--color-sage-soft);
  }
</style>
