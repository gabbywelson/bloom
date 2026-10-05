<script lang="ts">
  /**
   * Rendered only if a `ui_component` kind reaches the client that no branch
   * in `UiComponentPart` handles. The stream decoder rejects unknown kinds, so
   * this is a safety net for schema drift, not a normal path.
   */
  interface Props {
    component: unknown;
  }

  let { component }: Props = $props();
</script>

<div class="fallback">
  <p class="small muted">Bloom sent something this app cannot show yet.</p>
  <pre>{JSON.stringify(component, null, 2)}</pre>
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
