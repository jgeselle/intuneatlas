import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToString } from "react-dom/server";
import { buildSettingIndex } from "../../src/scan/index.js";
import type { RawPolicy } from "../../src/scan/types.js";
import { SettingDrawer } from "../src/components/SettingDrawer.js";
import { ConnectScreen } from "../src/ConnectScreen.js";
import { NoRoleScreen } from "../src/NoRoleScreen.js";
import type { Change, RawSimplePolicy, Role, Session, SettingIndexEntry } from "../src/types.js";
import { Baselines } from "../src/views/Baselines.js";
import { ChangeLog } from "../src/views/ChangeLog.js";
import { Overview } from "../src/views/Overview.js";
import { SettingsView } from "../src/views/SettingsView.js";
import { SimplePolicyList } from "../src/views/SimplePolicyList.js";

/**
 * Every page and the setting panel, rendered from the same fixtures the
 * merge tests use: each must render, show what it was given, and offer
 * each role what that role may do. Rendered to HTML, without a browser —
 * this catches a page that throws or loses its data, not how it looks or
 * what a click does.
 */

// What the list's window virtualizer reads while rendering; nothing here scrolls.
Object.assign(globalThis, { window: { innerHeight: 800, scrollY: 0, addEventListener() {}, removeEventListener() {} } });

const FIXTURES = new URL("../../test/scan/fixtures/", import.meta.url);
const settings: SettingIndexEntry[] = readdirSync(FIXTURES).flatMap((file) => {
  const fixture = JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8")) as { policies: RawPolicy[] };
  return buildSettingIndex(fixture.policies);
});

// One setting with everything a panel can show: a value with sub-settings, its definition, and a baseline it falls short of.
const entry: SettingIndexEntry = {
  ...settings[0],
  definitionId: "mode",
  state: "Below baseline",
  schemas: {
    mode: { definitionId: "mode", name: "Mode", kind: "choice", options: [{ id: "mode_0", label: "Off" }, { id: "mode_1", label: "On", childIds: ["level"] }] },
    level: { definitionId: "level", name: "Level", kind: "simple", valueType: "integer", min: 1, max: 9 },
  },
  sources: settings[0].sources.map((source) => ({
    ...source,
    deployed: true,
    structured: { kind: "choice", definitionId: "mode", name: "Mode", optionId: "mode_1", label: "On", children: [{ kind: "simple", definitionId: "level", name: "Level", value: 3 }] },
  })),
  recs: [{ ruleId: "r1", current: "3", recommended: "5", source: "House baseline", severity: "high" }],
  checks: [
    {
      ruleId: "r1",
      source: "House baseline",
      pack: "house/v1",
      policyName: "House policy",
      expected: "On\nLevel: 5",
      expectedNode: { kind: "choice", definitionId: "mode", name: "Mode", optionId: "mode_1", label: "On", children: [{ kind: "simple", definitionId: "level", name: "Level", value: 5 }] },
      passed: false,
      differences: [{ path: ["Level"], expected: "5", actual: "3" }],
    },
  ],
};

const as = (role: Role | null, id = "me"): Session => ({ id, name: "Ada Example", email: "ada@example.com", role });
const ready: Change = {
  id: 1,
  targetKey: entry.key + "::policy::" + entry.sources[0].policyId,
  targetName: entry.name,
  settingKey: entry.key,
  policyId: entry.sources[0].policyId,
  policyName: entry.sources[0].policyName,
  targetKind: "existing",
  ruleId: "manual",
  from: "Off",
  to: "On",
  reason: "Required by policy",
  reviewedBy: "Bo Reviewer",
  stagedBy: "someone-else",
  stagedByName: "Cy Stager",
  createdAt: "2026-10-14T10:00:00Z",
  updatedAt: "2026-10-14T10:00:00Z",
  ready: true,
};
const unreviewed: Change = { ...ready, id: 2, targetKey: entry.key + "::new::a", targetKind: "new", policyId: "", policyName: "Brand new policy", reviewedBy: "", ready: false };
const changes = { [ready.targetKey]: ready, [unreviewed.targetKey]: unreviewed };
const policies: RawSimplePolicy[] = [{ id: "e1", name: "Windows enrollment", platform: "windows10", deployed: true, priority: 1 }];
const nothing = () => {};
const yes = async () => true;

const changeLog = (viewer: Session | null) =>
  renderToString(<ChangeLog changes={changes} onUpdateField={async () => {}} onRevert={nothing} onPush={async () => undefined} viewer={viewer} historyStamp="render-test" />);
const drawer = (viewer: Session | null) =>
  renderToString(
    <SettingDrawer
      entry={entry}
      notes={[{ id: 1, author: "Ada Example", authorId: "me", createdAt: "2026-10-01T00:00:00Z", text: "Kept on purpose" }]}
      reminders={[{ id: 1, targetKey: entry.key, targetName: entry.name, note: "Renew", dueOn: "2026-01-01", repeatMonths: 12, createdBy: "Ada Example", createdById: "me", createdAt: "2026-01-01T00:00:00Z" }]}
      onAddReminder={yes}
      onCompleteReminder={nothing}
      onSnoozeReminder={nothing}
      onDeleteReminder={nothing}
      onAddNote={nothing}
      onDeleteNote={nothing}
      onClose={nothing}
      changes={[ready, unreviewed]}
      onStage={nothing}
      onStageNew={nothing}
      onRevert={nothing}
      viewer={viewer}
      scannedAt="2026-10-15T00:00:00Z"
    />,
  );

test("the overview counts what it's given", () => {
  const html = renderToString(<Overview settingIndex={settings} compliancePolicies={policies} enrollmentConfigurations={policies} changes={changes} onGo={nothing} onOpen={nothing} />);
  assert.match(html, /Settings managed/);
  assert.match(html, /Required by|Cy Stager|ready|needs review/);
});

test("the settings list shows every setting it's given", () => {
  const html = renderToString(<SettingsView entries={settings} changes={changes} query="" setQuery={nothing} platform="All" setPlatform={nothing} onOpen={nothing} />);
  for (const state of new Set(settings.map((e) => e.state))) assert.ok(html.includes(state), state);
});

test("the enrollment list and the baselines page render", () => {
  assert.match(renderToString(<SimplePolicyList kindLabel="Enrollment" items={policies} query="" setQuery={nothing} onOpen={nothing} />), /Windows enrollment/);
  const baselines = (viewer: Session) =>
    renderToString(
      <Baselines
        packs={[{ path: "house/v1", sourceLabel: "House", name: "House baseline", platforms: ["windows10"], policyCount: 1, ruleCount: 1, editable: true }]}
        activePacks={null}
        settingIndex={[entry]}
        folder="/baselines"
        viewer={viewer}
        onUpdateSelection={nothing}
        onAdd={yes}
        onRename={yes}
        onRemove={yes}
      />,
    );
  assert.match(baselines(as("admin")), /Add a baseline/);
  assert.doesNotMatch(baselines(as("contributor")), /Add a baseline/);
});

test("the changes page offers pushing and reviewing to an Admin only", () => {
  const admin = changeLog(as("admin"));
  assert.match(admin, /Push to tenant/);
  assert.match(admin, /Brand new policy/);
  const contributor = changeLog(as("contributor"));
  assert.doesNotMatch(contributor, /Push to tenant/);
  assert.doesNotMatch(contributor, /Revert/);
  // Nobody signed in (the UI under vite dev): the changes still show, with nothing to do to them.
  const nobody = changeLog(null);
  assert.match(nobody, /Required by policy/);
  assert.doesNotMatch(nobody, /Push to tenant|Revert|Rename/);
});

test("the setting panel shows the policies, the baseline, reminders and notes", () => {
  const html = drawer(as("admin"));
  for (const text of ["Below baseline", "House baseline", "Use this value", "Stage to new policy", "Staged · ready", "Brand new policy", "Renew", "Kept on purpose"]) {
    assert.ok(html.includes(text), text);
  }
  // A Viewer reads all of it and is offered none of the actions.
  const viewer = drawer(as("viewer"));
  assert.match(viewer, /House baseline/);
  for (const text of ["Use this value", "Stage to new policy", "Add note", "Add reminder", "Delete note"]) assert.ok(!viewer.includes(text), text);
});

test("the screens before the app: no scan yet, no role", () => {
  assert.match(renderToString(<ConnectScreen onConnected={nothing} session={as("admin")} />), /Scan now/);
  assert.match(renderToString(<ConnectScreen onConnected={nothing} session={as("viewer")} />), /Only the Admin role can run a scan/);
  assert.match(renderToString(<NoRoleScreen session={as(null)} />), /No role assigned/);
});
