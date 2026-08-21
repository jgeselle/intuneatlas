# Testing

Two layers, testing different things. Both matter; neither replaces the
other.

## Fixture-based tests (`test/`)

Fast, deterministic, run in CI on every push (`npm test`). Hand-written
Graph response fixtures covering merge/conflict logic, RBAC, baseline
evaluation, and the storage layer. These catch regressions in logic —
they cannot catch anything that depends on what a real Microsoft Graph
tenant actually returns, because the fixtures only ever contain what
someone thought to write by hand.

## Real-tenant testing (`scripts/seed-tenant/`)

A dedicated Entra/Intune test tenant, kept separate from any production
tenant, seeded with real Settings Catalog data via
`scripts/seed-tenant/`. This exists because hand-written fixtures
structurally can't exercise real Graph response shapes at real volume —
real Settings Catalog policies, real group-assignment topology, real
compound/nested settings.

### Two credentials, kept structurally separate

- A **read-only** credential — the exact Application permissions the
  shipped product itself requests — runs the real, unmodified
  `intuneatlas scan`/`ui` against the test tenant.
- A **write** credential, scoped to a separate Entra app registration,
  is used only by `scripts/seed-tenant/` to create test data. It never
  touches `src/`, and `src/graph.ts` (what the product's own scan uses)
  stays GET-only by design — there is no code path where the read-only
  product logic and write-capable test tooling can blur together.

Both are supplied as environment variables each session, never written
to a file or committed. See `scripts/seed-tenant/README.md` for the
exact variables and setup.

### What to test for

- **Volume** — hundreds of policies/settings: does the Settings view,
  search, and category grouping hold up?
- **Relations** — real assignment topology: overlapping groups, exclusion
  groups, multiple platforms side by side.
- **Conflicts** — the same setting reaching a device through two
  different assigned policies with different values, including across
  *different Graph resource types* (a Settings Catalog policy and a
  legacy `deviceConfigurations` profile writing the same real setting —
  see below).
- **Baseline drift** — values that should trip the bundled baseline
  rules (`baselines/windows/*.yml`).
- **Settings Catalog coverage** — real Settings Catalog responses
  contain shapes hand-written fixtures never do. Confirmed and fixed so
  far, in order found — each one only surfaced once real data actually
  hit it:
  1. Group/nested setting instances rendered as the literal string
     `"(group setting)"` instead of their real children's values.
  2. Categories rendered as a raw GUID instead of a friendly name.
  3. A choice setting's *dependent* child (a different mechanism from a
     group's children) was silently dropped — not even a placeholder.
  4. A category's `displayName` isn't always populated even when
     resolution succeeds (every ADMX-derived leaf category has an empty
     one) — falls back to `description` now.
  5. The merge index was keyed on display name, then on `cspPath` —
     neither turned out to be reliably unique. Keyed on
     `settingDefinitionId` now, the one field Graph actually guarantees
     unique per setting.
  6. The legacy, pre-Settings-Catalog `deviceConfigurations` endpoint
     (Device Restrictions, Endpoint Protection, and everything before
     the Settings Catalog existed) wasn't scanned at all — real tenants
     still run these alongside Settings Catalog policies, and both can
     write the same underlying CSP. `src/scan/deviceConfigurations.ts`
     covers a deliberately narrow, live-verified starting set.
  7. A real tenant of any real size legitimately trips Intune Graph's
     throttling during a scan — `graphGet` had no 429 handling at all.

  Keep finding these by testing against real data, not by guessing what
  might be wrong — every one of the seven above was found that way.
  Findings 3–7 specifically came from checking a real tenant's actual
  exported policies against the live catalog, not from a keyword search —
  worth doing again against real exports if you have them, even
  one-off/by-hand, whenever the existing scenarios stop turning up
  anything new.

- Beyond Settings: this extends to the compliance/enrollment views,
  notes, the staged-change review workflow, and RBAC roles too — not
  just Settings Catalog data. Settings is just today's most urgent
  target.

### Workflow

1. `scripts/seed-tenant/index.ts <scenario> --dry-run` first, to sanity
   check what would be created with zero Graph calls.
2. Run it for real against the test tenant.
3. Run `intuneatlas scan`/`ui` against the same tenant with the
   read-only credential and look at the result.
4. `scripts/seed-tenant/index.ts teardown` when done with that scenario,
   or leave data in place across sessions if still investigating —
   teardown only ever touches objects tagged `[intuneatlas-test]`.

Reusable across sessions by design — not a one-off script run once and
discarded. Add a new scenario under `scripts/seed-tenant/scenarios/`
whenever a new gap needs a real-data repro.
