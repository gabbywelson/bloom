<script lang="ts">
  import type { UiAction, UiMessage } from "../../types";
  import Flower from "../Flower.svelte";
  import MessageParts from "../MessageParts.svelte";

  interface Props {
    messages: ReadonlyArray<UiMessage>;
    streaming?: boolean;
    onsend: (text: string) => void;
    onaction?: (action: UiAction) => void;
  }

  let { messages, streaming = false, onsend, onaction = () => {} }: Props = $props();

  let draft = $state("");
  let list = $state<HTMLElement | null>(null);

  const canSend = $derived(draft.trim().length > 0 && !streaming);

  const send = () => {
    const text = draft.trim();
    if (text.length === 0 || streaming) return;
    onsend(text);
    draft = "";
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  };

  // Keep the newest message in view as the thread grows.
  $effect(() => {
    void messages.length;
    void streaming;
    const el = list;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const timeOf = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
</script>

<section class="thread" aria-label="Conversation">
  <div class="messages" bind:this={list}>
    {#if messages.length === 0}
      <div class="empty">
        <Flower state="closed" size={40} />
        <p class="muted">Quiet for now. Say something whenever you like.</p>
      </div>
    {/if}
    {#each messages as message (message.id)}
      <article class="message" data-role={message.role}>
        <div class="bubble">
          <MessageParts parts={message.parts} {onaction} />
        </div>
        <time class="stamp small muted" datetime={message.createdAt}>
          {timeOf(message.createdAt)}
        </time>
      </article>
    {/each}
    {#if streaming}
      <div class="thinking">
        <Flower state="opening" size={22} label="Bloom is thinking" />
        <span class="small muted" aria-hidden="true">Bloom is thinking</span>
      </div>
    {/if}
  </div>
  <div class="visually-hidden" aria-live="polite">{streaming ? "Bloom is thinking" : ""}</div>

  <form
    class="composer card"
    onsubmit={(event) => {
      event.preventDefault();
      send();
    }}
  >
    <label class="visually-hidden" for="composer">Message Bloom</label>
    <textarea
      id="composer"
      class="input"
      rows="2"
      placeholder="What's on your mind?"
      bind:value={draft}
      {onkeydown}
    ></textarea>
    <div class="composer-row">
      <span class="hint small muted">Enter to send, Shift+Enter for a new line</span>
      <button type="submit" class="btn btn-primary" disabled={!canSend}>Send</button>
    </div>
  </form>
</section>

<style>
  .thread {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    max-width: var(--content-max);
    width: 100%;
    margin: 0 auto;
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-2);
    scroll-behavior: smooth;
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    margin: auto;
    text-align: center;
  }

  .message {
    display: grid;
    gap: var(--space-1);
    max-width: 85%;
  }

  .message[data-role="user"] {
    justify-self: end;
    text-align: left;
  }

  .message[data-role="assistant"],
  .message[data-role="system"] {
    justify-self: start;
  }

  .bubble {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  .message[data-role="user"] .bubble {
    background: var(--color-sage-soft);
    border-color: transparent;
  }

  .message[data-role="system"] .bubble {
    background: transparent;
    border-style: dashed;
    color: var(--color-ink-muted);
  }

  .stamp {
    padding: 0 var(--space-2);
  }

  .message[data-role="user"] .stamp {
    text-align: right;
  }

  .thinking {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .composer {
    margin: var(--space-2) var(--space-2) var(--space-4);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .input {
    width: 100%;
    resize: vertical;
    min-height: 56px;
    border: none;
    background: transparent;
    padding: var(--space-1);
    line-height: var(--leading);
  }

  .input:focus-visible {
    outline: none;
  }

  .composer:focus-within {
    border-color: var(--color-sage);
    outline: 2px solid var(--color-sage);
    outline-offset: 2px;
    box-shadow: var(--shadow-lift);
  }

  .composer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  @media (max-width: 560px) {
    .hint {
      display: none;
    }
  }
</style>
