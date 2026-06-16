#!/usr/bin/env bash
# Build a signed WiseSplit Android APK (Trusted Web Activity) from your DEPLOYED
# WiseSplit instance. A TWA wraps a hosted PWA, so you must have WiseSplit live at
# a public HTTPS domain first (the APK loads that URL).
#
# Usage:
#   1. Deploy WiseSplit and note its domain, e.g. wisesplit.example.com
#   2. DOMAIN=wisesplit.example.com bash build-apk.sh
#
# Requires: Node 18+, JDK 17. The script installs the Android SDK locally on first run.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN=your.deployed.domain}"
SDK="${ANDROID_SDK:-$HOME/.wisesplit-android-sdk}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "▶ Building WiseSplit APK for https://$DOMAIN"

# 1. Android command-line tools + SDK packages (first run only)
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "▶ Installing Android SDK to $SDK ..."
  mkdir -p "$SDK/cmdline-tools"
  CT=$(curl -s https://dl.google.com/android/repository/repository2-3.xml | grep -oE 'commandlinetools-mac-[0-9]+_latest.zip' | head -1)
  curl -fsSL "https://dl.google.com/android/repository/$CT" -o /tmp/cmdtools.zip
  rm -rf "$SDK/cmdline-tools/latest" /tmp/cmdline-tools
  unzip -q /tmp/cmdtools.zip -d /tmp
  mv /tmp/cmdline-tools "$SDK/cmdline-tools/latest"
  yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null
  "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
    "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null
fi

# 2. Point the TWA manifest at your domain
sed "s/YOUR_WISESPLIT_DOMAIN/$DOMAIN/g" "$HERE/twa-manifest.json" > "$HERE/.twa-manifest.built.json"

# 3. Build with Bubblewrap
npm i -g @bubblewrap/cli >/dev/null 2>&1 || true
cat > "$HOME/.bubblewrap/config.json" <<JSON
{ "jdkPath": "$(/usr/libexec/java_home -v 17 2>/dev/null || echo /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home)", "androidSdkPath": "$SDK" }
JSON
cp "$HERE/.twa-manifest.built.json" "$HERE/twa-manifest.json.tmp"
( cd "$HERE" && bubblewrap build --manifest=./.twa-manifest.built.json --skipPwaValidation )

echo "✅ Done. APK at: $HERE/app-release-signed.apk"
echo "   Sideload it, or upload to the Play Store."
