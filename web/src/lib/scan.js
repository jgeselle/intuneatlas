// A scan runs in the background on the server (a real tenant takes
// minutes, longer than a proxy keeps one request open): start it, then
// ask how it's going until it's done. Resolves with the new report.
const POLL_MS = 1500;
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function runScan(failedMessage = "Sync failed") {
  const started = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const job = await readJson(started);
  if (!started.ok) throw new Error(job.error || failedMessage);

  let misses = 0;
  for (;;) {
    await wait(POLL_MS);
    let res;
    try {
      res = await fetch("/api/scan?job=" + encodeURIComponent(job.job));
    } catch {
      // One dropped question isn't a failed scan — it's still running on the server.
      if (++misses > 5) throw new Error("Lost contact with the server. The scan may still finish — reload in a moment.");
      continue;
    }
    const body = await readJson(res);
    if (!res.ok) throw new Error(body.error || failedMessage);
    misses = 0;
    if (body.status === "done") return body.report;
    if (body.status === "failed") throw new Error(body.error || failedMessage);
  }
}
