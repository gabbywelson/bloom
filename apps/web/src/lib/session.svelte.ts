/**
 * Runes-based session store.
 *
 * Better Auth exposes the session as a nanostore atom. We subscribe once and
 * mirror it into `$state` so components read `session.current` / `session.loading`
 * like any other reactive value, without legacy `$store` syntax.
 */
import { browser } from "$app/env";
import { authClient, type Session } from "./auth-client";

let current = $state<Session | null>(null);
let loading = $state(true);

const atom = authClient.useSession();

if (browser) {
  atom.subscribe((value) => {
    current = value.data ?? null;
    loading = value.isPending;
  });
}

export const session = {
  /** The signed-in session, or null when signed out (or still loading). */
  get current() {
    return current;
  },
  /** True until the first session fetch has settled. */
  get loading() {
    return loading;
  },
  /** Re-fetch the session from the server (after sign-in, sign-out, passkey changes). */
  async refresh() {
    await atom.get().refetch();
  },
};
