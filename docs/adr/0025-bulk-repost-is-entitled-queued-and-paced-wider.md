# ADR-0025: Bulk repost is a paid entitlement, run by the worker, paced wider than a single repost

**Status:** Accepted (2026-09-05)
**Scope:** Extension and API. **Realises the `bulk` feature flag** [ADR-0007](0007-quota-enforcement.md)
named and [ADR-0014](0014-tier-catalog-and-entitlements.md) has carried as data ever since. Builds on
[ADR-0008](0008-safety-and-consent.md)'s pacing posture without loosening it. T68 builds it.

## Context
The popup reposts one ad at a time and locks every other row while one runs (T30b,
[#79](https://github.com/Shei254/marketplaats-extension/issues/79)). That rule is not about throughput and
never was: delete-first ([ADR-0003](0003-relist-safety-and-snapshot.md)) makes a distracted click on three
rows three irreversible deletes, and serialising them is what stops it.

A seller with thirty ads who wants twenty of them back on top is therefore twenty clicks, spread over twenty
countdowns, with a Chrome popup that closes the moment they look at anything else. The mechanic works and the
surface does not scale with the account it is for.

**`bulk` has been named and unimplemented since the domain model was first written.**
`V2__seed_tier_catalog.sql` leaves every tier's `features` at `{}`, and a test —
`andNoTierPromisesAFeatureThatDoesNotExist` — holds it there, precisely so no tier advertises something a
client would render as available. Building this is what makes that flag real, and it is why a seed change is
part of the decision rather than a detail of it.

**One third of the request already existed.** It arrived as three asks — drop the popup's misreading of
`minimumBidPriceCents` (T67, unrelated, recorded there), select several ads and repost them together, and put
a randomised sleep between the postings. The last has been shipped since T46
([#54](https://github.com/Shei254/marketplaats-extension/issues/54)): `RelistPacer` draws a uniform 10–30s
gap per relist from a window an operator can move without a store release. So what this decision does with
pacing is give it a **second** window, not build one.

## Decision
**Bulk is a paid entitlement the popup gates and the API refuses, run as a persisted queue owned by the
service worker, paced from a window of its own.**

### Four rejections first, because each of them will be re-proposed

**A batch cannot be authorized up front.** The obvious shape — one call naming N ads, N grants back — is
foreclosed by two numbers this contract already fixes. An `authToken` lives ~45 seconds and is single-use
(`enforcement-contract.md` § Anti-stockpiling), so nine of ten grants issued together expire before their
turn; and `mprelist.safety.minimum-interval` refuses a second reservation inside 5 seconds, so the second
grant would be denied in the same breath as the first was issued. **Every ad keeps its own `authorize` at its
own moment.** What changes is that the request says it is part of a batch.

**The batch cannot run in the popup.** A Chrome popup is destroyed by any click outside it — the reason
sign-in, Checkout and the relist itself already live in the worker (ADR-0010, ADR-0017, ADR-0003). A run that
is worth starting is a run somebody walks away from, and a loop driven from the popup is a loop that ends
when they do, mid-relist, with delete-first half-executed.

**Bulk cannot simply reuse `HUMAN_PACE`.** `chrome.alarms` is clamped to a ~30 second minimum in MV3, and
`HUMAN_PACE` is 10–30s — *the entire window is at or below the clamp*. An alarm-driven run on that window
does not produce a jittered gap, it produces a **30-second metronome**, which is the one thing
`relist-pace.ts` is written to prevent ("a fixed gap is as machine-shaped as no gap at all, only slower") and
the opposite of what was asked for. The clamp is also invisible in development, because unpacked extensions
are not clamped.

**The burst rail must not become a tier lever.** The tempting way to make a big plan feel big is to let it
relist faster. [ADR-0008](0008-safety-and-consent.md) forecloses it: the rails are harm reduction for **the
user's own** Marktplaats account, not a throttle protecting ours. A larger plan does not make somebody's
account safer, so selling relief from the rail would be selling them a higher chance of being banned.
`burst-limit` stays 10 an hour for everybody, and a bigger plan buys more relists per **period**, which is the
axis the tiers already differ on.

### The mechanism

**Entitlement.** `features.bulk` carries a value rather than a boolean — `{"upTo": 10}` on Pro, `{"upTo":
25}` on Power, absent on free — which is the shape `Entitlement.java` was written to hold and
`TierEntitlementTest` already pins ("bulk, up to 20 at a time"). A selection is capped at
`min(quotaRemaining, upTo)`.

**The wire.** `POST /api/relist/authorize` gains an optional `batch: true`. The API refuses it with
`403 BULK_NOT_ENTITLED` when the caller's Entitlement carries no `bulk`, checked **after** subscription status
and **before** quota: a request naming a capability the plan does not include should not be answered about a
quota it also does not have. An older build never sends the field and is unaffected; a newer build against an
older API has the field ignored, which the popup's own gate covers.

**`upTo` is the popup's cap and cannot be the API's.** The API sees one ad at a time and has nothing to count
a batch with. So the split is: the backend enforces *whether* you may bulk, the client enforces *how many at
once*. That is [ADR-0007](0007-quota-enforcement.md)'s soft enforcement exactly as it already stands — "we
gate the automation, not the underlying action" — and it is recorded here rather than discovered later.

**Execution.** The queue is a document in `chrome.storage.local` owned by the worker, and `chrome.alarms`
(a new manifest permission) is what wakes the worker for each next ad. The run therefore survives both the
popup closing and the worker being evicted, which is the whole point of not running it in the popup.

**The bulk window is a second served window, 30–60s**, beside the `pacing` block `GET /api/client-config`
already carries. It clears the alarm clamp, so the randomisation is real rather than nominal; single reposts
keep 10–30s and their fast feel, because that gap is *watched* and a batch's is not. The first ad of a batch
starts immediately, subject to whatever deadline a prior relist already wrote.

**Stopping.** A `RATE_LIMITED` refusal carries `retryAfter` and is temporary, so the batch sleeps it out and
resumes; `QUOTA_EXCEEDED`, `SUBSCRIPTION_INACTIVE` and an unreachable backend stop the run and say why —
those resolve in days, or need a card, or need a person. A `failed-recoverable` **stops the run at once**:
one of the user's ads is deleted and not back, and nothing may start a second delete over an unresolved one.
A `failed-before-delete` removed nothing and refunded its unit, so it skips that ad — but two consecutive
stop the run, because two in a row is a logged-out session or a moved endpoint rather than one odd ad.

**A batch does not survive a browser restart.** Alarms persist across sessions, so this is a deliberate stop
rather than an absence: the unstarted ads are dropped and the popup says so. Restoring an ad that is
*already* deleted still runs on startup — that is ADR-0003 recovery and is not initiation.

**Surface.** Checkboxes on every row, an action bar once one is ticked, and on free the boxes are drawn
**disabled** beside one line pointing at Plans — a locked control next to the user's own ads is the
conversion surface ADR-0007 asks for. Progress reaches a closed popup through the toolbar badge, which needs
no permission.

## Consequences
- **Positive: the pacing rail stops being the thing users discover.** A batch waits out a cooldown instead of
  presenting it as a failure, which is what T46 set out to do for a single repost and could not do for a run.
- **Positive: the `alarms` mechanism closes a gap that predates it.** `resumeAll()` runs only on
  `chrome.runtime.onStartup` / `onInstalled` today, so a worker evicted mid-relist leaves a deleted ad
  unrestored until the browser restarts. A wake-up that already exists for the queue is the place to fix it.
- **Negative, and load-bearing: a Power batch of 25 is a ~2 hour unattended run** across two burst waits, and
  any Chrome restart inside it drops what is left. Pro's 10 is sized to fit one burst window exactly, so the
  tier most people are on never sleeps mid-run; Power's number buys a headline at the cost of a run that
  frequently will not finish in one sitting. Chosen with that visible.
- **Negative: `upTo` is unenforceable server-side by construction**, per the split above. Someone determined
  can send `batch: true` for more ads than their tier's number. They still spend a unit each and still meet
  the rail, so what they gain is convenience, which is what the flag sells.
- **Negative: a second pacing window is a second number that must stay above `minimum-interval`**, and
  neither side can read the other's. The existing arrangement holds — both suites assert their own half —
  and this doubles what has to be kept in step.
- **Negative: `alarms` is a new permission and a new Web Store justification line** (T58,
  [#89](https://github.com/Shei254/marketplaats-extension/issues/89)). It is a cheap one to justify —
  "resume a repost queue after the browser suspends the extension" — but the listing is a review, not a
  deploy.
- **Consequence for the seed and its guard:** `andNoTierPromisesAFeatureThatDoesNotExist` was written to fail
  if a tier advertises a feature nothing implements. It now has one to permit, and the test's *reason* has to
  survive the edit — it must go on refusing `scheduling`, which is still named and still unbuilt.
- **The free tier sees a control it cannot use**, deliberately. That is the ADR-0007 conversion argument
  applied one surface further in, and it is the difference between a feature a free user knows to want and
  one they never learn exists.

## Revisit if
- **The burst rail is ever raised.** Every number here is drawn against 10 an hour: Pro's `upTo`, the ~2 hour
  Power run, the estimate the action bar prints. Move the rail and all three want re-deriving — and the
  ADR-0008 argument above has to be met first.
- **A batch needs to outlive a browser restart.** The stop is a safety judgement about delete-first firing at
  ads nobody is thinking about, not a technical limit; alarms already persist. What would change it is
  evidence that restarts are killing runs people expected to complete.
- **`scheduling` is built.** It is the other flag in the same column, it wants the same queue and the same
  alarms, and the second consumer is what would tell us whether this queue is a bulk queue or a relist queue
  with one caller.
- **In-page injection lands** (T41/T42). Those buttons are a second surface onto the same orchestrator, and a
  batch started from a Marktplaats page rather than the popup is the case that would test whether the queue
  is really the worker's.
