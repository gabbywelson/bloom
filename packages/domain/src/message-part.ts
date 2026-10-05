import { Schema } from "effect";
import { UiComponent } from "./ui-component.ts";

/** Plain text. */
export const TextPart = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
export type TextPart = typeof TextPart.Type;

/** An image by URL with optional alt text. */
export const ImagePart = Schema.Struct({
  type: Schema.Literal("image"),
  url: Schema.String,
  alt: Schema.optionalKey(Schema.String),
});
export type ImagePart = typeof ImagePart.Type;

/** A tool invocation requested by the model. */
export const ToolCallPart = Schema.Struct({
  type: Schema.Literal("tool_call"),
  id: Schema.String,
  name: Schema.String,
  args: Schema.Json,
});
export type ToolCallPart = typeof ToolCallPart.Type;

/** The result of a tool invocation, matched by `toolCallId`. */
export const ToolResultPart = Schema.Struct({
  type: Schema.Literal("tool_result"),
  toolCallId: Schema.String,
  name: Schema.String,
  ok: Schema.Boolean,
  result: Schema.Json,
});
export type ToolResultPart = typeof ToolResultPart.Type;

/** A generative UI component embedded in the message. */
export const UiComponentPart = Schema.Struct({
  type: Schema.Literal("ui_component"),
  component: UiComponent,
});
export type UiComponentPart = typeof UiComponentPart.Type;

/**
 * One piece of a message. Stored as jsonb; discriminated on `type`.
 * Use `MessagePart.match` for exhaustive handling and `MessagePart.guards.text` etc. for narrowing.
 */
export const MessagePart = Schema.Union([
  TextPart,
  ImagePart,
  ToolCallPart,
  ToolResultPart,
  UiComponentPart,
]).pipe(Schema.toTaggedUnion("type"));
export type MessagePart = typeof MessagePart.Type;
