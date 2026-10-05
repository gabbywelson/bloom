/**
 * Generative-UI registry: maps a `ui_component` part's `kind` to the Svelte
 * component that renders it. Unknown kinds fall through to `Fallback`, which
 * shows the kind and its props as JSON so nothing is silently dropped.
 */
import type { Component } from "svelte";
import type { UiAction, UiComponent } from "../../types";
import Confirm from "./Confirm.svelte";
import Fallback from "./Fallback.svelte";
import OptionPicker from "./OptionPicker.svelte";
import SnoozePicker from "./SnoozePicker.svelte";
import TaskCard from "./TaskCard.svelte";

export interface UiComponentProps {
  readonly component: UiComponent;
  readonly onaction: (action: UiAction) => void;
}

export type UiRenderer = Component<UiComponentProps>;

const registry: Readonly<Record<string, UiRenderer>> = {
  option_picker: OptionPicker,
  task_card: TaskCard,
  confirm: Confirm,
  snooze_picker: SnoozePicker,
};

export const resolveRenderer = (kind: string): UiRenderer => registry[kind] ?? Fallback;

export const knownKinds: ReadonlyArray<string> = Object.keys(registry);
