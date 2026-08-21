const STATE_STYLE = {
  Conflict: "bg-red-50 text-red-700 ring-red-200",
  "Below baseline": "bg-amber-50 text-amber-800 ring-amber-200",
  "Not deployed": "bg-stone-100 text-stone-500 ring-stone-200",
  Baseline: "bg-white text-stone-500 ring-stone-200",
};

const SEVERITY_STYLE = {
  critical: { chip: "bg-red-50 text-red-700 ring-red-200", label: "Critical", rank: 0 },
  high: { chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "High", rank: 1 },
  medium: { chip: "bg-stone-100 text-stone-700 ring-stone-300", label: "Medium", rank: 2 },
  low: { chip: "bg-stone-50 text-stone-500 ring-stone-200", label: "Low", rank: 3 },
};

export { STATE_STYLE, SEVERITY_STYLE };
