# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security report — use GitHub's
private vulnerability reporting instead: go to the
[Security tab](https://github.com/jgeselle/intuneatlas/security) on this
repo and click **Report a vulnerability**. That opens a private draft
security advisory visible only to the maintainer, with no public trace
until (if) it's resolved and disclosed.

If that's not available for some reason, opening a normal issue with as
few details as possible (just "I have a security report, how do I reach
you") is a reasonable fallback — please don't post exploit details in it.

## What's in scope

IntuneAtlas is a read-only CLI + self-hosted local/shared web UI. Things
worth reporting:

- Anything that lets a signed-in user do more than their assigned Entra
  App Role should allow (see the [Trust model](./README.md#trust-model)
  in the README).
- Anything that lets an *unauthenticated* request reach data or actions
  that should require sign-in.
- Path traversal, injection, or anything else that reaches outside the
  app's own intended data (the local SQLite store, the OS token cache,
  the served static files).
- Supply-chain concerns — e.g. something wrong with the build provenance
  attestations, or a dependency-level issue.

## What's likely out of scope

- Denial of service against a shared `--host` instance you're running
  yourself — that's a deployment/network concern (see the reverse-proxy
  note in the README), not something the app itself can fully solve.
- Findings that require an attacker to already hold your Entra client
  secret (`--client-secret`) — see the README's trust model for why that
  credential's blast radius is inherent to app-only auth, not an
  IntuneAtlas bug.
- Anything in a fork or a modified build not distributed from this repo's
  own releases.

## Response expectations

This is a solo, unpaid, best-effort project (see
[Maintenance expectations](./README.md#maintenance-expectations) in the
README) — there's no SLA. I'll acknowledge reports as soon as I
reasonably can and fix genuine issues; please give a reasonable amount of
time to respond before any public disclosure.
