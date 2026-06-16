# WiseSplit — Android (TWA)

A Trusted Web Activity wraps your **deployed** WiseSplit PWA into a native Android app you
can sideload or publish to the Play Store. Because a TWA loads your hosted site, you must
have WiseSplit live at a public HTTPS domain first.

## Build a signed APK

```bash
# after WiseSplit is deployed at, e.g., wisesplit.example.com
DOMAIN=wisesplit.example.com bash build-apk.sh
```

Requirements: Node 18+ and JDK 17. The script installs the Android SDK locally on first run,
points `twa-manifest.json` at your domain, and runs Bubblewrap to produce
`app-release-signed.apk`.

## Sideload it

On the phone: **Settings → Apps → Install unknown apps** → allow your browser/Files, then open
the APK and tap Install.

## No deployment yet?

Use the PWA instead — open your WiseSplit URL in Chrome and choose **Install app / Add to
Home screen**. Same app, nothing to build.

> For verified app links (no URL bar), host a Digital Asset Links file at
> `/.well-known/assetlinks.json` with your APK's signing fingerprint. `build-apk.sh` prints it.
