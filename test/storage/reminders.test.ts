import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The database lives under HOME — a scratch one, set before anything opens it.
const home = mkdtempSync(join(tmpdir(), "intuneatlas-reminders-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { getDb } = await import("../../src/storage/db.js");
const { addDays, addMonths, addReminder, completeReminder, deleteReminder, getReminder, listReminders, snoozeReminder } = await import("../../src/storage/reminders.js");

after(() => {
  getDb().close();
  rmSync(home, { recursive: true, force: true });
});

test("addMonths keeps to the end of a shorter month; addDays crosses months and years", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  assert.equal(addMonths("2026-03-10", 12), "2027-03-10");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
});

test("reminders: listed by due date; done moves a repeating one on by its cycle, and removes a one-off", () => {
  const who = ["oid-alex", "Alex"] as const;
  addReminder({ targetKey: "omauri:./a::windows10", targetName: "Trusted publisher", note: "Renew the cert", dueOn: "2026-10-01", repeatMonths: 12 }, ...who);
  addReminder({ targetKey: "k2::windows10", targetName: "Camera", dueOn: "2026-09-01" }, ...who);
  const [camera, publisher] = listReminders();
  assert.deepEqual([camera.targetName, publisher.targetName], ["Camera", "Trusted publisher"]);
  assert.equal(publisher.note, "Renew the cert");
  assert.equal(publisher.createdBy, "Alex");

  // Done long after it was due: still the same day of the year, the first one after today.
  completeReminder(publisher.id, "2028-02-01");
  assert.equal(getReminder(publisher.id)!.dueOn, "2028-10-01");

  completeReminder(camera.id, "2026-10-14");
  assert.equal(getReminder(camera.id), undefined);
});

test("reminders: snoozing puts one a week from today; deleting removes it", () => {
  const [created] = addReminder({ targetKey: "k3::windows10", targetName: "Bluetooth", dueOn: "2026-01-01", repeatMonths: null }, "oid", "Sam").filter((r) => r.targetKey === "k3::windows10");
  snoozeReminder(created.id, "2026-10-14");
  assert.equal(getReminder(created.id)!.dueOn, "2026-10-21");
  deleteReminder(created.id);
  assert.equal(getReminder(created.id), undefined);
});
