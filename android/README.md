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

`npm run test:web` (from the repository root) includes `../tests/test-android.mjs`, which checks this
app against the Fire TV app and the page (allow-list, messages, picture hosts, the Google TV page
build, policy edition, credits).

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

## Google Play

Decided on 2026-11-16 for the first release:

- Store listing name "What's Up: Planes Over My Home" (Play allows 30 characters); the app's label on
  the TV stays "What's Up". Category Travel & Local, free, offered in the United States only.
- The store build keeps the Ko-fi tip and Keep screen awake, so it is built without `-Pwhatsup.hide`.
- It is built with `WHATSUP_CONTACT` set, so its requests carry the contact address the policy
  describes.
- Privacy policy: the Google TV edition, https://spacelydigital.github.io/Whats-Up/privacy/google-tv/
- Graphics: `../icon/whatsup-play-icon-512.png` (icon), `../icon/whatsup-play-feature-1024x500.png`
  (feature graphic) and `../icon/whatsup-tile-1280x720.png` (TV banner).

Publishing goes in this order, because the store bundle only passes its check once the policy is dated:

1. Set `PUBLISHED` in `../scripts/build-privacy-googletv.mjs` to the day the policy page goes live,
   run the script, and run the tests.
2. Publish the Google TV policy page on the policy site.
3. Build the store bundle with `WHATSUP_CONTACT` set, and run the package check on
   `app/build/outputs/bundle/storeRelease/app-store-release.aab`.
4. Sign it with the upload key, which stays outside the repository. Google Play keeps the app signing
   key (Play App Signing).
5. Upload it to internal testing, opt in to Android TV (Advanced settings › Form factors), then
   promote it to production.
