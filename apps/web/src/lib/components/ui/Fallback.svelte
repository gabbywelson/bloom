<script lang="ts">
  import type { UiComponentProps } from "./registry";

  let { component }: UiComponentProps = $props();
</script>

<div class="fallback">
  <p class="small muted">Unknown component <code>{component.kind}</code></p>
  <pre>{JSON.stringify(component.props, null, 2)}</pre>
</div>

<style>
  pre {
    margin: var(--space-2) 0 0;
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--color-surface-muted);
    border-radius: var(--radius-sm);
    overflow-x: auto;
    white-space: pre-wrap;
  }
</style>
