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

`install.sh` (macOS) and `install.ps1` (Windows), the one-liners, always take the latest **published** release, so drafts never reach anyone. Publishing also runs `.github/workflows/winget.yml`, which sends the new version to winget (once the first version is in, see below).

## winget

The first version goes in by hand, once:

1. Publish the release, then write its manifests:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows\winget-manifests.ps1 -Version 0.1.0
   ```
2. Optional check (as admin once: `winget settings --enable LocalManifestFiles`):
   ```powershell
   winget validate winget\manifests\w\wajenaqv\AfterGlow\0.1.0
   winget install --manifest winget\manifests\w\wajenaqv\AfterGlow\0.1.0
   ```
3. Fork https://github.com/microsoft/winget-pkgs, add the folder `manifests/w/wajenaqv/AfterGlow/0.1.0/` with the three files, and open a pull request. A bot tests it (installs it in a VM, virus scan); a reviewer merges it, usually within a few days. Then `winget install wajenaqv.AfterGlow` works.

For later versions, automatically: make a classic GitHub token (Settings → Developer settings → Personal access tokens → Tokens (classic), scope `public_repo`) and add it as the repo secret `WINGET_TOKEN`. Keep the winget-pkgs fork. Each published release then opens the winget pull request by itself.

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
