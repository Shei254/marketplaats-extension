# Chrome Web Store listing — field by field

What to paste into each field of the developer dashboard, in the order the dashboard asks. **Why** each
field says what it says is T58 in [`docs/backlog.md`](../docs/backlog.md); change a reason there and the
wording here together.

Placeholders in `<angle brackets>` are filled in by hand when submitting. The images and the video are in
`store/media/`, which is not committed because it shows a real account.

---

## Package

| Field | Value |
|---|---|
| Package | The zip attached to the GitHub release by CI (`extension-<tag>.zip`), **never** a hand-made one: `manifest.json` has to be at the root of the zip. |

## Store listing

| Field | Value |
|---|---|
| Name | *(from the manifest)* `AdBump` |
| Summary | *(from the manifest)* `Herplaats je Marktplaats-advertenties met één klik, zodat ze weer bovenaan staan.` |
| Category | Lifestyle → **Shopping** |
| Language | **Nederlands** |
| Store icon | `apps/extension/dist/icons/icon-128.png` |
| Global promo video | *(leave empty: the reviewer video is unlisted and goes in Test instructions)* |
| Screenshots | `store/media/screenshots/*.png`, 1280×800, in their numbered order |
| Small promo tile | `store/media/promo/small-tile-440x280.png` |
| Marquee promo tile | `store/media/promo/marquee-1400x560.png` *(optional)* |
| Official URL | *(only after verifying `adbump.nl` in Google Search Console; otherwise None)* |
| Homepage URL | `https://www.adbump.nl/` |
| Support URL | `mailto:contact@adbump.nl` — or the site's contact page, if it has one by then |
| Mature content | **No** |

### Description

```text
AdBump zet je Marktplaats-advertenties weer bovenaan.

Nieuwe advertenties staan op Marktplaats bovenaan; na een paar dagen zakt de jouwe weg tussen alles wat daarna geplaatst is. Met AdBump herplaats je een advertentie vanuit je browser, zodat hij weer bovenaan de recente advertenties staat.

Zo werkt het
• Open marktplaats.nl en log in zoals je gewend bent.
• Klik op het AdBump-icoon in je werkbalk en log in met je AdBump-account.
• Kies een van je advertenties en klik op Herplaats.

Goed om te weten
• Herplaatsen verwijdert je advertentie en plaatst hem direct opnieuw, met alle tekst en foto's.
• Alles gebeurt in je eigen browser, onder je eigen Marktplaats-login. AdBump ziet je Marktplaats-wachtwoord niet, en de tekst en foto's van je advertenties komen nooit bij ons.
• Je hebt een AdBump-account nodig. Aanmelden is gratis, en een gratis abonnement geeft een beperkt aantal herplaatsingen per maand. Wil je vaker herplaatsen, dan kies je een betaald abonnement.

Privacy: https://www.adbump.nl/privacy
Voorwaarden: https://www.adbump.nl/terms
Vragen: contact@adbump.nl

AdBump is een onafhankelijk product en is niet gelieerd aan Marktplaats.
```

Words this description must never gain, because Marktplaats's terms (7.4, 2.2.4) contradict them or they
imply Marktplaats's approval: *automatisch*, *officieel*, *toegestaan*, *volgens de regels*, *veilig voor je
account*, *geen risico*.

## Privacy practices

| Field | Value |
|---|---|
| Single purpose | `AdBump reposts the signed-in user's own Marktplaats advertisements, so that a listing that has sunk in the results is at the top of the recent listings again. Every permission it requests serves that one action.` |
| Privacy policy URL | `https://www.adbump.nl/privacy` |

### Permission justifications

| Permission | Justification |
|---|---|
| `storage` | `Stores four things, all locally in the user's browser: the sign-in session, a snapshot of the ad being reposted (so an interrupted repost can be restored), the time of the last repost (to pace consecutive reposts), and a configuration document served by our own API (JSON data only, no code).` |
| `unlimitedStorage` | `A repost deletes the original ad and re-creates it, so before deleting, the extension saves a snapshot of the ad including its photos. Photos of a single listing can exceed the default 10 MB quota, and running out of space would leave an ad deleted from Marktplaats that the extension can no longer restore.` |
| `identity` | `Sign-in to our own service uses OAuth 2.0 Authorization Code with PKCE through chrome.identity.launchWebAuthFlow; getRedirectURL is the only other call. getProfileUserInfo is never called, so no Chrome or Google profile information is read.` |
| `alarms` | `The service worker registers a chrome.alarms listener at startup. An alarm is what lets a paced sequence of reposts continue after the MV3 service worker is suspended, because the pause between reposts is longer than a suspended worker's timers survive.` |
| Host permission `https://www.marktplaats.nl/*` | `The extension reposts the user's own ads in their own, already signed-in Marktplaats session: it reads their active listings and submits the replacement, from a content script that runs on www.marktplaats.nl only. The host permission lets the service worker find that tab with chrome.tabs.query. The "tabs" permission is deliberately not requested, so no other site or tab is visible to the extension.` |
| Remote code | **No, I am not using remote code.** `No eval, new Function, dynamic import, remotely hosted script, chrome.scripting or userScripts. The only document fetched from our API is JSON (endpoint paths and timing values) that the packaged code reads as data.` |

### Data usage

Tick:

- [x] **Personally identifiable information** — email address and account id
- [x] **Authentication information** — the sign-in tokens for our own service
- [x] **Website content** — ad text and photos, read and kept locally; the ad id is sent to our API
- [ ] Health information
- [ ] Financial and payment information — *payment happens at Stripe, on the website, never in the extension*
- [ ] Personal communications
- [ ] Location
- [ ] Web history
- [ ] User activity

Certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Distribution

| Field | Value |
|---|---|
| Payments | **Contains in-app purchases** (subscriptions sold through Stripe on the website) |
| Visibility | **Public** |
| Regions | `<decide: Netherlands and Belgium, or all regions>` |

## Test instructions

| Field | Value |
|---|---|
| Username | `<reviewer account email>` |
| Password | `<reviewer account password>` |

```text
AdBump reposts a seller's own ads on marktplaats.nl, the Dutch classifieds site. The interface is in Dutch; the Dutch labels you will see are quoted below with their English meaning.

Reposting needs two logins: an AdBump account (provided above) and a Marktplaats account with at least one live ad. We cannot share a Marktplaats account, so an unlisted video of the complete flow on a real account is here: <unlisted video URL>

To check the parts that work without a Marktplaats account:
1. Click the AdBump icon in the toolbar and click "Inloggen" (Sign in). Sign in with the credentials above; the sign-in page is ours, at auth.adbump.nl.
2. The popup shows the account's plan and how many reposts are left this month.
3. With no marktplaats.nl tab open, the popup says "Open marktplaats.nl in een tabblad en probeer het opnieuw." (Open marktplaats.nl in a tab and try again.) This is expected: every request to Marktplaats is made from that tab, in the user's own session.
4. With marktplaats.nl open but not signed in there, it says "Log eerst in op Marktplaats en probeer het opnieuw." (Sign in to Marktplaats first and try again.) Also expected.

With a Marktplaats account that has a live ad (shown in the video):
5. The popup lists the account's active ads. Each has a "Herplaats" (Repost) button; hovering it explains that the ad is deleted and placed again.
6. Clicking "Herplaats" shows "Bezig met herplaatsen…" (Reposting…) and then "Herplaatst" (Reposted). On marktplaats.nl the ad is now at the top of the recent listings, with the same text and photos.

Paid plans: the plan cards under "Kies een abonnement" (Choose a plan) open Stripe Checkout on our website; the extension itself never handles payment details.

Privacy policy (Dutch): https://www.adbump.nl/privacy. In short: we store the account's email address, its plan, and a count of reposts with the ad ids. The ads' text and photos never leave the user's browser, and no analytics or advertising code is included.
```

## Account (once, not per item)

| Field | Value |
|---|---|
| Contact email | `contact@adbump.nl`, verified |
| Trader status (EU) | **Trader** — AdBump sells subscriptions. The Store then shows the trader's name, address, phone and email on the listing: `<company name>`, `<address>`, `<phone>`, `contact@adbump.nl` |
