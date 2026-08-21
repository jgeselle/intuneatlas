# seed-tenant

Write-capable Graph tooling for seeding a dedicated test tenant with real
Settings Catalog data — volume, conflicts, baseline violations, group
settings, and multi-platform policies. See `TESTING.md` at the repo root
for why this exists and how it fits alongside the fixture-based test
suite.

This is dev-only tooling. It is never imported by anything under `src/`
and never ships in the packaged binary.

## Setup

A dedicated Entra app registration, **separate from IntuneAtlas's own**,
with these Application permissions (admin-consented):

- `DeviceManagementConfiguration.ReadWrite.All`
- `Group.ReadWrite.All`
- `Organization.Read.All` (so it can show you which tenant it connected to)

Point it only at your test tenant. Never reuse a production-tenant
credential here.

## Environment variables

Set these fresh each session — never write them to a file, never commit
them:

| Variable | Meaning |
|---|---|
| `SEED_TENANT` | Test tenant id or domain to authenticate against |
| `SEED_CLIENT_ID` | The write app registration's client id |
| `SEED_CLIENT_SECRET` | That app's client secret |

## Usage

```sh
npx tsx scripts/seed-tenant/index.ts <scenario> [arg] [--dry-run]
```

Always try `--dry-run` first for a new scenario or a new tenant — it logs
every write it would make (including the setting definitions it resolved
by search) without calling Graph.

Before any real (non-dry-run) write, the tool resolves the tenant it
actually connected to via a live `/organization` call, prints it, and
asks you to type `yes` to confirm — that's the safety check, done at the
moment it matters against what Graph actually reports, rather than a
second tenant identifier you'd have to pre-type (and could get wrong the
same way as the first).

### Scenarios

- `conflict [keyword]` — two policies, same setting, different values,
  assigned to the same group. Default keyword: `Camera`.
- `groupSetting [keyword]` — a policy built from a real group/nested
  setting definition. Default keyword: `BitLocker`. The payload shape is
  confirmed against Microsoft's schema docs; a specific group definition's
  own validation on child values is the part only a live run can confirm
  — see the comment on `groupSettingCollectionInstance` in
  `settingsCatalog.ts` if it fails.
- `belowBaseline [keyword]` — a policy that should trip the bundled
  `update.quality-deferral` baseline rule. Default keyword: `Defer`.
- `volume [count]` — many policies (default 200) spread across a handful
  of settings, for scale/UI testing.
- `multiPlatform` — one policy per platform (Windows, iOS, macOS,
  Android), each in its own group.
- `teardown` — deletes every group and configuration policy this toolkit
  created (anything tagged `[intuneatlas-test]`), nothing else.

Every scenario resolves setting definitions by keyword search at run
time rather than hardcoding a `settingDefinitionId` — there's no way to
confirm an id is still current without live tenant access, so this
toolkit never assumes one is.

### Running the real product against the same tenant

Seeding uses the write credential above. To actually look at the
seeded data, run IntuneAtlas itself with its own **read-only** credential
(mirrors the product's real Application permissions —
`DeviceManagementConfiguration.Read.All` etc., see the main README):

```sh
intuneatlas scan --tenant <test-tenant> --client-id <read-app-id> --client-secret <read-app-secret>
```

Never point the product's own `--client-id`/`--client-secret` at the
write app registration, and never point this toolkit at the product's
read-only one — keeping them structurally separate is the point.
