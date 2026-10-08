// Everything a section of the Automations tab needs, passed down as one object.

import type { Template } from "../types";
import type { BoolKey, FlowSettings, SettingKey, Stats, TplRow, VoiceStats } from "./types";

export type FlowsCtx = {
  draft: FlowSettings;
  saved: FlowSettings;
  set: <K extends SettingKey>(k: K, v: FlowSettings[K]) => void;
  /** Ask (with a ConfirmDialog) before switching an automation on or off. */
  requestToggle: (k: BoolKey, next: boolean) => void;
  /** Full template rows (body, header, buttons) for previews. */
  templates: Template[];
  /** name + status for every template, from the flows API. */
  statusRows: TplRow[];
  stats: Stats;
  voice: VoiceStats;
  isAdmin: boolean;
};

/** Window event the WhatsApp page fires when the already-open tab is clicked again (detail = tab key). */
export const WA_TAB_RESELECT = "wa:tab-reselect";
