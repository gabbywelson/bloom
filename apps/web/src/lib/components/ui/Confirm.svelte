<script lang="ts">
  /**
   * Confirmation gate for anything consequential (email, money, launching
   * agents). Nothing runs until the user decides; the decision goes back
   * through `onaction` and the server performs (or drops) the action.
   */
  import type { Confirm, UiActionHandler } from "../../types";

  type Decision = "confirmed" | "cancelled";

  interface Props {
    component: Confirm;
    /** A reply is streaming; the decision could not be sent yet, so the buttons wait. */
    busy?: boolean;
    onaction: UiActionHandler;
  }

  let { component, busy = false, onaction }: Props = $props();

  /** The decision whose action is in flight. */
  let pending = $state<Decision | null>(null);
  /** The decision Bloom received; the buttons stay until the handler confirms it. */
  let decision = $state<Decision | null>(null);

  const locked = $derived(busy || pending !== null);

  const decide = async (next: Decision) => {
    if (locked || decision !== null) return;
    pending = next;
    const confirmed = next === "confirmed";
    try {
      const sent = await onaction({
        kind: "confirm",
        confirmed,
        label: confirmed ? component.confirmLabel : component.cancelLabel,
        action: component.action,
      });
      if (sent) decision = next;
    } finally {
      pending = null;
    }
  };
</script>

<div class="confirm">
  <p class="prompt">{component.prompt}</p>
  {#if decision === null}
    <div class="actions">
      <button
        type="button"
        class="btn btn-primary"
        disabled={locked}
        aria-busy={pending === "confirmed"}
        onclick={() => void decide("confirmed")}
      >
        {component.confirmLabel}
      </button>
      <button
        type="button"
        class="btn"
        disabled={locked}
        aria-busy={pending === "cancelled"}
        onclick={() => void decide("cancelled")}
      >
        {component.cancelLabel}
      </button>
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
