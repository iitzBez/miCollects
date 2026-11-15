# miCollects: collectibles and wishlist

The whole app lives in `www/index.html`. Capacitor wraps it into an Android APK.
Data is stored on the phone (IndexedDB). Use Settings > Export backup regularly.

## Option A: build in the cloud (no Android Studio needed)
1. Create a new GitHub repo and push this folder to the `main` branch.
2. Open the repo's Actions tab and wait for "Build APK" to finish (about 5 minutes).
3. Open the finished run, download `micollects-apk`, unzip it, copy `app-debug.apk` to your phone and install it
   (allow "Install unknown apps" for your file manager or browser when Android asks).

## Option B: build locally
Needs Node 20+ and Android Studio (with JDK 17). Do NOT use sudo for any of these commands.

    npm install
    npx cap add android
    npx cap open android

In Android Studio: Build > Build App Bundle(s) / APK(s) > Build APK(s).

## Changing the app
Edit `www/index.html`, then run `npx cap sync android` (no sudo) or just push to GitHub again.
