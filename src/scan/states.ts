import type { SettingIndexState } from "./types.js";

/**
 * State names as they were before the labels were reworked. Scans stored
 * by an older version (and `--report` files written by one) still carry
 * these, so anything reading a persisted report maps them forward.
 *
 * The old "Baseline" covered two different things — "a rule checked this
 * and it passed" and "no rule has an opinion" — which can't be told apart
 * after the fact. It maps to "Not checked"; re-running applyBaselines
 * (which every read path does before judging) promotes it to "Meets
 * baseline" wherever a rule actually passes.
 */
const LEGACY_STATE_NAMES: Record<string, SettingIndexState> = {
  Baseline: "Not checked",
  "Not deployed": "Not assigned",
  "Not covered": "Missing",
};

export function normalizeState(state: string): SettingIndexState {
  return LEGACY_STATE_NAMES[state] ?? (state as SettingIndexState);
}
