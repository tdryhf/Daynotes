# Daybook for Android

This folder builds `Daybook.apk`, a Trusted Web Activity: a small Android app that opens https://daynotes-nu.vercel.app full-screen in Chrome. The app holds no copy of the site, so every push to `main` updates it on phones with no new APK. Rebuild only to change the app's name, icon, colors, or start URL.

## Requirements

- Chrome (or another browser that supports Trusted Web Activities) on the phone, Android 7.0 or newer.
- To build: a JDK (Android Studio's bundled one works) and the Android SDK with platform 36. `local.properties` points Gradle at the SDK.

## Build

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleRelease
```

The signed APK is written to `app\build\outputs\apk\release\app-release.apk`. Raise `versionCode` in `app\build.gradle` before building an update, or phones won't install it over the old one.

## Signing key — back it up

`daybook-release.jks` and `keystore.properties` (its passwords) are gitignored. Keep a private copy of both. A new APK installs over the old one only if it is signed with the same key, and `public/.well-known/assetlinks.json` lists this key's SHA-256 fingerprint. If you sign with a different key, update that fingerprint too, or the app falls back to showing an address bar.

## Install on a phone

Copy the APK to the phone, open it, and allow installing from that source when Android asks. Play Protect may warn that the app comes from an unknown developer; that is expected for an app that isn't on the Play Store.
