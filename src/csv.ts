/** Minimal RFC 4180 CSV serializer — no dependency needed for this. */
export function toCsv(rows: Array<Record<string, string | number | boolean>>): string {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const lines = [headers.map(quote).join(",")];

  for (const row of rows) {
    lines.push(headers.map((h) => quote(row[h])).join(","));
  }

  return lines.join("\r\n") + "\r\n";
}

function quote(value: string | number | boolean | undefined): string {
  const str = value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
