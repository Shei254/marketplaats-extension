# Click-through scripts

One script per vertical slice ([ADR-0016](adr/0016-vertical-slices-and-review-gates.md)). **A slice is done
when its script has been walked against a real build — not when its tickets close.** Written before the slice
is built, so it is a target rather than a report.

Numbered steps, what to click, and what must be on the screen. Where a step can fail in a way worth catching,
the failure is written down too — a script that only records the happy path reviews half the product.

> ⚠️ Relisting is delete + re-create and is destructive (ADR-0002). **Use a throwaway ad on a test
> Marktplaats account**, exactly as [`live-testing.md`](live-testing.md) says.

## Before any of them

```bash
cp .env.example .env                             # once — every credential below is read from it

docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
cd apps/api && ./gradlew bootRun
npm run build -w @mprelist/extension             # dist/ — load unpacked
```

`.env` is gitignored and is the one place this repository takes credentials from: `bootRun` and `./gradlew
test` load it, and the stack gets it through `--env-file`. Anything exported in your shell still wins over
it — which is how to override one value for one command.

The extension id it ships with comes from the `key` T44 pinned in the manifest, and a test fails the build if
the two disagree; recompute it yourself with `npm run -s extension-id -w @mprelist/extension` if you have
replaced the key. The realm imports on **first start only**, so if the id is wrong the fix is `down -v`, not
a restart — and the same is true of forgetting `--env-file`, which is why compose refuses to run when the
file it names is missing rather than starting without it.

`bootRun` does **not** need it: the API's allowed CORS origin defaults to that same pinned id, and a test
derives it from the manifest's key so the default cannot go stale. Setting it anyway overrides both, which is
what a Web Store id will need at publish (#87). Whatever it resolves to, the API logs the origins it will
accept as it starts — the browser's refusal names nothing about the API, so that line is the other end of the
thread.

> **A stack started before 2026-08-21 has the realm from before [#108](https://github.com/Shei254/marketplaats-extension/issues/108)**,
> whose clients mint tokens carrying the signed-in user's name and email address. Nothing reads them and the
> script below passes either way, so the only way to notice is to decode a token — `down -v` first and it
> cannot come up. The same reset is what re-syncs a container whose realm was edited in the admin console,
> and it is what gives you the `sslRequired` compose now sets: without it Keycloak answers **403 "HTTPS
> required"** to the browser on some daemons, and step 3 below never opens a login page.

---

## Slice A · I can sign in

**Proves:** identity works, and everything shipped in #14–#26 is real.

1. `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist/`.
   *Expect:* the extension is named from `brand.json` — **not** "Marktplaats Relist (POC)".
   *Expect:* the **ID shown matches `npm run -s extension-id -w @mprelist/extension`**. This is the only
   place our derivation is checked against Chrome's own; if they disagree, stop — the realm was built from
   the wrong redirect URI and sign-in in step 3 will fail with `Invalid parameter: redirect_uri`.
2. Click the toolbar icon **while signed out**.
   *Expect:* a sign-in screen and **nothing else**. No ad list, no quota, no plan.
3. Click sign in.
   *Expect:* a Keycloak window on the realm's login page, offering **Register** and **Forgot password?** as
   well as the form. Sign in as `dev` / `local-dev-password` (infra/README.md — the password is no longer the
   username, since the realm gained a policy).
3a. Sign out and click **Register** instead. Make an account with a password under twelve characters.
   *Expect:* refused, on the form, saying why. A real one is accepted and signs you straight in — and the
   popup shows **`Free · 3 of 3`**, because the API provisions a stranger on their first call like anyone
   else. This is the path every customer takes and the only one nobody has walked.
4. *Expect:* the window closes on its own and the popup shows the signed-in state.
5. Read the header.
   *Expect:* **`Free · 3 of 3 relists left`** and a reset date about a month out. That number came from
   `/api/me`, which came from the tier catalog seeded in #18 — this is the first time any of it has been
   seen.
6. Read the list.
   *Expect:* your real Marktplaats ads, with titles and prices. Empty account → "You have no active ads",
   not a spinner and not an error.
7. Close the popup and reopen it.
   *Expect:* still signed in, no second Keycloak window. Quota still 3 — **`/api/me` spends nothing**, so
   opening the popup five times must not cost a unit.
8. **Stop the API** (`Ctrl-C` on `bootRun`) and reopen the popup.
   *Expect:* "unavailable, retry". **Never "active", never a quota.** Fail-closed applies to display.
9. Restart the API, sign out.
   *Expect:* back to step 2's screen — tokens cleared, list gone.

---

## Slice B · The gate bites

**Proves:** the enforcement stack behaves the way ADR-0007 says, judged from a human's chair.

1. Signed in on Free with 3 left, click **Repost** on a throwaway ad.
   *Expect:* the row goes busy, the other rows lock, and the ad is deleted and recreated on Marktplaats.
2. *Expect:* the header now reads **`2 of 3`**, from `/complete`'s response — **without** a second `/api/me`
   call.
3. Immediately click **Repost** on another ad.
   *Expect:* the row **counts down 45–90 seconds** and says *"…so your reposts look like clicks rather than
   a script"* — the pace (#54), not a refusal. When it reaches zero the relist runs and **succeeds**. That is
   the point of pacing: it keeps you under #25's 30s rail rather than discovering it, so this step no longer
   produces the cooldown it used to.
3a. To see the rail itself, set `mprelist.safety.minimum-interval: 5m` in `application.yml`, restart the API,
   and repost twice.
   *Expect:* the second is refused with a **cooldown countdown**, and every row locks — the rails are per
   user. Put the setting back afterwards.
4. Wait it out, then spend the remaining two.
   *Expect:* the header reads **`0 of 3`**.
5. Click **Repost** again.
   *Expect:* the button is **locked**, the ads are **still listed**, and the prompt is upgrade-shaped with
   the reset date. The list staying visible is deliberate — it is the conversion surface.
6. **Stop the API** and click **Repost**.
   *Expect:* refused, and **no ad is deleted**. Fail-closed means no relist without a fresh `200`.
7. Restart the API. In `psql`, raise the free tier's quota to 5; reopen the popup.
   *Expect:* `2 of 5`, and relisting works again. One subtraction, three readers.
8. Lower it to 1 while 3 units are held; reopen.
   *Expect:* `0 of 1`, **never a negative number**.

---

## Slice C · I can pay, and it unlocks

**Proves:** the money loop, end to end, in test mode.

```bash
stripe listen --forward-to localhost:8080/api/stripe/webhook
# `stripe listen` prints a signing secret, and the API refuses every event without it. Both of these go in
# .env — the same file the stack and `./gradlew test` read — and then (re)start bootRun:
#   MPRELIST_STRIPE_WEBHOOK_SECRET=whsec_…
#   MPRELIST_STRIPE_SECRET_KEY=sk_test_…          # the test-mode key `GET /api/plans` reads amounts with
npm run dev -w @mprelist/web        # http://localhost:5173 — where steps 5 and 6 land
```

The secret is per session, so a new `stripe listen` needs a new line in `.env` and a restart. Unset, the API starts
and says so at WARN — **"No Stripe webhook secret is configured, so every Stripe event will be refused"** —
and every event below comes back `400` in the `stripe listen` output. That log line is the other end of the
thread, since a refused webhook looks like nothing at all from the dashboard.

`stripe listen` forwards **everything**, which is what makes steps 1 to 8 work with no configuration. A
deployed endpoint (T57, #88) is subscribed by hand, and the five it needs are `price.created`,
`price.updated`, `customer.subscription.created`, `customer.subscription.updated` and
`customer.subscription.deleted`. Anything else is answered `200` and ignored.

The Checkout session (T19, #29) has to be created with **`http://localhost:5173/success`** and
`/cancel`; those two paths are `PATHS` in `apps/web/src/routes.ts` and Stripe holds the only other copy of
them. The dev server answers every path with the one `index.html`, which is what makes `/success` a page
rather than a 404 — a host that does not (T55, #86) breaks this step *after* the money has moved.

1. In the Stripe **test** dashboard create a Product and a recurring Price, tagged
   `metadata.tier_code = pro`. Give the Price a **nickname** if you want the tier renamed; without one it
   keeps the name it has.
   *Expect:* the sync webhook fires and the seeded `pro` row gains a `stripe_price_id` and `published`
   — **and its quota is still 50**, not overwritten.
2. Create a Price with **no** `tier_code`.
   *Expect:* nothing is adopted. No tier appears. (It shows up in slice D's unadopted list.)
2a. Create a Price tagged with a code no tier carries — `metadata.tier_code = starter`.
   *Expect:* a **draft**: the tier exists at quota 0, unpublished, and is on no plan card. It is what T53
   publishes.
3. With quota exhausted, open the popup and click **See plans** on the prompt.
   *Expect:* plan cards with **real amounts from Stripe**, and the plan you are on shown as a card of its own
   marked **Current**. Pro and Power carry an amount; **Free does not** — a tier `/api/plans` does not sell is
   one this popup knows no price for, so it shows what is left of it instead. The draft from step 2a is not
   there either. Comment `MPRELIST_STRIPE_SECRET_KEY` out of `.env` and restart to see the other half: `503`,
   and "Prices couldn't be loaded" rather than a guessed amount.
   *Also:* **Plans** in the header reaches the same screen without being out of relists, which is the only way
   in for somebody who is paying and wants to cancel.
4. Click **Upgrade** on Pro.
   *Expect:* a Stripe Checkout tab opens. The popup closes — that is expected, not a bug. The tab is opened by
   the **service worker**, so if nothing happens the worker console is where to look, not the popup's.
5. Pay with `4242 4242 4242 4242`.
   *Expect:* redirect to `apps/web`'s success page, which asks you to reopen the extension and **does not
   ask you to log in**.
6. Reopen the popup.
   *Expect:* **`Pro · 50 relists left`** and unlocked buttons, and `resetAt` is **Stripe's** period end rather
   than a month from signing up. Relist once to confirm.
   *If it still says Free:* the webhook is where to look, not the popup — `stripe listen` shows the
   `customer.subscription.created` delivery and its status, and a `400` there is the signing secret.
7. Open the Customer Portal from the popup — **Plans → Manage billing** — and cancel **immediately** (not at
   period end, which is what the Portal offers by default — "cancel now" is in the test dashboard's own
   subscription view).
   *First time only:* the Portal has to be **saved once in the Stripe dashboard** (Settings → Billing →
   Customer portal) before `POST /api/portal` can open a session at all. Until it is, Stripe answers *"No
   configuration provided and your test mode default configuration has not been created"*, the API logs that
   message at WARN and answers `503` — which the popup shows as unavailable, with nothing to say it is a
   dashboard setting rather than an outage. That log line is the only place the two are told apart.
   *Expect:* when Stripe reports the end, the popup shows **`Free · 3`** — not a lockout, and **not** a 402.
   `stripe_customer_id` is still on the row and `stripe_subscription_id` is gone, which is what makes step 7a
   one billing history. That is [ADR-0018](adr/0018-lapse-falls-back-to-the-default-tier.md).
7a. Buy Pro again.
   *Expect:* Checkout is prefilled as the **same customer**, and the popup is back on Pro. The Stripe
   dashboard shows one customer with two subscriptions, not two customers.
8. Force a failed payment (`4000 0000 0000 0341`) on a fresh subscription.
   *Expect:* during dunning the popup keeps the **paid tier**, shows locked buttons, and the copy is
   **"update your card"** with an **Update card** button that opens the Portal — not "resubscribe".
9. Stop the API, then open the plan cards.
   *Expect:* "Prices couldn't be loaded", with **Try again** beside it. Never a guessed amount, never a free
   plan. A user who has never paid clicking **Manage billing** gets "you haven't paid for anything yet" rather
   than an error — that one is a `404` and is the ordinary answer.

---

## Slice D · I can run it

**Proves:** you can operate the product without a database client.

```bash
npm run dev -w @mprelist/web        # http://localhost:5173/admin
```

The realm's `mprelist-dashboard` client registers **`http://localhost:5173/`** and Keycloak matches redirect
URIs exactly, so sign-in lands on `/` and the page rewrites the address bar to `/admin` afterwards. Seeing
`?code=…` in the bar for a moment is that, working.

1. Open `/admin` **signed out**.
   *Expect:* Keycloak's login page immediately — there is no sign-in button, because arriving here *is* the
   request to sign in. Then the tier list.
2. Sign in as a **non-admin** dev user (`dev`).
   *Expect:* **"Not your corner"**, and a **Sign in as somebody else** button. Not a retry: signing in again
   returns the same person. The API enforces the role server-side as well — the screen only decides what to
   say, and without the button this step is a trap with no way out.
3. Sign in as the admin (`dev-admin`).
   *Expect:* the tier list, and the Price from slice C step 2 under **Stripe Prices with no tier** — a missing
   `tier_code` must be visible, not silent. If Stripe is unreachable that list says so rather than showing
   nothing, because empty is the *good* state.
4. Set the default tier's quota to **0** and save.
5. Sign in to the extension as a **fresh** user.
   *Expect:* they are provisioned, they see their ads, and every button is locked with an upgrade prompt.
   **No error, no failed sign-in.** This is "the admin decided there is no free tier".
6. Look for a way to unset `isDefault`.
   *Expect:* there isn't one. Only **Make default**, on the tiers that are not it — a catalog with no default
   provisions nobody, so the API offers no request that could produce one and the screen has no control for
   it. Moving it to another tier and back is the whole of what can be done.
7. Create a draft: add a Price in Stripe with a `tier_code` nobody has published.
   *Expect:* it appears in `/admin` at quota 0, marked **draft** and highlighted, and **not** on the popup's
   plan cards.
8. Give it a quota and tick **On sale**.
   *Expect:* it appears on the plan cards, and it can be bought. Try the same on a tier with **no** Stripe
   Price: the form says so before you save, and the API refuses it anyway.
9. Click **New plan** and create one without leaving the screen.
   *Expect:* the currency dropdown holds what **your** Stripe account can settle in — read from Stripe, so a
   test-mode Dutch account shows EUR first — and the form says the amount is written once. On submit, Stripe
   has a new Product and Price tagged `metadata.tier_code`, and `/admin` has the tier, **not on sale**.
   *Check the other side:* `stripe listen` shows a `price.created` arriving a moment later and the tier does
   not change again — the sync is the same path either way, and the second write is a no-op.
9a. Create another with the **same code**.
   *Expect:* refused. Codes are permanent; adopting it would repoint the first tier's Price and leave its
   subscribers paying the old amount for a plan advertising a new one.
9b. Create one for **1 cent**.
   *Expect:* Stripe's own words on the screen — "amount must be at least 50 cents" or similar. That sentence
   is the one thing that says what to change, which is why this route answers a `problem` at all.
9c. Stop `stripe listen` and create a plan.
   *Expect:* it still works. The route adopts the Price itself through the same call the webhook makes, so
   the tier appears whether or not anything is forwarding events.
9d. Click **Prices** on a plan and add the rhythm it does not sell at yet.
   *Expect:* the popup's card for that plan now has **two buttons**, one per rhythm, each saying its own
   amount — one plan, not two. Buy the annual one and check the Stripe dashboard shows a yearly subscription.
9e. Click **Prices** again and pick a rhythm it *already* sells at.
   *Expect:* the form says a replacement is being created and that **everybody already subscribed keeps the
   price they signed up at**. After saving, the plan card shows the new amount and the other rhythm is
   untouched — which the single price column could not do.
10. Reprice: in Stripe, create a **new** Price tagged with an existing tier's code.
   *Expect:* the tier repoints, the plan cards show the new amount, and anybody already subscribed keeps
   paying the old one — which is Stripe's immutability, not a bug. Force a failed payment on one of them and
   check the popup still turns to **"update your card"**: their Price no longer matches any tier, and their
   status is mirrored all the same.
9. Leave `/admin` open for longer than the realm's five-minute access token and click **Save**.
   *Expect:* Keycloak takes over and hands you back where you were — the token lives in memory only and there
   is no refresh, so a `401` is one redirect rather than an error.
