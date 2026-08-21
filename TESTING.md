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
  different assigned policies with different values.
- **Baseline drift** — values that should trip the bundled baseline
  rules (`baselines/windows/*.yml`).
- **Settings Catalog coverage** — real Settings Catalog responses
  contain shapes hand-written fixtures never do. Two known gaps to
  confirm first, found by reading the scan code before ever touching a
  real tenant:
  1. `src/scan/configurationPolicies.ts`'s `extractValue()` has no case
     for group/nested setting instances — falls back to the literal
     string `"(group setting)"`. Real Settings Catalog policies use
     these often (e.g. compound security-baseline settings); hand-built
     fixtures using only simple/choice values never exercise this path.
  2. `src/scan/settingDefinitions.ts`'s `resolveSettingDefinition()` sets
     `category` to the raw Graph category GUID, not a friendly name —
     the code's own comment already flags this as deferred. Every
     category header in the Settings view would render as a GUID
     against real data.

  These are not fixed as part of the testing infrastructure itself —
  confirm against real data first, fix as real product work after.

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
