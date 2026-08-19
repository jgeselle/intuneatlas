# intuneatlas

**[intuneatlas.com](https://intuneatlas.com)**

Flatten every Intune profile into one settings index, keyed on the CSP path.

The Intune portal is organised around policies. Devices apply a merged set of
settings. intuneatlas is meant to read a tenant read-only, rebuild that merge,
and serve it as something you can actually search: grouped by category, keyed
by CSP path, with conflicts, coverage gaps, and baseline drift surfaced
instead of buried in per-policy views.

**Status: early concept.** This repo currently holds the landing page and a
UI prototype for the settings index — the scanner/CLI that talks to the Graph
API and does the actual merge doesn't exist yet. Nothing here reads a real
tenant today.

## What's in this repo

| Path | What it is |
|---|---|
| [`index.html`](./index.html) | Static marketing/landing page for the project |
| [`intuneatlas.jsx`](./intuneatlas.jsx) | React prototype of the settings-index UI (mock data, not wired to a backend) |
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

## Roadmap (not yet built)

- [ ] Graph API read-only scan of Intune policies
- [ ] CSP path merge + conflict/coverage detection
- [ ] Baseline rule engine (YAML) with Microsoft baseline + CIS packs
- [ ] `intuneatlas ui` — local web UI over the generated index
- [ ] `intuneatlas get <path>` / `intuneatlas scan` headless commands
- [ ] GitHub Action for scheduled drift scanning

## License

[MIT](./LICENSE) © 2026 intuneatlas contributors

Not affiliated with, endorsed by, or supported by Microsoft. Intune and
Microsoft Graph are Microsoft trademarks.
