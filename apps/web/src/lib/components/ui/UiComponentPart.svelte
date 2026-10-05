<script lang="ts">
  /**
   * Generative-UI dispatcher: maps a `ui_component` part's `kind` to the Svelte
   * component that renders it. The branches are the registry; `kind` is the
   * domain `UiComponent` discriminant, so adding a kind in `@bloom/domain`
   * without a branch here is a type error (the `{:else}` receives `never`).
   */
  import type { UiActionHandler, UiComponent } from "../../types";
  import Confirm from "./Confirm.svelte";
  import Fallback from "./Fallback.svelte";
  import OptionPicker from "./OptionPicker.svelte";
  import SnoozePicker from "./SnoozePicker.svelte";
  import TaskCard from "./TaskCard.svelte";

  interface Props {
    component: UiComponent;
    /**
     * A reply is still streaming. Components whose action is a reply to Bloom
     * stay disabled, because the page cannot send while one is in flight
     * (the task card acts through the API and is unaffected).
     */
    busy?: boolean;
    onaction?: UiActionHandler;
  }

  let { component, busy = false, onaction = async () => false }: Props = $props();
</script>

<div class="ui-part card" data-kind={component.kind}>
  {#if component.kind === "option_picker"}
    <OptionPicker {component} {busy} {onaction} />
  {:else if component.kind === "task_card"}
    <TaskCard {component} {onaction} />
  {:else if component.kind === "confirm"}
    <Confirm {component} {busy} {onaction} />
  {:else if component.kind === "snooze_picker"}
    <SnoozePicker {component} {busy} {onaction} />
  {:else}
    <Fallback {component} />
  {/if}
</div>

<style>
  .ui-part {
    padding: var(--space-4);
    margin-top: var(--space-3);
  }
</style>
