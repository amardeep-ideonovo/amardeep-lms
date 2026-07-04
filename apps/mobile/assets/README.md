# Mobile app assets

> ✅ **EAS builds brand themselves automatically**: the `eas-build-pre-install`
> hook ([scripts/sync-brand-assets.js](../scripts/sync-brand-assets.js)) downloads
> the admin-uploaded icon/splash (Admin → App Customization, PNG only) from
> `GET /app/config` and overwrites these files before the build. The admin's
> icon is used for BOTH `icon.png` and `adaptive-icon.png` (Android masks the
> adaptive foreground — keep key content centered). Manual replacement below
> remains the fallback when those fields are unset.
>
> ⚠️ The current files are **PLACEHOLDER** art (a solid `#0f172a` fill). However
> they get replaced, assets are baked into the binary — changing them requires a
> new build + store submission (never live).

| File | Spec | Used for |
|---|---|---|
| `icon.png` | 1024×1024, **no transparency** (iOS flattens alpha) | App icon (iOS + Android fallback) |
| `adaptive-icon.png` | 1024×1024 foreground; keep the logo inside the centered ~66% safe zone | Android adaptive icon (background `#0f172a` is set in `app.json`) |
| `splash.png` | ≥1242×2436 portrait; shown centered (`resizeMode: "contain"`) on `#0f172a` | Launch / splash screen |

After replacing, run `eas build` for each platform to bake the new assets in.
