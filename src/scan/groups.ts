import { graphGet, graphGetAll } from "../graph.js";
import type { GroupDirectory } from "./types.js";

interface GraphGroup {
  id: string;
  displayName?: string | null;
}

/** Graph said "you may not" or "there is no such thing" — as opposed to something being wrong with the scan. */
const status = (err: unknown) => (err instanceof Error ? Number(/failed: (\d{3})\b/.exec(err.message)?.[1]) : NaN);

/**
 * Names and nesting for the groups policies are assigned to. Needs the
 * Group.Read.All permission on the app registration, which is optional:
 * without it (Graph answers 403) the directory comes back empty and
 * marked unavailable, and the rest of the scan carries on — groups are
 * then known by id only and nesting can't be followed.
 *
 * One lookup per assigned group for its name, one for the groups it
 * contains at any depth. Nothing about devices or users is read. A group
 * that no longer exists (404) is simply left without a name.
 */
export async function fetchGroupDirectory(token: string, groupIds: string[]): Promise<GroupDirectory> {
  const directory: GroupDirectory = { available: true, names: {}, contains: {} };
  const ids = Array.from(new Set(groupIds)).filter(Boolean);
  if (ids.length === 0) return directory;

  try {
    await Promise.all(
      ids.map(async (id) => {
        try {
          const group = await graphGet<GraphGroup>(token, `/groups/${id}?$select=id,displayName`);
          if (group.displayName) directory.names[id] = group.displayName;
          const nested = await graphGetAll<GraphGroup>(token, `/groups/${id}/transitiveMembers/microsoft.graph.group?$select=id,displayName`);
          if (nested.length > 0) directory.contains[id] = nested.map((g) => g.id);
          for (const g of nested) if (g.displayName) directory.names[g.id] = g.displayName;
        } catch (err) {
          if (status(err) !== 404) throw err;
        }
      }),
    );
  } catch (err) {
    if (status(err) === 403 || status(err) === 401) return { available: false, names: {}, contains: {} };
    throw err;
  }
  return directory;
}
