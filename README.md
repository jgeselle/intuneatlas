# IntuneAtlas

**[intuneatlas.com](https://intuneatlas.com)**

Flatten every Intune profile into one settings index, keyed on the CSP path.

The Intune portal is organised around policies. Devices apply a merged set of
settings. IntuneAtlas is meant to read a tenant read-only, rebuild that merge,
and serve it as something you can actually search: grouped by category, keyed
by CSP path, with conflicts, coverage gaps, and baseline drift surfaced
instead of buried in per-policy views.

**Status: early, but real.** The CLI authenticates to a real tenant, scans
Windows Settings Catalog / compliance / enrollment policies via Graph, and
serves a web UI over the result — solo on your own machine or shared with a
team, everyone signing in with their own Microsoft account. Baselines and a
review-gated change log are real; actually deploying a change back to the
tenant, and platform coverage beyond Windows, don't exist yet — see the
roadmap below.

## Using it

Windows (no Node.js required — downloads a standalone binary):
```
irm https://intuneatlas.com/install.ps1 | iex
```

Linux (no Node.js required — downloads a standalone binary):
```
curl -fsSL https://intuneatlas.com/install.sh | bash
```

Or from a clone, on any platform:
```
npm install
npm run build
node dist/cli.js ui
```

**Before first sign-in**, register an Entra app for it to sign in with — every
install brings its own, there's no bundled shared client. It's a five-minute,
one-time setup: [intuneatlas.com/docs/#register-app](https://intuneatlas.com/docs/#register-app)
walks through it. Run any command afterward without `--client-id` and, in a
real terminal, you'll be prompted for it once — the answer is saved
(`~/.intuneatlas`) so every command after that, on any tenant, just works.
Pass `--client-id` explicitly to skip the prompt or change the saved value
later; scripts/CI should always pass it (or set `INTUNEATLAS_CLIENT_ID`,
a per-run override that isn't saved) since the prompt only ever appears in
an interactive terminal.

`ui` opens the web UI and always signs you in with your own Microsoft
account first — that's the identity behind every note and change review, and
it's what runs any scan you trigger from the page. `--tenant <domain>` is
needed the first time (or to switch tenants); after that it's remembered,
so reopening it later goes straight to what you already have, with a silent,
cached sign-in rather than a fresh prompt. `--report <file>` loads a saved
report instead of the last scan. `--host <address>` (default `127.0.0.1`,
this machine only) turns it into a shared instance a whole team can point a
browser at — everyone signs in with their own account, and viewing an
already-scanned report never needs any Intune permission, only triggering a
new scan does. `--persist` registers that exact command to run in the
background — a Scheduled Task on Windows, a systemd service on Linux —
starting at boot and restarting itself on failure, for a shared instance on
a dedicated machine (needs an elevated/root shell); `--stop` undoes it.
`login`/`scan` (headless) also exist directly, with `--device-code`
(interactive fallback) and `--client-secret` (unattended, client-credentials
flow) available there for scripted/CI use.

## What's in this repo

| Path | What it is |
|---|---|
| [`index.html`](./index.html) | Static marketing/landing page for the project |
| [`src/`](./src) | The CLI — auth, Graph scanning, settings index, local server |
| [`web/`](./web) | The local web UI (Vite + React), served by `intuneatlas ui` |
| [`_headers`](./_headers) | Cloudflare Pages response headers (CSP, etc.) for the landing page |

## The idea

- **Conflicts** — two profiles set the same CSP path to different values with
  overlapping assignment.
- **Below baseline** — a setting is weaker than whichever benchmark you point
  it at (Microsoft security baselines, CIS, or your own house rules as YAML).
- **Not deployed** — a profile looks healthy in the portal but targets no
  group, so it silently affects nothing.
- **Documented** — a note explaining a deliberate deviation, attached to the
  setting itself so context survives the person who wrote it.

Baselines are meant to be plain YAML files in a directory, so contributing a
rule doesn't require touching any code.

## Roadmap

- [x] Graph API read-only scan of Intune policies (Windows Settings Catalog, compliance, enrollment)
- [x] CSP path merge + conflict/coverage detection
- [x] `intuneatlas ui` — web UI over the generated index, solo or shared with a team (`--host`), everyone signing in with their own Microsoft account
- [x] Baseline rule engine (YAML) with a real starter pack
- [x] Review-gated change log (stage a recommendation, require a reason and a signed-in reviewer)
- [x] Packaging: standalone Windows binary (SEA), PowerShell installer, winget manifest template
- [x] `ui --persist` / `--stop` — a shared instance that survives reboots (Scheduled Task on Windows, systemd on Linux)
- [ ] Actually deploying a staged change back to the tenant (write-back) — deliberately deferred; the review gate above exists, the write doesn't yet
- [ ] `intuneatlas get <path>` headless command
- [ ] A real code-signing certificate (exe ships unsigned today)
- [ ] Azure-hosted deployment (Bicep, scheduled scans) — the auth this needs is now built, the infra-as-code isn't
- [ ] GitHub Action for scheduled drift scanning

## License

[MIT](./LICENSE) © 2026 IntuneAtlas contributors

Not affiliated with, endorsed by, or supported by Microsoft. Intune and
Microsoft Graph are Microsoft trademarks.
