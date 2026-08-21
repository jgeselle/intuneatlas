# replay-policies

Imports real exported policies as real Settings Catalog policies in a test
tenant, and/or stress-tests the scan pipeline offline against a large real
corpus without writing anything. Complements `scripts/seed-tenant/` —
that toolkit builds small, deliberately engineered scenarios (a specific
conflict, a specific dependent-child setting); this one is for volume and
real-world shape that no hand-picked scenario can match.

This is dev-only tooling. It is never imported by anything under `src/`
and never ships in the packaged binary. It contains no real policy data
of its own — everything comes from whatever local directory you point it
at, at runtime.

## Input format

One YAML file per policy:

```yaml
name: <policy display name>
settings:
  - csp_path: <settingDefinitionId>       # despite the name, not an actual CSP path string
    applied_value: <value>
    applied_value_type: choice | string | integer | stringCollection | secret
```

This is the shape one particular export tool produces — if yours differs,
`parseExport.ts` is the only file that needs to change; everything
downstream works on the parsed `ExportedPolicy`/`ExportedSetting` shape,
not the raw YAML.

Unknown top-level fields (owner, reviewer, last_reviewed, rationale, ...)
are ignored, not rejected.

Never commit real exported policies to this repo. Keep them in a
gitignored local directory (this repo's own `.gitignore` excludes
`donottrack/` for exactly this).

## Usage

```sh
npx tsx scripts/replay-policies/importReal.ts <dir> [--dry-run] [--limit=N]
```

Same `SEED_*` environment variables and confirm-before-write flow as
`scripts/seed-tenant/` (see its README) — this uses the same write
client. Always try `--dry-run` first; it resolves every distinct setting
definition referenced across the whole directory and reports what it
would build, without writing anything.

Every imported policy gets tagged the same way `scripts/seed-tenant/`
tags everything (`[intuneatlas-test] import: <filename>`), so
`scripts/seed-tenant/index.ts teardown` cleans these up too.

**Caveat that matters**: assignment topology isn't in this export
format, so every imported policy gets assigned to one shared group here.
Any "conflict" this surfaces is a real same-setting-different-value
overlap across the imported policies, but not necessarily a real conflict
wherever they were originally exported from — that depends on which
groups they actually target there, which this doesn't know.

## What gets skipped, and why

- **`secret`-typed values are never reconstructed**, on principle — even
  read from your own local export, this toolkit will not write a real
  secret value into the test tenant.
- **Group settings whose own row was never exported** are still handled —
  a group carries no value of its own, so it's reconstructed from
  whichever of its children were exported, without needing the group's
  own id to be a literal row in the file (confirmed necessary against a
  real LocalUsersAndGroups export, which only exported the children).
- **A choice setting with a dependent child, where the *parent's own*
  value wasn't exported**, can't be reconstructed — unlike a group, a
  choice's own selected option is required and isn't inferable from its
  child alone. Skipped with a clear reason, not guessed.
- **Settings whose id is generated per-instance rather than being a
  stable global catalog id** (confirmed live: PrinterProvisioning — each
  configured printer gets its own generated sub-id baked in) can't be
  resolved outside the policy that originally created them. Real,
  structural limitation of the Settings Catalog, not a bug here.
- **Value shapes beyond the four supported** (choice, string, integer,
  stringCollection) are skipped, not guessed at.

Every skip is reported with a specific reason — check the tool's own
output rather than assuming silence means success.
