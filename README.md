# miCollects: collectibles and wishlist

The whole app lives in `www/index.html` -- a single-page web app, deployed as the
website at [micollects.co.za](https://micollects.co.za) (via Cloudflare Pages,
auto-deployed from `main`). That's the primary, actively maintained build, for
both desktop and mobile browsers. Data syncs to the cloud once signed in.

## APK (retired)
Capacitor can still wrap `www/index.html` into an Android APK, but this is no
longer built or distributed automatically -- the website now covers mobile too.
The "Build APK" GitHub Actions workflow is manual-only (Actions tab > Build APK
> Run workflow) if a one-off debug build is ever needed again.

To build one locally instead: Node 20+ and Android Studio (with JDK 17), no sudo.

    npm install
    npx cap add android
    npx cap sync android
    npx cap open android

In Android Studio: Build > Build App Bundle(s) / APK(s) > Build APK(s).

## Changing the app
Edit `www/index.html` and push to `main` -- Cloudflare Pages redeploys automatically.
