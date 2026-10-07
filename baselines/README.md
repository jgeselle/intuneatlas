# Baselines

IntuneAtlas compares a tenant against baselines stored as **Settings Catalog
policies exported from Intune** — the JSON exactly as exported, nothing
converted.

Nothing ships in this folder. It is replaced on every update, so put your own
baselines in your user folder instead:

- Windows: `%USERPROFILE%\.intuneatlas\baselines`
- Linux/macOS: `~/.intuneatlas/baselines`

## Layout

```
baselines/
  <source>/
    <name-and-version>/        <- one baseline ("pack")
      baseline.yml             <- optional
      **/*.json                <- exported policies, at any depth
```

Drop a downloaded baseline in whole: files that aren't Settings Catalog policy
exports (compliance policies, scripts, docs) are skipped.

## baseline.yml

An exported policy says what a setting should be, not why, how much it
matters, or whether a lower number is fine too. That goes here, keyed by the
setting's definition id, and never changes the stored values:

```yaml
name: Contoso baseline – Windows 2026.1
settings:
  device_vendor_msft_policy_config_update_deferqualityupdatesperiodindays:
    compare: atMost        # exact (default), atMost, atLeast
    severity: high         # critical, high, medium, low
    rationale: Security patches should not wait longer than a week.
    reference: CIS Windows 11 Benchmark 5.0.0, 87.1
  device_vendor_msft_policy_config_experience_allowcortana:
    ignore: true           # leave this setting out of the baseline
```
