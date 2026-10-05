<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { authClient, type Passkey } from "#lib/auth-client.js";
  import { session } from "#lib/session.svelte.js";

  let passkeys = $state<ReadonlyArray<Passkey>>([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let newName = $state("");

  const defaultName = () => "This device";

  const load = async () => {
    loading = true;
    const result = await authClient.passkey.listUserPasskeys();
    loading = false;
    if (result.error) {
      error = result.error.message ?? "Could not load your passkeys.";
      return;
    }
    passkeys = result.data;
  };

  const add = async () => {
    busy = true;
    error = null;
    notice = null;
    const name = newName.trim().length > 0 ? newName.trim() : defaultName();
    const result = await authClient.passkey.addPasskey({ name });
    busy = false;
    if (result.error) {
      error = result.error.message ?? "That passkey could not be added.";
      return;
    }
    newName = "";
    notice = `Added "${name}".`;
    await load();
  };

  const remove = async (passkey: Passkey) => {
    busy = true;
    error = null;
    notice = null;
    const result = await authClient.passkey.deletePasskey({ id: passkey.id });
    busy = false;
    if (result.error) {
      error = result.error.message ?? "That passkey could not be removed.";
      return;
    }
    notice = `Removed "${passkey.name ?? "passkey"}".`;
    await load();
  };

  const signOut = async () => {
    busy = true;
    await authClient.signOut();
    await session.refresh();
    busy = false;
    await goto(resolve("/login"), { replace: true });
  };

  const created = (date: Date) =>
    new Date(date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  $effect(() => {
    void load();
  });
</script>

<section class="passkeys">
  <div class="column">
    <header class="head">
      <h1>Passkeys</h1>
      <p class="muted">
        Signed in as {session.current?.user.email ?? "you"}. Each device you use gets its own
        passkey.
      </p>
    </header>

    <div class="card block">
      <h2>Add this device</h2>
      <p class="small muted">Give it a name you will recognise later.</p>
      <form
        class="add"
        onsubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          class="name"
          type="text"
          placeholder={defaultName()}
          bind:value={newName}
          disabled={busy}
          aria-label="Passkey name"
        />
        <button type="submit" class="btn btn-primary" disabled={busy}>Add this device</button>
      </form>
    </div>

    <div class="card block">
      <h2>Registered</h2>
      {#if loading}
        <p class="small muted">Loading</p>
      {:else if passkeys.length === 0}
        <p class="small muted">No passkeys yet. Add one above before you leave this page.</p>
      {:else}
        <ul class="list">
          {#each passkeys as passkey (passkey.id)}
            <li class="row">
              <div>
                <div class="pk-name">{passkey.name ?? "Unnamed passkey"}</div>
                <div class="small muted">
                  Added {created(passkey.createdAt)}
                  {#if passkey.backedUp}· synced{/if}
                </div>
              </div>
              <button
                type="button"
                class="btn btn-quiet btn-danger small"
                disabled={busy}
                onclick={() => remove(passkey)}
              >
                Remove
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if error}
      <p class="error small" role="alert">{error}</p>
    {/if}
    {#if notice}
      <p class="small muted" role="status">{notice}</p>
    {/if}

    <footer class="foot">
      <a class="small" href={resolve("/")}>Back to Bloom</a>
      <button type="button" class="btn btn-quiet" disabled={busy} onclick={signOut}>
        Sign out
      </button>
    </footer>
  </div>
</section>

<style>
  .passkeys {
    flex: 1;
    padding: var(--space-5);
  }

  .column {
    width: min(100%, 560px);
    margin: 0 auto;
    display: grid;
    gap: var(--space-4);
  }

  .head {
    display: grid;
    gap: var(--space-1);
  }

  .block {
    padding: var(--space-4) var(--space-5);
    display: grid;
    gap: var(--space-2);
  }

  .add {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .name {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    background: var(--color-page);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }

  .row:first-child {
    border-top: none;
  }

  .pk-name {
    font-weight: 500;
  }

  .error {
    color: var(--color-danger);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-3);
  }

  @media (max-width: 480px) {
    .add {
      flex-direction: column;
    }
  }
</style>
