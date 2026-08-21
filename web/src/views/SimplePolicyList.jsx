import { MagnifyingGlass } from "@phosphor-icons/react";
import { Chip } from "../components/bits.jsx";
import { platformLabel } from "../lib/format.js";

function SimplePolicyList({ kindLabel, items, query, setQuery, onOpen }) {
  const shown = items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()));
  const hasPriority = items.some((i) => i.priority !== undefined);
  const deployedCount = items.filter((i) => i.deployed).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{kindLabel}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {items.length} {kindLabel.toLowerCase()} found · {deployedCount} deployed.
        </p>
      </header>

      <div className="relative">
        <MagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Platform</th>
              {hasPriority && <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Priority</th>}
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((i) => (
              <tr
                key={i.id}
                onClick={() => onOpen(i.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpen(i.id);
                }}
                className="cursor-pointer hover:bg-stone-50 focus:bg-stone-50 focus:outline-none"
              >
                <td className="px-4 py-3 font-medium">{i.name}</td>
                <td className="hidden px-4 py-3 text-xs text-stone-600 sm:table-cell">{platformLabel(i.platform)}</td>
                {hasPriority && (
                  <td className="hidden px-4 py-3 text-xs tabular-nums text-stone-600 sm:table-cell">{i.priority ?? "—"}</td>
                )}
                <td className="px-4 py-3">
                  <Chip className={i.deployed ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-stone-100 text-stone-500 ring-stone-200"}>
                    {i.deployed ? "Deployed" : "Not deployed"}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium">No {kindLabel.toLowerCase()} match that search</p>
          </div>
        )}
      </div>
    </div>
  );
}

export { SimplePolicyList };
