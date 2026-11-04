# ZIMOVA phone apps (Android and iPhone)

The apps are the ZIMOVA website wrapped with **Capacitor**, plus a small native bridge for push notifications and background driver location. The generated native projects are in `android/` and `ios/`.

## What is verified and what is not
- Verified here: the web code builds into the app (`npm run sync`), the native bridge bundle loads, both native projects generate, and the server side (email/SMS sending, push to Firebase, CORS, native location uploads) passes automated tests against stand-in services.
- **Not verified:** I could not compile or run the Android or iPhone app in my workspace (no Android SDK, no Mac), and I have not used real Firebase, SMS or email accounts. Expect first-run fixes. Treat this as a solid starting point, not a finished store release.

## 1. You need a hosted server first
A phone app cannot use `localhost` (that means the phone itself) or plain `http`. Deploy the server (see `../DEPLOY.md`) on an HTTPS address, or for quick tests start the server on your computer and expose it with a free tunnel (Cloudflare Tunnel or ngrok), which gives you an `https://...` address.

## 2. Build the Android app
1. Install Node 18+ and Android Studio (it includes the Android SDK).
2. In this folder: `npm install`, then `ZIMOVA_API_URL=https://your-server.example.com npm run android` (on Windows PowerShell: `$env:ZIMOVA_API_URL="https://..."; npm run android`). This copies the website into the app, points it at your server, and opens Android Studio.
3. Plug in a phone (USB debugging on) or start an emulator and press Run.
4. **Before your first upload to Google Play, change the app ID** (`appId` in `capacitor.config.json`, currently `com.zimova.app`) because it cannot be changed later. Then run `npx cap sync` again.
5. To release: Android Studio, Build > Generate Signed App Bundle (keep the signing key safe), then upload the `.aab` in the Play Console, using an **internal testing** track for your demo testers.

## 3. Push notifications (Android)
1. Create a Firebase project (free), add an Android app using the same app ID, download `google-services.json` and put it in `android/app/`.
2. In Firebase: Project settings > Service accounts > Generate new private key. On your server set `PUSH_PROVIDER=fcm` and `FCM_SERVICE_ACCOUNT_JSON` (paste the JSON) or `FCM_SERVICE_ACCOUNT_FILE` (path to the file). Make sure the Firebase Cloud Messaging API is enabled in the Google Cloud project.
3. Sign in on the phone and allow notifications. The app registers its token with the server; the server then pushes every notification it already creates (driver on the way, new request for drivers, payment confirmed, payout sent...).
Without Firebase the app still works: alerts show in the bell, and as phone notifications while the app is open.

## 4. iPhone
You need a Mac with Xcode, or a cloud build service (for example Codemagic) that builds iOS without your own Mac, plus an Apple Developer account.
1. `ZIMOVA_API_URL=https://... npm run ios`, then in Xcode choose your team and bundle ID.
2. Add the **Push Notifications** capability and **Background Modes** (Location updates, Remote notifications). The location and background keys are already in `Info.plist`.
3. **Known gap:** on iPhone the Capacitor push plugin returns an Apple (APNs) token, not a Firebase token, so the server's Firebase sender cannot reach it yet. To finish iPhone push, either add the Firebase iOS SDK as described in Capacitor's push notification guide, or add an APNs sender to `lib/messaging.js`. Until then iPhones get the bell and local alerts only.

## 5. Email and SMS verification
- Email: set `EMAIL_PROVIDER=smtp`, `SMTP_URL` (for example `smtps://user:password@smtp.yourprovider.com`) and `EMAIL_FROM`. Set up SPF and DKIM with your provider or codes will land in spam.
- SMS: set `SMS_PROVIDER=twilio` (with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) or `SMS_PROVIDER=http` (with `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`) for any provider with a simple JSON API. **Check that the provider delivers to Zimbabwean networks, what sender names are allowed, and the per-message price before you commit.** Numbers typed as 0771234567 are converted to +263771234567.
- With none of these set, the code appears on screen (sandbox). In production (`NODE_ENV=production`) sandbox is refused.
- Passengers must verify phone and email before booking (turn email off with `REQUIRE_EMAIL_VERIFICATION=0`).

## 6. Google Maps inside the apps
The app's address is `https://localhost` on Android and `capacitor://localhost` on iPhone. As far as I know Google only accepts web addresses for key restrictions, so an iPhone app cannot be covered by an "HTTP referrer" restriction. Test this early. Options: Android works with `https://localhost/*` added to the referrer list; for iPhone use a key restricted by API only (and watch usage), or move to the native Google Maps SDK later. Until the key works the map shows an error, so leave Google keys unset to use the OpenStreetMap map in demos.

## 7. Driver tracking
While a trip is active the app starts a native foreground service (a visible notification) that posts the driver's position straight to the server, so it keeps working with the screen off. It stops when the trip ends. Android shows a notification while tracking; iPhone shows the blue location indicator. Tracking stops if an iPhone user force-quits the app (an iOS rule). Drivers must allow location access. Both stores want a clear reason for background location, which the text in `Info.plist` and the notification give.

## 8. Getting testers the apps
Use Google Play **internal testing** and Apple **TestFlight**. Both let invited testers install through the normal store apps without a public listing; each has tester limits and (for TestFlight external testers) a short review, so check their current rules. A public listing is stricter: expect questions about ride-hailing licensing, payments, background location and a privacy policy URL. Also note Apple can reject apps that are only a website in a frame; this app adds native push and background location, which helps, but check their current guidelines.

## 9. Updating
The website is copied into the app at build time, so a web change needs `npm run sync` and a new store upload. (Capacitor can instead load your live site by setting `server.url`, which updates instantly but is more likely to be rejected by Apple.)

## 10. If something does not work
- **Blank or "cannot reach server":** `ZIMOVA_API_URL` must be https and reachable from the phone. The server's CORS list already allows `https://localhost`, `capacitor://localhost` (change with `CORS_ORIGINS`).
- **No push:** check `google-services.json` is in `android/app/`, `PUSH_PROVIDER=fcm` is set, notification permission is granted, and `logs/error.log` on the server for Firebase errors.
- **No tracking:** the driver must have an active trip and have allowed location. Check the persistent tracking notification appears.
