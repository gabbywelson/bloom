/**
 * Local UI types for the web shell.
 *
 * TEMPORARY: these mirror the Message / Task / ui_component shapes described in
 * docs/ARCHITECTURE.md. They will be replaced by imports from `@bloom/domain`
 * (Effect Schema-derived types) and the generated `@bloom/api` client once those
 * packages land; keep component props generic so the swap is mechanical.
 */

export type MessageRole = "user" | "assistant" | "system";

export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

export interface ImagePart {
  readonly type: "image";
  readonly url: string;
  readonly alt?: string;
}

export interface ToolCallPart {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

export interface ToolResultPart {
  readonly type: "tool_result";
  readonly toolCallId: string;
  readonly name: string;
  readonly result: unknown;
}

/** Known generative-UI kinds. Unknown kinds render through the Fallback. */
export type UiComponentKind = "option_picker" | "task_card" | "confirm" | "snooze_picker";

export interface UiComponent {
  readonly id: string;
  readonly kind: UiComponentKind | (string & {});
  readonly props: Readonly<Record<string, unknown>>;
}

export interface UiComponentPart {
  readonly type: "ui_component";
  readonly component: UiComponent;
}

export type MessagePart = TextPart | ImagePart | ToolCallPart | ToolResultPart | UiComponentPart;

export interface UiMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly parts: ReadonlyArray<MessagePart>;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

export type UiTaskStatus = "open" | "done" | "snoozed";

export interface UiTask {
  readonly id: string;
  readonly title: string;
  readonly status: UiTaskStatus;
  /** ISO 8601 date or datetime. */
  readonly due?: string;
  /** Spoons. */
  readonly effort?: number;
  readonly area?: string;
}

/** Emitted by generative-UI components when the user acts on them. */
export interface UiAction {
  readonly id: string;
  readonly payload: unknown;
}
