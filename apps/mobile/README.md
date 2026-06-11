# LMS mobile (Expo SDK 56)

Dev client app — `expo-dev-client`, not Expo Go. After any SDK/native-dep
change, rebuild the client (`npm run android` / `npm run ios`).

## Dev loop

```sh
npm run android   # build + install + launch on the Android emulator (Metro attached)
npm run ios       # iOS simulator — requires full Xcode 26.4 (CLT alone is not enough)
npm start         # Metro only (when a dev client is already installed)
```

### Reaching the local API from the emulator

`localhost:3000` inside the Android emulator is the emulator itself. Either:

```sh
adb reverse tcp:3000 tcp:3000   # per emulator session; Metro's 8081 is reversed automatically
```

or set `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000` when starting Metro.

## Live app customization

Branding (title, logo, palettes, light/dark) comes from `GET /app/config`
(Admin → App Customization). The app seeds from a SecureStore cache at launch,
then re-fetches on foreground and polls every 30s while active — an admin Save
restyles open apps within one tick, no relaunch.

App **icon & splash** are baked into the binary: EAS builds download the
admin-uploaded PNGs via `npm run eas-build-pre-install`
([scripts/sync-brand-assets.js](scripts/sync-brand-assets.js)) — see
[assets/README.md](assets/README.md) and [SHIPPING.md](SHIPPING.md).
