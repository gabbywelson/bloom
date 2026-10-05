/**
 * Types the web shell renders. Everything that crosses the wire comes from
 * `@bloom/domain` (Effect Schema-derived); only the two UI-local shapes below
 * are defined here.
 */
import type {
  Capture,
  Confirm,
  Message,
  MessagePart,
  MessageRole,
  SnoozeChoice,
  Task,
  TaskId,
  Thread,
  UiOption,
} from "@bloom/domain";
import type { DateTime } from "effect";

export type {
  CaptureId,
  ChatStreamEvent,
  Confirm,
  Message,
  MessagePart,
  MessageRole,
  OptionPicker,
  SnoozeChoice,
  SnoozePicker,
  Task,
  TaskCard,
  TaskId,
  TaskStatus,
  Thread,
  ThreadId,
  UiComponent,
  UiOption,
} from "@bloom/domain";

/** Wire shapes of the entities as the client receives them (timestamps are `DateTime.Utc`). */
export type TaskJson = typeof Task.json.Type;
export type CaptureJson = typeof Capture.json.Type;
export type ThreadJson = typeof Thread.json.Type;
export type MessageJson = typeof Message.json.Type;

/**
 * A message as the thread view holds it: either a persisted `Message` from the
 * API or one that only exists locally so far (the optimistic user turn, or the
 * assistant reply while it streams). Structurally a subset of `Message.json`,
 * so API messages are assignable without conversion.
 */
export interface ChatMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly parts: ReadonlyArray<MessagePart>;
  readonly createdAt: DateTime.Utc;
  /** The run's trace, once the message is persisted (ADR 0024). */
  readonly traceId?: string | null;
}

/** Narrows a persisted message to the shape the view needs (an identity at runtime). */
export const toChatMessage = (message: typeof Message.json.Type): ChatMessage => message;

/**
 * Emitted by generative-UI components when the user acts on them. Discriminated
 * on the component `kind` so the page can route each action.
 */
export type UiAction =
  | { readonly kind: "option_picker"; readonly choice: UiOption }
  | { readonly kind: "task_card"; readonly taskId: TaskId; readonly action: "done" }
  | {
      readonly kind: "confirm";
      readonly confirmed: boolean;
      /** The button text the user chose (`confirmLabel` or `cancelLabel`). */
      readonly label: string;
      readonly action: Confirm["action"];
    }
  | { readonly kind: "snooze_picker"; readonly choice: SnoozeChoice };

/**
 * Receives a `UiAction` and resolves `true` once it has been carried out
 * (sent to Bloom, or applied through the API) and `false` if it was not
 * (a reply is still streaming, the request failed). Components only commit
 * their visible choice on `true`, so a dropped action can be retried.
 */
export type UiActionHandler = (action: UiAction) => Promise<boolean>;
