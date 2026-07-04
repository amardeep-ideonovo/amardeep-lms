#!/usr/bin/env node
// EAS prebuild hook (runs as `eas-build-pre-install` on EAS build servers,
// BEFORE `npm install` — Node built-ins only): pulls the admin-uploaded app
// icon / splash from the API and bakes them into this build's static assets.
//
//   iconUrl   -> assets/icon.png + assets/adaptive-icon.png (same art; Android
//                masks the adaptive foreground — keep key content centered)
//   splashUrl -> assets/splash.png
//
// Policy: API unreachable => warn + keep the checked-in files (a build must
// not be hostage to the API). URL set but download fails or isn't a real PNG
// => FAIL the build loudly, so a half-branded binary never ships silently.
const fs = require("fs");
const path = require("path");

const API = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");
const ASSETS = path.join(__dirname, "..", "assets");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function syncOne(label, url, files) {
  if (!url) {
    console.log(`[brand-assets] ${label}: not set — keeping checked-in file(s)`);
    return;
  }
  const buf = await fetchBuffer(url);
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) {
    throw new Error(
      `${label} at ${url} is not a PNG. Upload a PNG in Admin → App Customization ` +
        `(icon 1024x1024 opaque, splash >=1242x2436).`
    );
  }
  for (const f of files) {
    fs.writeFileSync(path.join(ASSETS, f), buf);
    console.log(`[brand-assets] ${label}: wrote assets/${f} (${buf.length} bytes)`);
  }
}

(async () => {
  if (!API) {
    console.warn("[brand-assets] EXPO_PUBLIC_API_URL unset — skipping sync");
    return;
  }
  let cfg;
  try {
    const res = await fetch(`${API}/app/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cfg = await res.json();
  } catch (e) {
    console.warn(
      `[brand-assets] could not reach ${API}/app/config (${e.message}) — ` +
        "keeping checked-in assets"
    );
    return;
  }
  try {
    await syncOne("icon", cfg.iconUrl, ["icon.png", "adaptive-icon.png"]);
    await syncOne("splash", cfg.splashUrl, ["splash.png"]);
  } catch (e) {
    console.error(`[brand-assets] FAILED: ${e.message}`);
    process.exit(1);
  }
})();
