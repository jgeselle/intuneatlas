# winget manifest — template, not submitted

These three files are the standard winget-pkgs manifest shape (version /
installer / locale), ready to fill in and submit as a PR to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) once a
real release exists. **Not submitted automatically by anything in this
repo** — that's a manual, deliberate step, same as the Partner Center /
publisher-verification work.

Before submitting:

1. Replace every `REPLACE_ME_*` placeholder — version, release URL, and the
   SHA256 of the actual `intuneatlas-windows.zip` release asset
   (`Get-FileHash intuneatlas-windows.zip -Algorithm SHA256` on Windows, or
   `sha256sum` elsewhere).
2. Double-check the manifest schema version (`ManifestVersion` field) against
   whatever's current in the winget-pkgs repo at submission time — schema
   versions do change.
3. Confirm `InstallerType: portable` is still the right choice — it's what
   fits a ZIP containing a standalone exe with no separate installer, and
   winget's Portable type handles adding it to PATH itself via `Commands`.
4. A signed exe is strongly preferred before submitting — an unsigned
   package is more likely to draw manual reviewer scrutiny (see the project
   plan's signing-certificate note).
