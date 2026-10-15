import { useState, type FormEvent } from "react";
import { runScan } from "./lib/scan.js";
import type { Report, Session } from "./types.js";
import { allows } from "./lib/permissions.js";

function ConnectScreen({ onConnected, session }: { onConnected: (report: Report) => void; session: Session | null }) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canScan = allows(session, "scan");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      onConnected(await runScan("Scan failed"));
    } catch (err) {
      setError((err as Error).message);
      setScanning(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm animate-rise-in rounded-lg border border-stone-200 bg-surface p-6">
        <div className="font-heading text-xl font-semibold leading-none tracking-tight text-teal-800 dark:text-teal-700">IntuneAtlas</div>
        <h1 className="mt-4 text-lg font-semibold">No scan yet</h1>
        {session && <p className="mt-1 text-sm text-stone-500">Signed in as {session.name}</p>}
        {canScan ? (
          <form onSubmit={submit} className="mt-4">
            <button
              type="submit"
              disabled={scanning}
              className="w-full rounded-md bg-teal-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700 dark:hover:bg-teal-400 active:scale-[0.98] focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:bg-stone-200 disabled:text-stone-400"
            >
              {scanning ? "Scanning…" : "Scan now"}
            </button>
          </form>
        ) : (
          <p className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
            Only the Admin role can run a scan.
          </p>
        )}
        {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
        {session && (
          <p className="mt-4 text-center text-xs text-stone-400">
            Wrong account? <a href="/auth/logout" className="text-stone-500 underline hover:text-stone-700">Sign out</a>
          </p>
        )}
      </div>
    </div>
  );
}

export { ConnectScreen };
