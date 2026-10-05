import { Schema } from "effect";
import { TaskId } from "./ids.ts";
import { TaskStatus } from "./task.ts";

/** One selectable choice in an `OptionPicker`. */
export const UiOption = Schema.Struct({ id: Schema.String, label: Schema.String }).annotate({
  identifier: "UiOption",
});
export type UiOption = typeof UiOption.Type;

/** Asks the user to pick one of a few options. */
export const OptionPicker = Schema.Struct({
  kind: Schema.Literal("option_picker"),
  prompt: Schema.String,
  options: Schema.Array(UiOption),
}).annotate({ identifier: "OptionPicker" });
export type OptionPicker = typeof OptionPicker.Type;

/** Inline card showing a task's state. */
export const TaskCard = Schema.Struct({
  kind: Schema.Literal("task_card"),
  taskId: TaskId,
  title: Schema.String,
  status: TaskStatus,
  due: Schema.NullOr(Schema.DateTimeUtcFromString),
}).annotate({ identifier: "TaskCard" });
export type TaskCard = typeof TaskCard.Type;

/** Confirmation gate for side-effecting actions (email, money, code agents); never auto-executed. */
export const Confirm = Schema.Struct({
  kind: Schema.Literal("confirm"),
  prompt: Schema.String,
  confirmLabel: Schema.String,
  cancelLabel: Schema.String,
  action: Schema.Struct({ name: Schema.String, args: Schema.Json }),
}).annotate({ identifier: "Confirm" });
export type Confirm = typeof Confirm.Type;

/** One snooze choice with its target time. */
export const SnoozeChoice = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  until: Schema.DateTimeUtcFromString,
}).annotate({ identifier: "SnoozeChoice" });
export type SnoozeChoice = typeof SnoozeChoice.Type;

/** Lets the user pick when to be reminded again. */
export const SnoozePicker = Schema.Struct({
  kind: Schema.Literal("snooze_picker"),
  prompt: Schema.String,
  choices: Schema.Array(SnoozeChoice),
}).annotate({ identifier: "SnoozePicker" });
export type SnoozePicker = typeof SnoozePicker.Type;

/**
 * Generative UI component carried inside a message part and rendered natively by
 * each client. Discriminated on `kind`; use `UiComponent.match` / `.guards`.
 */
export const UiComponent = Schema.Union([OptionPicker, TaskCard, Confirm, SnoozePicker])
  .annotate({ identifier: "UiComponent" })
  .pipe(Schema.toTaggedUnion("kind"));
export type UiComponent = typeof UiComponent.Type;
