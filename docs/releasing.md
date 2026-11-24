# Releasing AfterGlow

No paid licences: Windows is unsigned, macOS is self-signed (or ad hoc) and not notarized.

## Each release

1. Bump `version` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (the same number in all three).
2. Commit, then tag and push:
   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. `.github/workflows/release.yml` creates a **draft** release and uploads:
   - `AfterGlow_<version>_x64-setup.exe` (Windows)
   - `AfterGlow_<version>_universal.dmg` (macOS, Apple Silicon + Intel)
4. Download both, try them, then press **Publish** on the draft. The release text comes from `.github/release-notes.md`.

`install.sh` (the macOS one-liner) always takes the latest **published** release, so drafts never reach anyone.

## macOS certificate (once, optional)

Without it, Mac builds are signed ad hoc: they run, but macOS asks for the Accessibility permission (Dock badges) again after every update. With one self-signed certificate used for every release, the permission sticks.

On the Mac:

1. Keychain Access → menu **Keychain Access → Certificate Assistant → Create a Certificate…**
   - Name: `AfterGlow Self-Signed`
   - Identity Type: **Self Signed Root**
   - Certificate Type: **Code Signing**
2. In the **login** keychain, find the certificate, right-click → **Export…** → `.p12`, and set a password.
3. Copy it as one line of base64:
   ```sh
   base64 -i AfterGlow.p12 | tr -d '\n' | pbcopy
   ```
4. On GitHub: the repo → **Settings → Secrets and variables → Actions → New repository secret**, three secrets:
   - `APPLE_CERTIFICATE`: the base64 you copied
   - `APPLE_CERTIFICATE_PASSWORD`: the export password
   - `APPLE_SIGNING_IDENTITY`: `AfterGlow Self-Signed`

Keep the `.p12` somewhere safe (a password manager). A new certificate means users grant Accessibility once more. Never commit it.
