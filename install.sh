#!/bin/sh
# AfterGlow for macOS: installs (or updates) the latest release.
#
#   curl -fsSL https://raw.githubusercontent.com/wajenaqv/afterglow/main/install.sh | sh
#
# What it does: asks GitHub for the latest release, downloads its .dmg,
# copies AfterGlow.app into /Applications (or ~/Applications if that isn't
# writable), and opens it. Nothing else: no sudo, no other changes.
#
# Why a script: AfterGlow is a hobby project without a paid Apple Developer
# account, so it isn't notarized. A .dmg downloaded in a browser makes macOS
# ask you to click "Open Anyway" in System Settings; a file downloaded with
# curl isn't marked as downloaded, so it just opens.
set -eu

REPO="wajenaqv/afterglow"
APP="AfterGlow.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. Windows: https://github.com/$REPO/releases/latest" >&2
  exit 1
fi

echo "Finding the latest AfterGlow release..."
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*\.dmg"' \
  | head -n 1 \
  | sed 's/.*"\(https:[^"]*\)"$/\1/')
if [ -z "$URL" ]; then
  echo "Couldn't find a macOS download on https://github.com/$REPO/releases/latest" >&2
  exit 1
fi

TMP=$(mktemp -d)
MNT="$TMP/mount"
cleanup() {
  hdiutil detach "$MNT" -quiet 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "Downloading $(basename "$URL")..."
curl -fL --progress-bar -o "$TMP/AfterGlow.dmg" "$URL"

mkdir "$MNT"
hdiutil attach "$TMP/AfterGlow.dmg" -nobrowse -readonly -quiet -mountpoint "$MNT"
if [ ! -d "$MNT/$APP" ]; then
  echo "The download doesn't contain $APP." >&2
  exit 1
fi

DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

# Updating: quit the running copy first. Quit from the tray restores the
# desktop; if it doesn't go within 10 s, stop it (the next Quit restores it).
if pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; then
  echo "Quitting the running AfterGlow..."
  osascript -e 'tell application "AfterGlow" to quit' >/dev/null 2>&1 || true
  i=0
  while pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1 && [ "$i" -lt 10 ]; do
    sleep 1
    i=$((i + 1))
  done
  pkill -f "$APP/Contents/MacOS/" 2>/dev/null || true
  sleep 1
fi

echo "Installing to $DEST/$APP..."
rm -rf "$DEST/$APP"
ditto "$MNT/$APP" "$DEST/$APP"
# curl doesn't mark files as downloaded, but clear the mark in case anything did.
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

echo "Opening AfterGlow (it lives in the menu bar)."
open "$DEST/$APP"
echo
echo "Want it to react to Dock badges? Switch them on in Settings -> apps; macOS will ask for permission."
