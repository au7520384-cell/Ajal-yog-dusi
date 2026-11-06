# Android app (Google Play) — Royal Billiard 8

A Capacitor shell: the light web build (`tools/build_android.sh` → `android/www/`, ~39 MB, **no HD pack, no real-money card buttons**) runs in an Android WebView and talks to the game server (`CONFIG.server`, Render). Package name: `com.royalbilliard8.app`.

## Build the .aab (Play needs an App Bundle)
The Android SDK cannot be downloaded in the coding sandbox, so the bundle is built by GitHub Actions: **Actions → "Android app (Play Market)" → Run workflow** (set `version_code` 1, 2, 3 ... for every upload). When it finishes, download `royal-billiard-8-aab` from the bottom of the run.
Locally (Node 20, JDK 17, Android SDK): `bash tools/build_android.sh && cd android && npm install && npx cap add android && npx capacitor-assets generate --android --iconBackgroundColor '#0b1030' && npx cap sync android && cd android && ./gradlew bundleRelease`.

## Signing (once)
Play needs a signed bundle (Play App Signing keeps the real key, you upload with an *upload key*). Make the upload keystore once and KEEP it (lose it = ask Google to reset the upload key):
`keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`
Then add 4 repository secrets (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Never commit the keystore or the passwords. Without the secrets the workflow builds an unsigned bundle (testing only).

## Play Console checklist
- App: name *Royal Billiard 8*, game, free; privacy policy URL: `https://billiard8.onrender.com/privacy`; data deletion: `/data-deletion`.
- Content rating questionnaire, Data safety form (name, avatar, country, game results, user id; voice chat is not recorded), target audience 13+ / adults (not "for children": the game has chat and coins).
- Real-money items: Google Play requires **Google Play Billing** for coins / cues / VIP inside the app. This first build has no card buttons (`CARD_PAY=false`); the shop only offers the ad-based unlocks. Billing + AppLovin MAX (rewarded video, interstitial) are the next steps (plug the SDK into the `Y8` ad hooks: `y8Rewarded`, `y8StartAdOk`).
- **Microphone (voice chat).** The manifest Capacitor generates has only `INTERNET`, so the WebView could not use the microphone at all (the lobby voice room and the in-match 🎤 would show "no permission"). The workflow now adds `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` after `npx cap add android`; Android asks the player once and the game keeps the microphone open between matches (`MicHub`). In the **Data safety** form answer *Audio → Voice or sound recordings*: collected = yes, processed ephemerally (heard live by the other player, never stored), not shared with third parties, optional. Needs a new bundle (`version_code` higher than the last upload).
- New personal developer accounts must run a **closed test (about 12 testers for 14 days)** before production.
- HD pack: not bundled (Play base ~39 MB). On the first start the app downloads it (~51 MB) from the Cloudflare static site (`HD_BASE` in `tools/build_android.sh`, default `https://frosty-hill-615a.au7520384.workers.dev/`; its `_headers` sends `Access-Control-Allow-Origin: *` for `/hd/*` and `/assets.json`), with the same PUBG-style progress screen and the Settings switch. Test: `node tools/test_android_hd.js`. The HD files must be deployed there (they are, from `web/hd/`, after every push).
