import { Sliders, ShieldCheck, DeviceMobile, Warning, CheckCircle, Check, Clock } from "@phosphor-icons/react";
import { Chip, Stat, NotAvailableYet } from "../components/bits.jsx";
import { SEVERITY_STYLE } from "../lib/styles.js";
import { platformLabel } from "../lib/format.js";

function Overview({ settingIndex, compliancePolicies, enrollmentConfigurations, changes, onGo, onOpen }) {
  const conflicts = settingIndex.filter((e) => e.conflict).length;
  const undeployed = settingIndex.filter((e) => e.state === "Not deployed").length;
  const recs = settingIndex
    .filter((e) => e.rec)
    .sort((a, b) => SEVERITY_STYLE[a.rec.severity].rank - SEVERITY_STYLE[b.rec.severity].rank);
  const complianceDeployed = compliancePolicies.filter((p) => p.deployed).length;
  const enrollmentDeployed = enrollmentConfigurations.filter((p) => p.deployed).length;
  const changeList = Object.values(changes).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-stone-500">Where the tenant stands, and what to fix first.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Settings managed"
          value={settingIndex.length}
          sub={conflicts + " conflicting, " + undeployed + " not deployed"}
          tone={conflicts ? "amber" : "neutral"}
          icon={Sliders}
        />
        <Stat label="Compliance policies" value={compliancePolicies.length} sub={complianceDeployed + " deployed"} icon={ShieldCheck} />
        <Stat
          label="Enrollment configs"
          value={enrollmentConfigurations.length}
          sub={enrollmentDeployed + " deployed"}
          icon={DeviceMobile}
        />
        <Stat label="Conflicts" value={conflicts} tone={conflicts ? "alert" : "neutral"} icon={Warning} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-lg border border-stone-200 bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Fix these first</h2>
            <button
              onClick={() => onGo("recommendations")}
              className="rounded text-xs font-medium text-teal-600 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {recs.length > 0 ? "See all " + recs.length : "Recommendations"}
            </button>
          </div>
          {recs.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <CheckCircle className="mx-auto h-6 w-6 text-teal-500" />
              <p className="mt-2 text-sm font-medium">Nothing outstanding</p>
              <p className="mt-1 text-xs text-stone-500">Every scanned setting matches the baseline.</p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {recs.slice(0, 5).map((e) => (
                <li key={e.key}>
                  <button
                    onClick={() => onOpen(e.key)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{e.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-stone-500">
                        {platformLabel(e.platform)} · {e.category}
                      </span>
                    </span>
                    <Chip className={SEVERITY_STYLE[e.rec.severity].chip}>{SEVERITY_STYLE[e.rec.severity].label}</Chip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Compliance by platform</h2>
            <div className="mt-3">
              <NotAvailableYet title="Needs device sync">Per-device compliance percentages aren't scanned yet.</NotAvailableYet>
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Recent changes</h2>
            {changeList.length === 0 ? (
              <p className="mt-2 text-xs text-stone-500">
                No changes yet. Staging a recommendation lands it here before anything reaches the tenant.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {changeList.slice(0, 4).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs">
                    {c.ready ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-teal-600" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    )}
                    <span className="truncate text-stone-700">{c.targetName}</span>
                    <span className="ml-auto shrink-0 text-stone-400">{c.ready ? "ready" : "needs review"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export { Overview };
