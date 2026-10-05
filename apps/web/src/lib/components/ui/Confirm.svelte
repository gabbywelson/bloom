<script lang="ts">
  /**
   * Confirmation step for anything consequential (email, money, launching
   * agents). Nothing happens until the user picks; the decision is sent back
   * through `onaction` and the server performs the action.
   */
  import type { UiComponentProps } from "./registry";

  let { component, onaction }: UiComponentProps = $props();

  const text = (key: string, fallback: string): string => {
    const value = component.props[key];
    return typeof value === "string" ? value : fallback;
  };

  const title = $derived(text("title", "Go ahead?"));
  const detail = $derived(typeof component.props.detail === "string" ? component.props.detail : "");
  const confirmLabel = $derived(text("confirmLabel", "Yes, do it"));
  const cancelLabel = $derived(text("cancelLabel", "Not now"));

  let decision = $state<"confirmed" | "cancelled" | null>(null);

  const decide = (next: "confirmed" | "cancelled") => {
    decision = next;
    onaction({ id: component.id, payload: { confirmed: next === "confirmed" } });
  };
</script>

<div class="confirm">
  <h3>{title}</h3>
  {#if detail}
    <p class="muted">{detail}</p>
  {/if}
  {#if decision === null}
    <div class="actions">
      <button type="button" class="btn btn-primary" onclick={() => decide("confirmed")}>
        {confirmLabel}
      </button>
      <button type="button" class="btn" onclick={() => decide("cancelled")}>{cancelLabel}</button>
    </div>
  {:else}
    <p class="small muted">{decision === "confirmed" ? "Confirmed." : "Left alone."}</p>
  {/if}
</div>

<style>
  .confirm {
    display: grid;
    gap: var(--space-3);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
