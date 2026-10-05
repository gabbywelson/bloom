<script lang="ts">
  import { timeLabel } from "../../format";
  import type { ChatMessage, UiActionHandler } from "../../types";
  import Flower from "../Flower.svelte";
  import MessageParts from "../MessageParts.svelte";

  interface Props {
    messages: ReadonlyArray<ChatMessage>;
    /** A reply is in flight: the composer is locked and the flower opens. */
    streaming?: boolean;
    /** Calm, user-facing text for the last failure, or null. */
    error?: string | null;
    onsend: (text: string) => void;
    onaction?: UiActionHandler;
  }

  let {
    messages,
    streaming = false,
    error = null,
    onsend,
    onaction = async () => false,
  }: Props = $props();

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

  // Keep the newest content in view as the thread grows or streams.
  $effect(() => {
    void messages;
    void streaming;
    const el = list;
    if (el) el.scrollTop = el.scrollHeight;
  });
</script>

<section class="thread" aria-label="Conversation">
  <div class="messages" bind:this={list}>
    {#if messages.length === 0 && !streaming}
      <div class="empty">
        <Flower state="closed" size={40} />
        <p class="muted">Nothing here yet. Say hi.</p>
      </div>
    {/if}
    {#each messages as message (message.id)}
      <article class="message" data-role={message.role} data-testid={`message-${message.role}`}>
        <div class="bubble">
          <MessageParts parts={message.parts} busy={streaming} {onaction} />
        </div>
        <time class="stamp small muted">{timeLabel(message.createdAt)}</time>
      </article>
    {/each}
    {#if streaming}
      <div class="thinking" data-testid="bloom-thinking">
        <Flower state="opening" size={22} label="Bloom is thinking" />
        <span class="small muted" aria-hidden="true">Bloom is thinking</span>
      </div>
    {/if}
    {#if error}
      <p class="error small" role="alert">{error}</p>
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
      placeholder={streaming ? "Bloom is replying" : "What's on your mind?"}
      data-testid="composer-input"
      bind:value={draft}
      disabled={streaming}
      {onkeydown}
    ></textarea>
    <div class="composer-row">
      <span class="hint small muted">Enter to send, Shift+Enter for a new line</span>
      <button type="submit" class="btn btn-primary" data-testid="composer-send" disabled={!canSend}>
        Send
      </button>
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
  .message[data-role="system"],
  .message[data-role="tool"] {
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

  .message[data-role="system"] .bubble,
  .message[data-role="tool"] .bubble {
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

  .error {
    color: var(--color-danger);
    padding: 0 var(--space-3);
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

  .input:disabled {
    color: var(--color-ink-muted);
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
