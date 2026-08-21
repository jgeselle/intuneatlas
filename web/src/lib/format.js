function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function sinceLabel(mins) {
  if (mins <= 0) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return mins + " minutes ago";
  const h = Math.floor(mins / 60);
  if (h === 1) return "1 hour ago";
  if (h < 24) return h + " hours ago";
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : d + " days ago";
}

/**
 * Real platform/kind strings come straight from Graph odata types
 * ("windows10", "androidWorkProfile", "deviceEnrollmentPlatformRestrictions")
 * rather than the prototype's hand-picked labels — this is a best-effort
 * humanizer, not a precise mapping.
 */
function platformLabel(raw) {
  if (!raw) return "Unknown";
  const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  return spaced
    .split(" ")
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === "ios") return "iOS";
      if (lower === "macos") return "macOS";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function refLabel(platform) {
  const p = (platform || "").toLowerCase();
  if (p.includes("windows")) return "CSP / OMA-URI";
  if (p.includes("ios") || p.includes("macos")) return "Payload key";
  if (p.includes("android")) return "Managed configuration key";
  return "Graph property";
}

export { initialsOf, sinceLabel, platformLabel, refLabel };
