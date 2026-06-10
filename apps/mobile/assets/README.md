# Mobile app assets

> ⚠️ These are **PLACEHOLDER** assets (a solid `#0f172a` fill). Replace each with
> real brand art, keeping the **same filenames** so `app.json` needs no changes.
> They exist so `expo` / `eas build` succeed today; they are baked into the binary,
> so swapping them in requires a new build + store submission (not live).

| File | Spec | Used for |
|---|---|---|
| `icon.png` | 1024×1024, **no transparency** (iOS flattens alpha) | App icon (iOS + Android fallback) |
| `adaptive-icon.png` | 1024×1024 foreground; keep the logo inside the centered ~66% safe zone | Android adaptive icon (background `#0f172a` is set in `app.json`) |
| `splash.png` | ≥1242×2436 portrait; shown centered (`resizeMode: "contain"`) on `#0f172a` | Launch / splash screen |

After replacing, run `eas build` for each platform to bake the new assets in.
