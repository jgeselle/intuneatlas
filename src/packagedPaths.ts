import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSea } from "node:sea";

/**
 * Resolves a path to an asset shipped alongside the app — `web/dist` or
 * `baselines`. In dev/npm mode these live at the package root, found
 * relative to the calling compiled file's own location (two levels up from
 * dist/<subfolder>/<file>.js). In a packaged .exe (see the packaging plan —
 * these ship as loose sibling folders next to the executable, not embedded
 * SEA assets, since the baseline loader needs real directory listing which
 * SEA's key-based asset lookup can't do) they live next to the executable.
 */
export function resolveAppPath(subpath: string, callerUrl: string): string {
  if (isSea()) {
    return join(dirname(process.execPath), subpath);
  }
  return fileURLToPath(new URL(`../../${subpath}`, callerUrl));
}
