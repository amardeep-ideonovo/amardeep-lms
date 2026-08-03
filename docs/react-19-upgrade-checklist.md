# React 19 + Next.js upgrade — execution checklist

> **Status:** audited 2026-08-03, **not yet executed.** Audit ran on `main` at the
> time (post-PR-#56). Re-verify the version + scan facts below before starting —
> the tree moves.
>
> **Verdict:** **Defer, but schedule.** Nothing user-visible and nothing in the
> perceived-latency plan is blocked on this. Do it as a **maintenance-currency**
> window (or as step 0 of the cookie-auth + RSC P4 work), *not* for features.

---

## TL;DR

- This is **not** "just React 19." Next 14.2.5 pins `react: ^18.2.0`, so React 19
  **forces a Next major too**. It's a **coupled Next 14→16 + React 18→19 upgrade**.
- It covers **three apps**: `apps/web`, `apps/admin`, **`apps/control-plane`** —
  all identically on **Next 14.2.5 + React 18.2.0 + @types/react 18.3.3**.
  `apps/mobile` is already React 19.2.3 (Expo, no Next) and is out of scope.
- **Target: Next 16.2.9 + React 19.2 + @types/react 19** — the exact stack the
  separate `~/licensing-dashboard` (control-plane) repo already runs in prod, so
  jump straight to 16, skip 15.
- **The codebase is unusually ready.** Full removed-API scan = **zero** hits.
  Effort ≈ **1–2 days**, risk **moderate-low**.
- **One real blocker:** `@zoom/meetingsdk` pins `react: 18.2.0` exactly → needs a
  one-line `overrides` + a manual "join a real meeting" QA pass.

## Why do it (the honest reasons)

1. **Security/maintenance currency — the actual driver.** Next 14.2.5 is two
   majors behind; Vercel backports security fixes to roughly current+previous
   major only, so 14 is likely already outside the patch window.
2. **Kills the workspace `@types/react` 18-vs-19 split.** Removes the duplicate
   `@types/react` gotcha and the `{children as never}` cast in
   `apps/mobile/src/query.tsx` (see [[mobile-tanstack-query]] memory). One React
   platform-wide.
3. Native `useOptimistic` / `useActionState` / `use()` — **marginal**: P0–P3
   already shipped hand-rolled equivalents. This is refactoring working code, not
   a user-visible win. Don't upgrade *for* this.
4. Precursor to the **cookie-auth + RSC** P4 item and eligibility for the React
   Compiler later. If you're going to do RSC/cookie-auth, upgrade **first** so you
   don't rewrite the same pages twice.

## Why it's safe (audit evidence — re-run before trusting)

**React 19 removed-API scan across `apps/{web,admin,control-plane}` — all ZERO:**
`.defaultProps` · `propTypes` · `findDOMNode` · `ReactDOM.render` ·
`unmountComponentAtNode` · `createFactory` · legacy context
(`contextTypes`/`getChildContext`) · string refs · removed types
(`ReactChild`/`ReactText`/`VFC`…) · `useFormState` · class components.
TS codemod surface also zero (`JSX.Element` 0, bare `useRef()` 0).

Re-run:
```bash
SRC="apps/web apps/admin apps/control-plane"
grep -rEn "\.defaultProps|propTypes|findDOMNode|ReactDOM\.render\(|unmountComponentAtNode|createFactory|getChildContext|useFormState|ReactChild|ReactText|\bVFC\b" $SRC --include="*.ts" --include="*.tsx"
```

**Dependency React-19 peer readiness (swept all direct deps):**
| Package | Peer range | 19-ready? |
|---|---|---|
| `@puckeditor/core` 0.21.3 (admin page builder — the scary one) | `^18.0.0 \|\| ^19.0.0` | ✅ no bump forced |
| `@tiptap/react` 3.26.0 | `^17 \|\| ^18 \|\| ^19` | ✅ |
| all hoisted `@radix-ui/*` (Puck internals) | allow 19 | ✅ |
| `@zoom/meetingsdk` 6.2.0 | **`18.2.0` (exact)** | ⚠️ **see below** |

## ⚠️ The one blocker: `@zoom/meetingsdk`

- Pins `react: 18.2.0` **exactly**; latest published (6.2.0 = what's installed)
  still does. So `npm install` with React 19 **fails the peer check**.
- **Mitigation:** `apps/web/components/ZoomEmbed.tsx` uses the **embedded Client
  View** — `ZoomMtgEmbedded.createClient()` + `client.init({ zoomAppRoot: <div> })`
  (dynamic `import("@zoom/meetingsdk/embedded")`). It renders into its **own DOM
  node with its own bundled React**, so it does **not** consume the host app's
  React at runtime. The pin is an **install-time peer conflict only**.
- **Fix:** root `package.json` `overrides` (npm) forcing the peer, e.g.
  ```json
  "overrides": { "@zoom/meetingsdk": { "react": "$react", "react-dom": "$react-dom" } }
  ```
  (Verify the exact syntax against the npm version in use.)
- **Non-negotiable QA:** join a real Zoom live session on the upgraded `web`
  build. This is the single highest-risk runtime surface.

## Next 15/16 mechanics (the real, small work)

- **Async request APIs** (`params`/`searchParams`/`headers()`/`cookies()` become
  Promises). Surface: **~21** page/layout files touch params (web 12, admin 6,
  CP 3). The official codemod handles the bulk:
  ```bash
  npx @next/codemod@latest next-async-request-api apps/web apps/admin apps/control-plane
  ```
  Plus **1** hand-fix: `apps/web/app/layout.tsx` `headers();` → `await headers();`
  (the dynamic-render guard added in PR #56).
- **fetch caching default flip** (15 no longer caches `fetch` by default):
  **already aligned** — this codebase sets `cache`/`next.revalidate` explicitly
  everywhere (`apps/web/lib/api.ts` `request()`). Nothing to change, but re-audit
  after the bump.
- **Middleware:** none in any of the three apps. **Route handlers:** 2 files
  total. **Docker base** `node:20-slim` for web+admin: satisfies Next 16.
- Watch for: `next.config` option renames, `next/image` defaults, ESLint flat
  config in Next 15+.

## Execution steps

1. [ ] Branch off `main`. **Re-run the removed-API scan + version checks** (below)
       — confirm they still hold.
2. [ ] Bump **all three** apps together (they share the monorepo React tree):
       `next@16`, `react@19`, `react-dom@19`, `@types/react@19`,
       `@types/react-dom@19`, `eslint-config-next@16`. Do web+admin+CP in one PR
       (splitting them across the shared `node_modules` invites version skew).
3. [ ] Add the `@zoom/meetingsdk` `overrides` to root `package.json`; `npm install`;
       confirm it resolves with **one** `@types/react` (19) and **one** `react`.
4. [ ] Run the Next async-request-API codemod; hand-fix `layout.tsx`
       `await headers()`; grep for any remaining sync `params`/`searchParams`.
5. [ ] `npx tsc --noEmit` in each of web/admin/control-plane until clean. Expect
       small `@types/react` 19 nits (children typing, ref types) — mechanical.
6. [ ] `npx next build` in each app; resolve config/lint deprecations.
7. [ ] Verify the mobile cast can be removed: delete `{children as never}` in
       `apps/mobile/src/query.tsx` (now one React) and re-tsc mobile — *optional
       cleanup, do it in this PR while the split is gone*.

## Verification gates

- **CI (already covers this):** `TypeCheck (mobile/puck/bdd/db)`,
  `Next build (admin)`, `Next build (web)`, `bdd`. All must stay green. (Note:
  CP / `apps/control-plane` isn't in the LMS CI matrix — build it locally.)
- **Manual QA (the runtime risks types/build can't catch):**
  - [ ] **Zoom** — join a real live session on `web` (the SDK peer risk).
  - [ ] **Puck** — open + edit + save a page in `admin` (the biggest 3rd-party dep).
  - [ ] **Checkout** — a full member checkout flow on `web`.
  - [ ] **Auth** — member login/logout on `web`, operator + client login on CP.
  - [ ] Projects (admin) realtime board, member dashboard, certificates.
- **Deploy:** web/admin ship as one **multi-tenant prebuilt image** with the API
  origin resolved at **runtime** — re-confirm no route statically prerenders
  build-time fallback data (the PR #56 trap): the build should show all app routes
  as `ƒ (Dynamic)`; `prerender-manifest.json` should list only static assets.

## Rollback

Pure dependency + mechanical-syntax change on its own branch → **revert the PR**.
No data/schema/runtime-state migration involved. Keep it a standalone PR (don't
stack feature work on it) so revert is clean.

## Estimate & risk

**~1–2 days**, **moderate-low risk.** The clean removed-API scan is what makes it
cheap; the Zoom peer pin + Puck editing are the two things that actually need eyes.

---

## Appendix — current state (2026-08-03, re-verify)

```
apps/web            next 14.2.5   react 18.2.0   @types/react ^18.3.3
apps/admin          next 14.2.5   react 18.2.0   @types/react 18.3.3
apps/control-plane  next 14.2.5   react 18.2.0   @types/react ^18.3.3
apps/mobile         (Expo)        react 19.2.3   @types/react ~19.2.2   [already 19; out of scope]

precedent: ~/licensing-dashboard   next 16.2.9   react 19.2.4   @types/react ^19
next@14.2.5 peerDependencies.react = ^18.2.0   (⇐ why React 19 forces a Next major)
```

Version re-check:
```bash
for w in apps/web apps/admin apps/control-plane apps/mobile; do
  node -e "const p=require('./$w/package.json');const d={...p.dependencies,...p.devDependencies};console.log('$w',d.next||'-',d.react,d['@types/react'])"
done
```
