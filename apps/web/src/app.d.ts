// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  interface ImportMetaEnv {
    /** Base URL a trace id is appended to (Jaeger's `/trace/`); empty hides trace links. */
    readonly VITE_TRACE_URL?: string;
  }
}

export {};
