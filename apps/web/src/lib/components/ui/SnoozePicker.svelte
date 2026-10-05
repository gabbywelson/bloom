<script lang="ts">
  import type { UiComponentProps } from "./registry";

  let { component, onaction }: UiComponentProps = $props();

  interface Choice {
    readonly id: string;
    readonly label: string;
  }

  const defaults: ReadonlyArray<Choice> = [
    { id: "later_today", label: "Later today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "this_weekend", label: "This weekend" },
    { id: "next_week", label: "Next week" },
  ];

  const prompt = $derived(
    typeof component.props.prompt === "string" ? component.props.prompt : "Snooze until",
  );

  const choices = $derived.by((): ReadonlyArray<Choice> => {
    const raw = component.props.choices;
    if (!Array.isArray(raw)) return defaults;
    const parsed = raw.flatMap((item): Choice[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      return typeof record.id === "string" && typeof record.label === "string"
        ? [{ id: record.id, label: record.label }]
        : [];
    });
    return parsed.length > 0 ? parsed : defaults;
  });

  let picked = $state<string | null>(null);

  const pick = (choice: Choice) => {
    picked = choice.id;
    onaction({ id: component.id, payload: { until: choice.id } });
  };
</script>

<div class="snooze">
  <p class="muted">{prompt}</p>
  <div class="choices" role="group" aria-label={prompt}>
    {#each choices as choice (choice.id)}
      <button
        type="button"
        class="btn"
        class:picked={picked === choice.id}
        aria-pressed={picked === choice.id}
        disabled={picked !== null && picked !== choice.id}
        onclick={() => pick(choice)}
      >
        {choice.label}
      </button>
    {/each}
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

  .picked {
    border-color: var(--color-sage);
    background: var(--color-sage-soft);
  }
</style>
