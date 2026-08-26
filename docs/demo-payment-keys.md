# Demo payment keys

An academy seeded with **sample content** can be armed with the operator's shared
Stripe **TEST** keys, so a prospect can complete a real-looking checkout during a
demo. No money moves, nothing is charged, and the academy's own Stripe keys — if
the client ever adds them — always take over.

This note covers what it does, why the delivery path is what it is, and the
guardrails that make one shared Stripe account safe across many academies.

---

## The shape

```
control plane                                      academy (LMS instance)
─────────────                                      ──────────────────────
Setting                                             Setting
  demoStripe.secretKey     (AES, operator's)          stripe.demoSecretKey       (AES, this instance's key)
  demoStripe.publishableKey                           stripe.demoPublishableKey
                                    ──push──►         stripe.demoWebhookSecret
Instance                                              stripe.demoTenantTag
  demoPaymentKeys    ← operator intent
  demoPaymentKeysAt  ← acknowledged           Stripe sandbox (ONE account, many academies)
                                                objects stamped metadata.lms_tenant=<tag>
```

The health sweep converges intent with state on every pass:

| intent | stamp | sweep does                                                       |
| ------ | ----- | ---------------------------------------------------------------- |
| on     | none  | `POST /instance-admin/demo-payment-keys`, then stamp             |
| off    | set   | `DELETE /instance-admin/demo-payment-keys`, then clear the stamp |

Both directions are idempotent, so a repeat is a no-op and a failure just retries
next pass.

## Operator runbook

**Set the keys once.** Dashboard → Settings → _Demo payment keys_. Paste the
sandbox `sk_test_…` / `pk_test_…`. Live keys are refused here and again on every
academy. Saving clears every academy's ack stamp, so the sweep re-pushes — that
is how a rotation reaches academies that already hold the old pair.

**Per academy.** Client → academy card → _Demo payments_. New academies seeded
with sample content are armed automatically at provision time. Existing ones are
opted in here, deliberately, one at a time.

**Turning an academy into a real client.** Switch _Demo payments_ off. The next
sweep deletes our keys out of their database. Do this before they take real
money — an academy still holding our test key would appear to sell and collect
nothing.

**Kill switch.** Settings → _Revoke demo payment keys_ deletes the Stripe webhook
endpoints we registered, turns every academy's intent off (so the sweep deletes
the keys out of each instance), and forgets our copy — in that order, because the
endpoints can only be deleted while we still hold the secret key.

**Rotation.** Paste a new pair in Settings. Saving clears every academy's ack
stamp, so the sweep re-pushes; academies keep working on the old pair until the
new one lands. Both keys must come from the same sandbox — a mismatched pair is
refused, because the save form keeps a blank field's stored value and pasting only
a rotated secret key would otherwise pair it with the previous account's
publishable key.

## Why the keys are pushed, not seeded or passed as env

Both alternatives were tried on paper and are worse:

- **Env** — the instance compose interpolates the control plane's whole
  `process.env`, so one shared variable would reach _every_ academy, paying
  clients included, with no gate. Env values are also readable by anything with
  the docker socket, and `InstanceRef` carries no demo flag, so every
  upgrade/restart rebuilds the env and would silently drop it.
- **The seed** — `Setting` rows survive `SEED_WIPE` and `purgeDemoDebris` by
  design, and the demo block runs only on an instance's _first_ boot. A key
  seeded that way can't reach already-live academies and can't be revoked: an
  academy later sold to a real client keeps it forever.

A push works on a running academy, survives restarts (it lands in the database,
encrypted under that academy's own `SETTINGS_ENC_KEY`), and `DELETE` is a real
kill switch.

## Guardrails

**Test mode is enforced twice.** The control plane refuses a non-`sk_test_` /
`pk_test_` pair, and so does every academy. These credentials are replicated into
academies we hand to strangers; a live key here would turn a prospect's "fake"
checkout into a real charge on our account.

**The client's own key always wins.** `SettingsService.getEffectiveStripeKeys()`
resolves one _coherent_ set: own secret + own publishable, or demo secret + demo
publishable — never a mix. A mixed pair would point the browser at a different
account than the server charges on and every payment would fail.

**Demo keys have no env fallback.** They live under their own `Setting` keys with
no `envFallback` argument, so no stray compose variable can arm checkout.

**Tenant scoping.** Many academies on one Stripe account makes Stripe's
account-wide list endpoints cross-tenant. Every object an armed academy creates
carries `metadata.lms_tenant=<tag>`, and every account-wide read filters on it:
subscriptions, invoices (scoped via their parent subscription), promotion codes,
and the coupon mutations, which would otherwise act on a raw Stripe id belonging
to somebody else. The filter is **fail-closed** — armed but untagged shows
nothing, because on a shared account an unfiltered read is a data leak while an
empty list is only a bug.

**Ownership before mutation.** `revokeSubscriptionByCharge` resolves the local
user _before_ cancelling at Stripe. Every webhook endpoint on an account receives
every event on it, so without this one academy's refund would cancel another
academy's member.

**Caches know which account they came from.** The admin Subscriptions memo
records the account fingerprint it was built from, so arming or revoking takes
effect on the next read instead of serving the previous account's rows for a TTL.

**Switching accounts resets provisioned Stripe ids.** `price_…` and `prod_…` are
scoped to one Stripe account, and `ensureStripePrice` only mints a Price when
`stripePriceId` is null — so an id minted on our sandbox would otherwise be
permanent, and every paid checkout after the client added their own keys would
die on "No such price" with nothing to self-heal it.
`SettingsService.withStripeAccountReset()` wraps every mutation that can change
the account (admin save/delete, operator arm/revoke) and clears those ids when it
actually changed. This is the same rule PayPal already has in
`clearPayPalProvisionedIds`.

It clears `User.stripeCustomerId` too, which is the easy half to miss:
`ensureCustomer` returns an existing customer id _without calling Stripe_, so a
member who bought during the demo would point at a customer in the old account
forever — their next checkout dies on "No such customer" and their account page
throws on every load. STRIPE `SubscriptionMirror` rows go as well, since they
index subscriptions that can no longer be reconciled or cancelled. Existing
`UserLevel` grants are deliberately left alone: access already sold is not ours to
take back here.

"Changed" means a different **account**, not a different key string. A
same-account key rotation must reset nothing — the ids are all still valid, and
clearing them would stop every live subscription reconciling, orphan per-level
coupons and mint duplicate Products.

**An unreadable client key fails closed.** `getSecret` reports a row it cannot
decrypt as "not set" (rotated `SETTINGS_ENC_KEY`, corrupted ciphertext). Left
alone, that would silently move a paying client's checkout onto our sandbox,
where it collects nothing. If the `stripe.secretKey` row exists but will not
decrypt, payments stay unavailable and the API logs an error — loud, not quiet.

**Tenant tags never repeat.** `destroyInstance` frees an academy's subdomain and
`allocateSubdomain` can hand the same one to a new academy, so the tag carries the
immutable row id too. Without that, a new academy would inherit the previous
holder's subscriptions, customer emails and coupons on the shared account.

**Arming is owner-only; disarming is not.** Handing an academy credentials that
are not its own is an OWNER action. Turning it off is the safe direction and stays
open to any platform operator, so nobody waits on an owner to stop an academy
graduating with our keys still in it.

## What the client's admin sees

Three surfaces, so an admin who never opens Settings still finds out — the
failure mode is silent (the site appears to sell and collects nothing):

- **A banner on the admin dashboard**, above the KPIs, whenever the demo keys are
  actually in use, linking straight to Settings.
- **A notification in the bell** (`PAYMENT_KEYS_DEMO`, WARNING). It is a standing
  STATE, not an event: one row, fixed dedupe key, and it is **deleted** the moment
  the keys stop being active — a stale "no money reaches you" left in the bell
  after the client added their own keys would be worse than never warning them.
  `SettingsService.withStripeCredentialChange()` reconciles it on every
  credential mutation, so it cannot drift.
- **A test-mode banner on the checkout page itself**, which the client sees on
  their own site and which tells a prospect which card to type.

The dashboard banner is gated on the `settings` permission, like every other
fetch on that page — the academy owner is SUPER_ADMIN and always passes, and a
staff admin without settings access could not act on it anyway.

## Webhooks

The control plane registers one endpoint per academy at
`https://<sub>-api.<fleet>/billing/webhook`, **pinned to `api_version`
2024-06-20**.

That pin is load-bearing. `billing.service.ts` reads `invoice.subscription`,
`invoice.payment_intent` and `subscription.current_period_end` as top-level
fields, which is the 2024-06-20 shape; newer versions moved them. A webhook
endpoint's payload shape follows the _endpoint's_ API version, not the SDK's, so
an endpoint left on a new account's default would make `invoice.paid` a silent
no-op — renewals would succeed at Stripe and grant nothing.

Registration is best-effort. Stripe returns a signing secret only on create, so
the new endpoint is created **first** and the previous one for that URL retired
after — a failed create then leaves the academy on its working endpoint instead of
stripping both. If registration fails (including Stripe's per-account endpoint
cap), the keys are pushed with an explicit null signing secret and the demo still
works: the checkout page reconciles the grant inline via `POST /billing/sync`.
Only later status changes — renewal, cancellation, refund — need the webhook.

The push itself is two steps: a keys-only POST first (which is why the instance
treats an omitted `webhookSecret` as "leave the stored one alone"), then a second
POST carrying the signing secret. Doing it in that order means an academy that is
unreachable or rejecting never causes the Stripe endpoint to be churned.

Only a **400** from an academy is terminal — that is the one status its guards use
to mean "these keys are wrong", and it disarms the academy with an alert. A 404
(academy still on an image without the route), 401 (service token rotated) or 429
(throttler busy) are retried, because throwing the operator's intent away over a
transient is worse than trying again in five minutes.

## Testing a demo checkout

Card `4242 4242 4242 4242`, any future expiry, any CVC, any postal code. The
checkout page shows this itself whenever the publishable key is `pk_test_…`.

Two things to know when demoing to a room:

- **Signup is throttled to 3/min/IP.** Several prospects signing up from one
  office or conference IP will hit a 429.
- **A member can't buy the same class twice.** Repeat demos need a different
  class or a fresh email.
