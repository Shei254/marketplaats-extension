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
export MPRELIST_EXTENSION_ID=$(npm run -s extension-id -w @mprelist/extension)

docker compose -f infra/docker-compose.yml up -d --wait
cd apps/api && ./gradlew bootRun
npm run build -w @mprelist/extension             # dist/ — load unpacked
```

The id comes from the `key` T44 pinned in the manifest, so the substitution above is always right and a
literal you pasted last month may not be. The realm imports on **first start only**, so if it is wrong the fix
is `down -v`, not a restart.

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
   *Expect:* refused with a **cooldown countdown**, not an error. The 30s minimum interval is #25's rail.
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
```

1. In the Stripe **test** dashboard create a Product and a recurring Price, tagged
   `metadata.tier_code = pro`.
   *Expect:* the sync webhook fires and the seeded `pro` row gains a `stripe_price_id` and `published`
   — **and its quota is still 50**, not overwritten.
2. Create a Price with **no** `tier_code`.
   *Expect:* nothing is adopted. No tier appears. (It shows up in slice D's unadopted list.)
3. With quota exhausted, open the popup and click the upgrade prompt.
   *Expect:* plan cards with **real amounts from Stripe**. The free tier is **not** among them.
4. Click **Upgrade** on Pro.
   *Expect:* a Stripe Checkout tab opens. The popup closes — that is expected, not a bug.
5. Pay with `4242 4242 4242 4242`.
   *Expect:* redirect to `apps/web`'s success page, which asks you to reopen the extension and **does not
   ask you to log in**.
6. Reopen the popup.
   *Expect:* **`Pro · 50 relists left`** and unlocked buttons. Relist once to confirm.
7. Open the Customer Portal from the popup and cancel.
   *Expect:* when Stripe reports the end, the popup shows **`Free · 3`** — not a lockout, and **not** a 402.
   That is [ADR-0018](adr/0018-lapse-falls-back-to-the-default-tier.md).
8. Force a failed payment (`4000 0000 0000 0341`) on a fresh subscription.
   *Expect:* during dunning the popup keeps the **paid tier**, shows locked buttons, and the copy is
   **"update your card"** with a Portal link — not "resubscribe".
9. Stop the API, then open the plan cards.
   *Expect:* "prices unavailable, retry". Never a guessed amount, never a free plan.

---

## Slice D · I can run it

**Proves:** you can operate the product without a database client.

1. Open `/admin` **signed out**.
   *Expect:* Keycloak login, then the tier list.
2. Sign in as a **non-admin** dev user.
   *Expect:* refused. The `ADMIN` role is the guard and the API enforces it server-side.
3. Sign in as the admin.
   *Expect:* the tier list, and the Price from slice C step 2 shown as **unadopted** — a missing `tier_code`
   must be visible, not silent.
4. Set the default tier's quota to **0** and save.
5. Sign in to the extension as a **fresh** user.
   *Expect:* they are provisioned, they see their ads, and every button is locked with an upgrade prompt.
   **No error, no failed sign-in.** This is "the admin decided there is no free tier".
6. Try to unset `isDefault` without setting another.
   *Expect:* refused. A catalog with no default provisions nobody.
7. Create a draft: add a Price with a `tier_code` nobody has published.
   *Expect:* it appears in `/admin` at quota 0 and **not** on the popup's plan cards.
8. Give it a quota and publish.
   *Expect:* it appears on the plan cards, and it can be bought.
