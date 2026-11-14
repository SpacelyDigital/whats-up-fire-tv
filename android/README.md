# What's Up for Google TV

The Google TV and Android TV app: one full-screen Android System WebView showing the same page as
the Fire TV app (`../web`), and a small Kotlin bridge in place of the Fire TV app's React Native one.

| File | What it does |
| --- | --- |
| `MainActivity.kt` | The web view, its settings, Back and Menu keys, Keep screen awake, restarts after a lost page process |
| `PageFiles.kt` | Serves the page from the app at `https://appassets.androidplatform.net/www/`; refuses every other request except the pictures the page's Content-Security-Policy names |
| `Bridge.kt` | The page's messages (`get`, `chime`, `awake`, `ui`), read exactly as the Fire TV app reads them |
| `Net.kt` | The allow-list (the Fire TV app's 11 patterns) and the fetch: one deadline, redirects checked, 2 MB cap |
| `Chime.kt` | The alert chime |

## Build

Needs JDK 17 or later, the Android SDK (`ANDROID_HOME`), and Node 20 or later (the page is built by
`../scripts/build-web.mjs` during the Gradle build). Run `npm ci` in `../vendor` once.

```sh
./gradlew test                    # the app's own tests
./gradlew assemblePersonalRelease # the developer's TV build: com.spacelydigital.whatsup.personal
./gradlew bundleStoreRelease      # the Google Play bundle: com.spacelydigital.whatsup
node ../scripts/check-package.mjs app/build/outputs/apk/personal/release/app-personal-release.apk
```

`node --test ../tests/` checks this app against the Fire TV app and the page (allow-list, messages,
picture hosts, the Google TV page build, policy edition, credits).

- Signing keys live outside the repository: `WHATSUP_SIGNING` names a properties file (see
  `app/build.gradle.kts`). Without one, the personal build uses the debug key and the store build is
  unsigned.
- `-Pwhatsup.contact=<address>` (or `WHATSUP_CONTACT`) adds a contact address to the User-Agent of the
  app's own requests; the repository keeps none.
- `-Pwhatsup.hide=tips,awake` leaves the Ko-fi tip and Keep screen awake out of the store build.
- `app/libraries.txt` lists every library in the app for About & credits; the build fails when it is out
  of date.
- The store build shows `../web/privacy-store-googletv.txt`, made from the Fire TV policy by
  `node ../scripts/build-privacy-googletv.mjs`. Its dates stay `[date]` until it is published, and the
  package check refuses a store package until then.
