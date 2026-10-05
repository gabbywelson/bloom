<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { authClient } from "#lib/auth-client.js";
  import Flower from "#lib/components/Flower.svelte";
  import { session } from "#lib/session.svelte.js";

  let busy = $state(false);
  let error = $state<string | null>(null);
  let conditionalUi = $state(false);

  const linkError = $derived(page.url.searchParams.get("error"));

  const describeLinkError = (code: string): string => {
    switch (code) {
      case "INVALID_TOKEN":
      case "EXPIRED_TOKEN":
        return "That sign-in link has expired or was already used. Run bun run auth:link again for a fresh one.";
      default:
        return `The sign-in link did not work (${code}). You can request a new one from the server.`;
    }
  };

  const finishSignIn = async () => {
    await session.refresh();
    await goto(resolve("/"), { replace: true });
  };

  const signIn = async () => {
    busy = true;
    error = null;
    const result = await authClient.signIn.passkey();
    busy = false;
    if (result.error) {
      error =
        result.error.message ??
        "That didn't go through. You can try again, or use a sign-in link from the server.";
      return;
    }
    await finishSignIn();
  };

  // Already signed in? No need to linger here.
  $effect(() => {
    if (!session.loading && session.current) {
      void goto(resolve("/"), { replace: true });
    }
  });

  // WebAuthn conditional UI: when the browser supports it, start a passive
  // passkey request so the credential shows up in the username autofill.
  $effect(() => {
    let cancelled = false;
    const start = async () => {
      if (typeof PublicKeyCredential === "undefined") return;
      const check = PublicKeyCredential.isConditionalMediationAvailable;
      if (typeof check !== "function") return;
      const available = await check.call(PublicKeyCredential);
      if (cancelled || !available) return;
      conditionalUi = true;
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (cancelled) return;
      if (result.data) await finishSignIn();
    };
    void start();
    return () => {
      cancelled = true;
    };
  });
</script>

<section class="login">
  <div class="panel card">
    <div class="mark">
      <Flower state={busy ? "opening" : "open"} size={56} />
    </div>
    <h1>Welcome back</h1>
    <p class="muted">Sign in with the passkey saved on this device.</p>

    {#if conditionalUi}
      <label class="autofill">
        <span class="visually-hidden">Account</span>
        <input
          class="autofill-input"
          type="text"
          name="username"
          autocomplete="username webauthn"
          placeholder="Pick a saved passkey"
          aria-label="Saved passkey"
        />
      </label>
    {/if}

    <button
      type="button"
      class="btn btn-primary wide"
      data-testid="login-passkey"
      onclick={signIn}
      disabled={busy}
    >
      {busy ? "Waiting for your passkey" : "Sign in with a passkey"}
    </button>

    {#if error}
      <p class="error small" role="alert">{error}</p>
    {/if}
    {#if linkError}
      <p class="error small" role="alert">{describeLinkError(linkError)}</p>
    {/if}

    <p class="small muted footnote">
      First time on this device? Run <code>bun run auth:link</code> on the server and open the
      printed link.
    </p>
  </div>
</section>

<style>
  .login {
    flex: 1;
    display: grid;
    place-items: center;
    padding: var(--space-5);
  }

  .panel {
    width: min(100%, 400px);
    padding: var(--space-6);
    display: grid;
    gap: var(--space-3);
    text-align: center;
  }

  .mark {
    display: flex;
    justify-content: center;
    margin-bottom: var(--space-2);
  }

  .wide {
    width: 100%;
    margin-top: var(--space-2);
  }

  .autofill-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-muted);
    color: var(--color-ink-muted);
    text-align: center;
  }

  .error {
    color: var(--color-danger);
  }

  .footnote {
    margin-top: var(--space-3);
  }
</style>
