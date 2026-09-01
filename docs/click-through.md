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
6a. Type part of one ad's title into the search box (T31, #40), one letter at a time.
   *Expect:* nothing happens on the first letter, and from the second the list narrows **once you stop
   typing** — not on every keystroke. Watch the **Network** tab of the marktplaats.nl page's DevTools: one
   `…/listings?query=…` per pause, not one per letter. Then type something no ad is called.
   *Expect:* "No ads match “…”", **never** "You have no active ads" — the second would be a lie about the
   account. Clear the box with the ✕.
   *Expect:* the whole list is back **immediately**, with no wait.
6b. Type a query that matches, then **immediately** type a different one that also matches, faster than the
   pause.
   *Expect:* the list ends up showing the second query's matches. The first request may still be in flight;
   it must not be allowed to land on the screen afterwards. This is the failure the suite pins and a real
   account is the only place the timing is real.
6c. With a search on the screen, press **Refresh**.
   *Expect:* the box keeps its query and the search is re-run — not an emptied box and the whole list.
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
2a. Find that same ad through the search box and repost it from there.
   *Expect:* the list comes back **still filtered**, showing the fresh ad — a repost re-runs whatever is on
   the screen, and the new ad has a new id, so a list that did not re-read would offer a Repost button for an
   ad that no longer exists.
3. Immediately click **Repost** on another ad.
   *Expect:* the row **counts down 10–30 seconds** and says *"…so your reposts look like clicks rather than
   a script"* — the pace (#54), not a refusal. When it reaches zero the relist runs and **succeeds**. That is
   the point of pacing: it keeps you under #25's 5s rail rather than discovering it, so this step no longer
   produces the cooldown it used to.
3a. To see the rail itself, set `MPRELIST_MINIMUM_INTERVAL=5m` in `.env`, restart the API, and repost twice.
   *Expect:* the second is refused with a **cooldown countdown**, and every row locks — the rails are per
   user. Comment the line back out afterwards.
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
3a. Read the line under **Choose a plan**.
   *Expect:* **"Pay with iDEAL, PayPal, card or SEPA Direct Debit."** — the methods ticked in the Stripe
   dashboard (T22 keeps that list: iDEAL, SEPA, PayPal and card) in the popup's own order, rather than a
   string in the popup (T65, #137, [ADR-0022](adr/0022-the-plan-screen-names-the-payment-methods.md)). Untick
   one there and it leaves the sentence — **though not for up to `mprelist.stripe.payment-method-cache`
   (15m)**. Unlike an amount, a configuration is mutable in place, so that TTL is real staleness rather than a
   bound on a mistake; restart the API to see the change at once. A method the popup has no name for is left
   out silently, so enabling Klarna changes nothing on screen — the API logs the whole offered set each time
   it refreshes, and that log is where a missing name shows up.
   *The half that matters more:* the cards never depend on any of this. When Stripe cannot be asked the line
   is simply absent and **every card is still there** — the one place this route is deliberately not
   all-or-nothing, because a missing sentence is not a wrong comparison.
4. Click **Upgrade** on Pro.
   *Expect:* a Stripe Checkout tab opens. The popup closes — that is expected, not a bug. The tab is opened by
   the **service worker**, so if nothing happens the worker console is where to look, not the popup's.
   *Also:* the page offers **iDEAL, SEPA, PayPal and card** (T64) — the same four the sentence in 3a named,
   which is the check that matters: the popup read them from the dashboard rather than holding a copy.
   One thing in `apps/api` does name methods, and only ever to withhold them: iDEAL, Bancontact and Sofort
   bill again through a SEPA mandate, so `CachedPaymentMethods` drops them from 3a when **SEPA Direct Debit**
   is off, logging an `INFO` line each refresh that names the ones it dropped. **iDEAL absent from 3a is
   therefore either the dashboard or that** — read the log before hunting the dashboard. Nothing else in
   `apps/api` names a method, so any other absence is the dashboard. PayPal missing *here* while it works on
   a one-off Checkout is Stripe's per-account **recurring** setting for PayPal, which is the one part of T64
   that is not a checkbox. That is also the gap ADR-0022 records as unclosed: 3a can name a method this page
   then does not offer.
5. Pay with `4242 4242 4242 4242`.
   *Expect:* redirect to `apps/web`'s success page, which asks you to reopen the extension and **does not
   ask you to log in**.
5a. Do 4 and 5 again on a fresh account, paying with **PayPal**.
   *Expect:* the same success page and the same `customer.subscription.created`. **No PayPal business account
   is connected in test mode and none is needed.** If Checkout lists PayPal among the methods, choosing it and
   clicking **Pay** is the whole flow; if it renders PayPal's own *button*, that hand-off wants a personal
   PayPal **Sandbox** account. The mirror (T20, #30) reads the subscription and never the method, so nothing
   downstream of here can tell the two payments apart — which is the whole of why PayPal is a method.
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
   *Expect:* a dashboard — a sidebar, the **Tiers** page open on it, and four counts over the table saying how
   many plans there are, how many are on sale and how many are drafts. Under those counts, one warning line
   saying a price in Stripe carries no tier: the Price from slice C step 2 — a missing `tier_code` must be
   visible, not silent. Open the line and it lists them. With every Price tagged there is no line at all,
   because empty is the *good* state; if Stripe is unreachable the line says the list is unknown rather than
   showing nothing.
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
   *Expect:* the form **shows** the currency your Stripe account settles in rather than offering a choice —
   every tier is priced in it, because a plan screen with two currencies on it is not a comparison — and says
   the amount is written once. On submit, Stripe
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

### The night Marktplaats moves something (T27, #36)

The other half of operating this, and the only one with no screen: the client config is an environment
variable and a restart. Run these from a `build:dev` extension with the service-worker console open.

11. With `MPRELIST_CLIENT_CONFIG` unset, `await __clientConfig()`.
   *Expect:* `{ status: "stored", config: { schemaVersion: 1, endpoints: {}, csrf: null, pacing: null } }`.
   The empty document is the ordinary answer and it means *your defaults are correct* — not a `404`, not a
   `503`. `await __getEndpoints()` shows the built-in paths, unchanged.
11a. Set `MPRELIST_CLIENT_CONFIG={"endpoints":{"deleteAd":"/seller/api/nonsense"}}` and restart the API. Then
   `await __clientConfig()` and `await __getEndpoints()`.
   *Expect:* `deleteAd` is now the nonsense path and **nothing else moved**. Relisting a throwaway ad now
   fails *before* the delete, which is the point: the ad survives. Take the variable back out, restart, and
   `await __clientConfig()` — the empty document supersedes it and the built-in path is back. **This is the
   whole feature**, and both directions of it.
11b. Set it again, then `await __setEndpoints({ deleteAd: "/mine/delete" })`.
   *Expect:* `__getEndpoints()` says `/mine/delete`. Your override outranks the served document — the call
   #36 left open — so a config deploy cannot pull a path out from under you mid-session. Clear it with
   `chrome.storage.local.remove("endpointOverrides")` and the served one is back.
11c. Set `MPRELIST_CLIENT_CONFIG={"csrf":{"mode":"eval","header":"x"}}` and restart the API.
   *Expect:* **it does not start**, and the log names the four modes there are. A mode no client has a branch
   for is where "strictly data" is enforced rather than asserted. Same for `{"endpoint":{…}}` — a misspelt
   field deploys nothing, and this is the only moment anybody can be told.
11d. Set `MPRELIST_PACING_MIN_MS=2000` and `MPRELIST_PACING_MAX_MS=3000`, restart, `await __clientConfig()`,
   then repost two ads in a row from the popup.
   *Expect:* the second waits about two seconds instead of 10–30. The backend's own 5s rail is untouched, so
   it will refuse that second relist — which is correct and is the thing to see: the client's pacing is a
   courtesy the server does not trust, and a window set under the rail buys the cooldown it exists to avoid.
   The window is two settings rather than a line of `MPRELIST_CLIENT_CONFIG` because it is the field anybody
   actually changes; setting it in both places is refused at startup, and so is half of one.
11e. Stop the API entirely and `await __clientConfig()`.
   *Expect:* `unavailable`, and `chrome.storage.local.get("clientConfig")` still holds the last document. A
   backend that blinked must not un-apply the hotfix that is holding relisting together.

---

## Go-Live · The stack is somewhere else (T55, #86)

Not a slice: there is no screen here that slices A–D have not already reviewed, and what is being checked is
that the same screens work when nothing is on your machine. Walked **on the host**, from a clone of this
repository. [ADR-0020](adr/0020-deployment.md) is the shape of it and
[`infra/README.md` § Deploying](../infra/README.md#deploying) is the runbook.

The realm this imports is **not** `infra/keycloak` — that is [T56 (#87)](https://github.com/Shei254/marketplaats-extension/issues/87)'s
export, and it has to exist before step 2. Until TLS is in front (also T56), publish the three ports on
loopback and reach them through an SSH tunnel rather than over the internet.

1. `cp infra/production.env.example production.env`, fill in everything except
   `MPRELIST_KEYCLOAK_ADMIN_PASSWORD`, and bring the stack up.
   *Expect:* it refuses to start and names that variable and what it is for. Every credential and every
   address here is a variable with no default, so a half-filled deployment is a refusal rather than a stack
   running on somebody's guess. Fill it in.
2. `docker compose --env-file production.env -f infra/docker-compose.prod.yml up -d --build --wait`.
   *Expect:* both images build from source on the host and all four containers report healthy. The API's own
   check is a `401` from `/api/me` — the application answering *and* the resource server in front of it — so
   `--wait` returning means more than a listening port. First build is slow; there is no registry (ADR-0020).
3. Open `https://www.<domain>/success` and `https://www.<domain>/privacy` directly, without going through
   any other page.
   *Expect:* the pages, not a 404. **This is the step this ticket exists for**: one build and one
   `index.html`, so a host left on its default breaks the page a customer lands on after the money has moved
   — and the privacy URL is the one the Web Store listing publishes (T58, #89).
4. `curl https://www.<domain>/config.js`.
   *Expect:* the two addresses from `production.env`, not `localhost`. This is what the admin corner signs in
   and calls the API with; empty values here would mean it had fallen back to the addresses the bundle was
   built with.
5. Sign in at `https://admin.<domain>/admin` as a realm admin and change a tier's quota.
   *Expect:* the sign-in leaves for the deployed Keycloak and comes back signed in, and the save succeeds.
   A `401` on the save with a successful sign-in is the API trusting a different issuer than the browser
   used — check that step 4's issuer and `SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI` are the same
   address.
6. From your laptop, `psql postgres://mprelist@<host>:5432/mprelist`.
   *Expect:* it cannot connect. The database publishes no port; the two services that need it are on the
   compose network.
7. Reach Keycloak over plain `http://` from off the host, before TLS is in front of it.
   *Expect:* `403 {"error_description":"HTTPS required"}`. The realm imports as `sslRequired: external`
   because this compose file, unlike the local one, never relaxes it — so a deployment without TLS refuses
   sign-ins rather than serving them insecurely.
8. Set `MPRELIST_CLIENT_CONFIG` in `production.env` to a nonsense `deleteAd` path and re-run the `up`
   command; then `curl` `/api/client-config` with a token.
   *Expect:* the patch is served. The night Marktplaats moves something, this is the whole fix and it is a
   restart of one container — the ADR-0013 lever, now on a stack a user's extension can actually reach.
9. `docker compose … exec -T postgres pg_dump -U mprelist mprelist | gzip > mprelist-$(date +%F).sql.gz`.
   *Expect:* a file with a schema in it. Nothing backs this up for you and the volume is the only copy of
   every subscription this application knows about.

**What this does not check, and cannot yet:** a published extension talking to it. The extension's API and
issuer addresses are compiled in (`apps/extension/src/api/api-config.ts`, `auth/auth-config.ts`) and still
name `localhost` — T56 (#87) is what points a build at the deployed stack, and T58 (#89) is what publishes it.
