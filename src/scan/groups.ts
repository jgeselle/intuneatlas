import { graphGetAll } from "../graph.js";
import type { GroupDirectory } from "./types.js";

interface GraphGroup {
  id: string;
  displayName?: string | null;
}

/** Graph said "you may not" or "there is no such thing" — as opposed to something being wrong with the scan. */
const status = (err: unknown) => (err instanceof Error ? Number(/failed: (\d{3})\b/.exec(err.message)?.[1]) : NaN);

/** Graph refuses an `id in (…)` filter with more than this many ids (confirmed live: "Max allowed: 15"). */
const IDS_PER_LOOKUP = 15;

/**
 * Names and nesting for the groups policies are assigned to. Needs the
 * Group.Read.All permission on the app registration, which is optional:
 * without it (Graph answers 403) the directory comes back empty and
 * marked unavailable, and the rest of the scan carries on — groups are
 * then known by id only and nesting can't be followed.
 *
 * Names are asked for fifteen groups at a time; a group that no longer
 * exists is simply not in the answer (confirmed live) and is left
 * without a name. Then one lookup per group that does exist, for the
 * groups it contains at any depth. Nothing about devices or users is read.
 */
export async function fetchGroupDirectory(token: string, groupIds: string[]): Promise<GroupDirectory> {
  const directory: GroupDirectory = { available: true, names: {}, contains: {} };
  const ids = Array.from(new Set(groupIds)).filter(Boolean);
  if (ids.length === 0) return directory;

  try {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += IDS_PER_LOOKUP) chunks.push(ids.slice(i, i + IDS_PER_LOOKUP));
    const found = (
      await Promise.all(
        chunks.map(async (chunk) => {
          try {
            return await graphGetAll<GraphGroup>(token, `/groups?$filter=id in (${chunk.map((id) => `'${id}'`).join(",")})&$select=id,displayName`);
          } catch (err) {
            // A filter naming a single group that's gone is answered 404 rather than with an empty list (confirmed live).
            if (status(err) === 404) return [];
            throw err;
          }
        }),
      )
    ).flat();
    for (const group of found) if (group.displayName) directory.names[group.id] = group.displayName;

    await Promise.all(
      found.map(async ({ id }) => {
        try {
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
