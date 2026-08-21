import { useState } from "react";
import { Compass } from "@phosphor-icons/react";

function ConnectScreen({ onConnected, session }) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const canScan = session?.role === "admin";

  async function submit(e) {
    e.preventDefault();
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Scan failed");
      onConnected(body);
    } catch (err) {
      setError(err.message);
      setScanning(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-2.5">
          <Compass className="h-6 w-6 shrink-0 text-teal-700" />
          <div className="text-sm font-semibold">IntuneAtlas</div>
        </div>
        <h1 className="mt-4 text-lg font-semibold">No scan yet</h1>
        <p className="mt-1 text-sm text-stone-500">
          {session ? `Signed in as ${session.name}. ` : ""}
          Nothing's been pulled from Intune yet
          {canScan ? " — scan now to build the settings index." : "."}
        </p>
        {canScan ? (
          <form onSubmit={submit} className="mt-4">
            <button
              type="submit"
              disabled={scanning}
              className="w-full rounded-md bg-teal-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
            >
              {scanning ? "Scanning…" : "Scan now"}
            </button>
          </form>
        ) : (
          <p className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
            Ask an Admin to run the first scan — only the Admin role can trigger a tenant scan.
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
