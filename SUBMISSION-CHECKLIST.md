# Submission checklist — Rooted 1.0.2 (iOS) / 1.0.1 (Android)

Everything in the repo is already done. What is left is the store clicks, and
those have to happen on the Mac. Work top to bottom.

## What this build is for

The web app is unchanged. `capacitor.config.ts` points both shells at
`https://www.rootedhomeschoolapp.com`, so all the JavaScript already ships from
Vercel and families have had the new photo flow for a while.

The one thing a web deploy could not give them is the native permission keys.
Those live in the shells and only reach a phone through the App Store and Play
Store:

- `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` in
  `ios/App/App/Info.plist`
- `android.permission.CAMERA` in
  `android/app/src/main/AndroidManifest.xml`

Until this build is live, "Take a photo" inside the installed apps cannot open
the camera. That is the whole reason for the submission.

## Version numbers for this round

| | Version shown to families | Build number |
|---|---|---|
| iOS | 1.0.2 | 3 |
| Android | 1.0.1 | versionCode 2 |

The two platforms are deliberately on different numbers — Android is coming
from 1.0, iOS from 1.0.1. Don't try to make them match.

---

## Step 1 — Mac prep

Open Terminal, go to the project folder, and run these in order:

```bash
git checkout main
git pull
npm install
npx cap sync ios
npx cap sync android
```

Both `cap sync` commands matter. The files they generate
(`capacitor.config.json` inside each shell) are intentionally not stored in
git, so a fresh pull does not have them and the builds would go out
misconfigured without this step.

`npx cap sync ios` will print a warning that looks alarming and is not:

```
[warn] Cannot copy web assets from out to ios/App/App/public
       Web asset directory specified by webDir does not exist.
       This is not an error because server.url is set in config.
```

That is expected. It is Capacitor saying "no bundled web files here" — correct,
because the app loads from the live site.

One thing to know: this project uses Swift Package Manager, not CocoaPods.
There is no `Podfile` and no `pod install` step. Xcode resolves the packages by
itself the first time you open the project, which can take a minute or two on
the first run.

---

## Step 2 — iOS: build and upload

1. Open the project:
   ```bash
   open ios/App/App.xcodeproj
   ```
   Open `App.xcodeproj`, **not** a `.xcworkspace` — this project doesn't have
   one.
2. Wait for Xcode to finish resolving Swift packages. The status bar at the top
   will say what it's doing; let it go quiet before continuing.
3. In the device dropdown at the top of the window (next to the Rooted scheme),
   select **Any iOS Device (arm64)**. Archive is greyed out if a simulator is
   selected.
4. Confirm the version. Click the **App** project in the left sidebar → the
   **App** target → **General** tab. Version should read `1.0.2` and Build
   should read `3`. If it doesn't, stop — the pull didn't come through.
5. Menu bar: **Product → Archive**. This takes a few minutes.
6. The Organizer window opens with the new archive selected. Click
   **Distribute App**.
7. Choose **App Store Connect** → **Next**.
8. Choose **Upload** → **Next**.
9. Accept the defaults on the signing screens and click through to **Upload**.
   Signing is set to manual with the "Rooted App Store Distribution" profile,
   the same as the 1.0.1 release, so it should go through without changes.
10. Wait for "Upload Successful" and close the Organizer.

The build then takes 10–30 minutes to finish processing before App Store
Connect will let you attach it to a version. Go do something else.

## Step 3 — iOS: submit in App Store Connect

1. Go to https://appstoreconnect.apple.com → **My Apps** → **Rooted**.
2. In the left sidebar, under the iOS app, click the **+** next to "iOS App"
   and choose **iOS App 1.0.2**. (If a 1.0.2 version already exists, just open
   it.)
3. Scroll to **What's New in This Version** and paste the text from the
   "What's New" section at the bottom of this file.
4. Scroll to **Build**, click **Add Build**, and pick build **3**. If it isn't
   listed yet, processing hasn't finished — wait and refresh.
5. Leave screenshots, description, keywords, and pricing as they are. Nothing
   about the listing changed.
6. Under **App Review Information**, no new sign-in details are needed. The
   existing demo account still works.
7. Click **Save**, then **Add for Review**, then **Submit to App Review**.

**A note on App Review and the camera.** This is the first Rooted build that
asks for camera access, so review will look at it specifically. That is
expected and already handled — the purpose strings in `Info.plist` explain it
in plain language:

> Rooted uses your camera so you can capture a memory right from a lesson.

> Rooted opens your photo library so you can add photos you have already taken
> to your memories.

If a reviewer asks a follow-up, the honest answer is the short one: families
tap "Add a photo" on a lesson, and the camera is one of the two options
alongside their library. The photo attaches to that lesson. Rooted does not use
the camera anywhere else and does not use it in the background.

---

## Step 4 — Android: build the bundle

Use Android Studio for this. `./gradlew bundleRelease` from the command line
does build, but this project has no signing config in `build.gradle`, so the
`.aab` it produces is unsigned and the Play Console will reject it. The Android
Studio wizard is the path that signs it with your upload key.

1. Open Android Studio → **Open** → select the `android` folder inside the
   project.
2. Let Gradle sync finish (progress bar at the bottom).
3. Confirm the version. Open `android/app/build.gradle` and check that it reads
   `versionCode 2` and `versionName "1.0.1"`.
4. Menu bar: **Build → Generate Signed App Bundle / APK**.
5. Choose **Android App Bundle** → **Next**.
6. Select your existing keystore, enter the keystore password, pick the key
   alias, enter the key password → **Next**.

   This must be the same keystore used for 1.0. If Play rejects the upload with
   a message about the signing key not matching, stop and don't create a new
   one — that's recoverable, but only through Google, and a new key makes it
   worse.
7. Choose the **release** build variant → **Create**.
8. When it finishes, click **locate** in the notification popup. The file is at
   `android/app/release/app-release.aab`.

## Step 5 — Android: upload and roll out

1. Go to https://play.google.com/console → **Rooted**.
2. Left sidebar: **Release → Production** → **Create new release**.
3. Drag `app-release.aab` into the upload area. Wait for it to finish
   processing. It should show as version **1.0.1 (2)**.
4. **Release name**: `1.0.1`.
5. **Release notes**: paste the text from the "What's New" section below into
   the `en-US` box.
6. Click **Next**, review the warnings screen. A note about the new `CAMERA`
   permission is expected — that is exactly what this release adds.
7. Click **Save**, then **Go to overview**, then **Start rollout to
   Production**, and confirm.

Google may ask you to confirm the app's data-safety answers because a
permission changed. Camera is used to capture memories the family chooses to
save; photos go to their own account and are not shared or sold.

---

## What's New — paste this into both stores

```
Take photos right from a lesson. The Add a photo button now offers your camera as well as your library, and every photo attaches to that lesson automatically. Plus printable previews that load beautifully on every device.
```

---

## After both are submitted

- iOS review usually comes back within a day or two. Android production review
  is often faster but can take longer on a permission change.
- Nothing needs to be deployed on the web side. This release is shells only.
- Once both are live, install the updates on a real phone and tap "Add a photo"
  on a lesson. The permission prompt should appear once, and the camera should
  open. That is the thing this whole build exists to fix, so it's worth the two
  minutes to check.
