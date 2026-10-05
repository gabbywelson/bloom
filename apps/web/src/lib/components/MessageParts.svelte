<script lang="ts">
  import type { MessagePart, UiAction } from "../types";
  import UiComponentPart from "./ui/UiComponentPart.svelte";

  interface Props {
    parts: ReadonlyArray<MessagePart>;
    onaction?: (action: UiAction) => void;
  }

  let { parts, onaction = () => {} }: Props = $props();

  const paragraphs = (text: string) => text.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  const toolLabel = (name: string) => name.replaceAll("_", " ");
</script>

<div class="parts">
  {#each parts as part, index (index)}
    {#if part.type === "text"}
      {#each paragraphs(part.text) as paragraph, i (i)}
        <p class="text">{paragraph}</p>
      {/each}
    {:else if part.type === "image"}
      <img class="image" src={part.url} alt={part.alt ?? ""} loading="lazy" />
    {:else if part.type === "tool_call"}
      <p class="tool small muted">used <code>{toolLabel(part.name)}</code></p>
    {:else if part.type === "tool_result"}
      <p class="tool small muted">finished <code>{toolLabel(part.name)}</code></p>
    {:else if part.type === "ui_component"}
      <UiComponentPart component={part.component} {onaction} />
    {/if}
  {/each}
</div>

<style>
  .parts {
    display: grid;
    gap: var(--space-2);
  }

  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .image {
    max-width: 100%;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
  }

  .tool {
    font-style: italic;
  }

  .tool code {
    font-style: normal;
  }
</style>
