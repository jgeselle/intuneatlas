const STATE_STYLE = {
  Conflict: "bg-red-50 text-red-700 ring-red-200",
  "Below baseline": "bg-amber-50 text-amber-800 ring-amber-200",
  "Not assigned": "bg-stone-100 text-stone-500 ring-stone-200",
  "Meets baseline": "bg-teal-50 text-teal-700 ring-teal-200",
  // The quiet one: nothing has an opinion on this setting.
  "Not checked": "bg-white text-stone-400 ring-stone-200",
  Missing: "bg-purple-50 text-purple-700 ring-purple-200",
};

const SEVERITY_STYLE = {
  critical: { chip: "bg-red-50 text-red-700 ring-red-200", label: "Critical", rank: 0 },
  high: { chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "High", rank: 1 },
  medium: { chip: "bg-stone-100 text-stone-700 ring-stone-300", label: "Medium", rank: 2 },
  low: { chip: "bg-stone-50 text-stone-500 ring-stone-200", label: "Low", rank: 3 },
};

/** Sort position for a recommendation: by severity where the baseline gives one, unrated ones after. */
function severityRank(severity) {
  return SEVERITY_STYLE[severity]?.rank ?? 4;
}

export { STATE_STYLE, SEVERITY_STYLE, severityRank };
