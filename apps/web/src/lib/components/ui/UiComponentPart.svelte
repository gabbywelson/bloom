<script lang="ts">
  import type { UiAction, UiComponent } from "../../types";
  import { resolveRenderer } from "./registry";

  interface Props {
    component: UiComponent;
    onaction?: (action: UiAction) => void;
  }

  let { component, onaction = () => {} }: Props = $props();

  const Renderer = $derived(resolveRenderer(component.kind));
</script>

<div class="ui-part card" data-kind={component.kind}>
  <Renderer {component} {onaction} />
</div>

<style>
  .ui-part {
    padding: var(--space-4);
    margin-top: var(--space-3);
  }
</style>
