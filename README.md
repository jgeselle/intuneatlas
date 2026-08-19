# intuneatlas

**[intuneatlas.com](https://intuneatlas.com)**

Flatten every Intune profile into one settings index, keyed on the CSP path.

The Intune portal is organised around policies. Devices apply a merged set of
settings. intuneatlas is meant to read a tenant read-only, rebuild that merge,
and serve it as something you can actually search: grouped by category, keyed
by CSP path, with conflicts, coverage gaps, and baseline drift surfaced
instead of buried in per-policy views.

**Status: early, but real.** The CLI authenticates to a real tenant, scans
Windows Settings Catalog / compliance / enrollment policies via Graph, and
serves a local web UI over the result. Baselines, write-back, and platform
coverage beyond Windows don't exist yet — see the roadmap below.

## Using it

```
npm install
npm run build
node dist/cli.js login --tenant contoso.onmicrosoft.com
node dist/cli.js scan --tenant contoso.onmicrosoft.com --out report.json
node dist/cli.js ui --report report.json
```

`login`/`scan` also take `--device-code` (interactive fallback) or
`--client-id`/`--client-secret` (unattended, client-credentials flow).
`ui` can run a live scan itself via `--tenant` instead of reading a
saved report.

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
- [x] `intuneatlas ui` — local web UI over the generated index
- [ ] Baseline rule engine (YAML) with Microsoft baseline + CIS packs
- [ ] Review-gated write-back
- [ ] `intuneatlas get <path>` headless command
- [ ] Packaging: standalone Windows binary, winget, PowerShell installer
- [ ] Azure-hosted deployment (Bicep, scheduled scans, hosted UI)
- [ ] GitHub Action for scheduled drift scanning
- [ ] macOS / iOS / Android coverage

## License

[MIT](./LICENSE) © 2026 intuneatlas contributors

Not affiliated with, endorsed by, or supported by Microsoft. Intune and
Microsoft Graph are Microsoft trademarks.
