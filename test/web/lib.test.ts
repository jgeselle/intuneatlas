import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths as serverAddMonths } from "../../src/storage/reminders.js";
import { initialsOf, isComplianceSetting, isCustomOmaSetting, platformLabel, refLabel, sinceLabel } from "../../web/src/lib/format.js";
import { addMonths, dueLabel, isDue, localToday, repeatLabel } from "../../web/src/lib/reminders.js";
import { readRoute, routeSearch } from "../../web/src/lib/route.js";
import { matchOption, rangeLabel } from "../../web/src/lib/schema.js";
import { severityRank } from "../../web/src/lib/styles.js";

test("platformLabel turns Graph's platform names into words", () => {
  assert.equal(platformLabel("windows10"), "Windows 10");
  assert.equal(platformLabel("iOS"), "iOS");
  assert.equal(platformLabel("macOS"), "macOS");
  assert.equal(platformLabel("androidWorkProfile"), "Android Work Profile");
  assert.equal(platformLabel("windows10,macOS"), "Windows 10, macOS");
  assert.equal(platformLabel(""), "Unknown");
  assert.equal(platformLabel(undefined), "Unknown");
});

test("refLabel names a setting's reference path the way its platform does", () => {
  assert.equal(refLabel("windows10"), "CSP / OMA-URI");
  assert.equal(refLabel("iOS"), "Payload key");
  assert.equal(refLabel("androidEnterprise"), "Managed configuration key");
  assert.equal(refLabel("linux"), "Setting path");
  assert.equal(refLabel(undefined), "Graph property");
});

test("initialsOf and sinceLabel", () => {
  assert.equal(initialsOf("Ada Lovelace"), "AL");
  assert.equal(initialsOf("  Ada  King Lovelace "), "AL");
  assert.equal(initialsOf("ada"), "A");
  assert.equal(initialsOf("   "), "?");
  assert.deepEqual([0, 1, 59, 60, 61, 125, 1440, 2880].map(sinceLabel), ["just now", "1 minute ago", "59 minutes ago", "1 hour ago", "1 hour ago", "2 hours ago", "1 day ago", "2 days ago"]);
});

test("compliance and custom OMA-URI settings are told apart by their ids", () => {
  assert.equal(isComplianceSetting({ definitionId: "compliance.windows10.passwordRequired" }), true);
  assert.equal(isComplianceSetting({ definitionId: "device_vendor_msft_policy_config_x" }), false);
  assert.equal(isComplianceSetting({ definitionId: undefined }), false);
  assert.equal(isCustomOmaSetting({ key: "omauri:./Device/Vendor/MSFT/X" }), true);
  assert.equal(isCustomOmaSetting({ key: "device_vendor_msft_x" }), false);
  assert.equal(isCustomOmaSetting(undefined), false);
});

test("addMonths follows the server's rule, the end of a month included", () => {
  const cases: Array<[string, number]> = [
    ["2026-01-31", 1],
    ["2024-01-31", 1],
    ["2026-03-31", 1],
    ["2026-12-15", 1],
    ["2026-08-31", 6],
    ["2026-10-15", 12],
    ["2026-05-31", 13],
  ];
  for (const [date, months] of cases) assert.equal(addMonths(date, months), serverAddMonths(date, months), `${date} + ${months}`);
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
});

test("reminder dates read as people say them", () => {
  const today = "2026-10-15";
  assert.equal(isDue({ dueOn: "2026-10-15" }, today), true);
  assert.equal(isDue({ dueOn: "2026-10-16" }, today), false);
  assert.equal(dueLabel({ dueOn: "2026-10-15" }, today), "Due today");
  assert.equal(dueLabel({ dueOn: "2026-10-14" }, today), "Overdue by 1 day");
  assert.equal(dueLabel({ dueOn: "2026-10-05" }, today), "Overdue by 10 days");
  assert.equal(dueLabel({ dueOn: "2026-10-16" }, today), "Due tomorrow");
  assert.equal(dueLabel({ dueOn: "2026-10-25" }, today), "In 10 days");
  assert.equal(dueLabel({ dueOn: "2026-11-12" }, today), "In 4 weeks");
  // Across a change of clocks the days still count whole.
  assert.equal(dueLabel({ dueOn: "2026-10-26" }, "2026-10-24"), "In 2 days");
  assert.deepEqual([null, 1, 3, 12, 24].map(repeatLabel), ["", "Every month", "Every 3 months", "Every year", "Every 2 years"]);
  assert.equal(localToday(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
});

test("the address names the page, the open panel and the group, and reads back the same", () => {
  assert.deepEqual(readRoute(""), { view: "overview", open: null, group: null, named: false });
  assert.deepEqual(readRoute("?page=settings&setting=abc&group=g1"), { view: "configuration", open: { type: "setting", key: "abc" }, group: "g1", named: true });
  assert.deepEqual(readRoute("?enrollment=e1"), { view: "overview", open: { type: "enrollment", id: "e1" }, group: null, named: true });
  // A page the app doesn't have is the overview.
  assert.equal(readRoute("?page=nonsense").view, "overview");

  assert.equal(routeSearch({ view: "overview", open: null, group: null }), "");
  assert.equal(routeSearch({ view: "configuration", open: { type: "setting", key: "a b&c" }, group: "g1" }), "?page=settings&setting=a+b%26c&group=g1");
  for (const route of [
    { view: "compliance" as const, open: { type: "setting" as const, key: "compliance.x" }, group: null },
    { view: "enrollment" as const, open: { type: "enrollment" as const, id: "e1" }, group: "g2" },
    { view: "changes" as const, open: null, group: null },
    { view: "baselines" as const, open: null, group: "g3" },
  ]) {
    const back = readRoute(routeSearch(route));
    assert.deepEqual({ view: back.view, open: back.open, group: back.group }, route);
  }
});

test("schema helpers: options by label, ranges in words", () => {
  const schema = { definitionId: "x", name: "X", kind: "choice" as const, options: [{ id: "x_1", label: "Enabled" }] };
  assert.equal(matchOption(schema, " enabled ")?.id, "x_1");
  assert.equal(matchOption(schema, "Disabled"), undefined);
  assert.equal(matchOption(undefined, "Enabled"), undefined);
  assert.equal(rangeLabel({ definitionId: "n", name: "N", kind: "simple", min: 0, max: 30 }), "0 to 30");
  assert.equal(rangeLabel({ definitionId: "n", name: "N", kind: "simple", min: 0 }), "0 or more");
  assert.equal(rangeLabel({ definitionId: "n", name: "N", kind: "simple", max: 30 }), "30 or less");
  assert.equal(rangeLabel({ definitionId: "n", name: "N", kind: "simple" }), null);
  assert.equal(rangeLabel(undefined), null);
});

test("severityRank sorts rated recommendations first, unrated and unknown ones last", () => {
  assert.deepEqual((["low", undefined, "critical", "high", "medium"] as const).map(severityRank), [3, 4, 0, 1, 2]);
  // A severity a baseline.yml spells some other way still sorts, last.
  assert.equal(severityRank("severe" as never), 4);
});
