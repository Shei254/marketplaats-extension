# ADR-0013: Remote client configuration for the internal-API layer

**Status:** Accepted (2026-08-13)
**Scope:** Extension + API.

## Context
ADR-0004 warns that Marktplaats's internal endpoints are "private and unversioned → can change without
notice". During the POC this was survivable because an Options page let a tester paste new endpoint values at
runtime. That page is being removed — it was spike scaffolding, and the endpoints are now discovered.

Removing it without replacement would mean every Marktplaats-side change requires a new extension build
through **Chrome Web Store review — days** — during which the product is dead for every user. The `createAd`
payload in particular is a hand-tuned form body whose field order is load-bearing.

## Decision
Endpoints, CSRF extraction rules, and (later) DOM anchors ship as **hardcoded defaults** in the extension,
and are **overridden by a config document fetched from our API** and cached in the service worker. A
Marktplaats-side change is fixed by deploying a config row: minutes, not days.

**Hard constraint:** this document is strictly **data** — paths, header names, DOM selectors, regex patterns.
Nothing the extension `eval`s or executes may ever be delivered this way; that would breach MV3's ban on
remotely hosted code.

## Consequences
- **Positive:** Turns the single largest operational risk in the product (ADR-0004's "can change without
  notice") from a multi-day outage into a config deploy. Pairs directly with the `/complete` outcome
  telemetry (ADR-0007), which is what tells you a fix is needed.
- **Adds no new failure mode:** the relist path is already fail-closed on backend unreachability (ADR-0007),
  so an outage blocks relists whether or not config is remote. Hardcoded defaults still cover the
  extension's non-relist behaviour.
- **Negative:** A bad config deploy can break the Marktplaats layer for all users at once — the same blast
  radius that makes it valuable. Config needs a schema version and should be treated as a production change.
- **Supersedes:** the POC Options page (`apps/extension/src/options/*`), deleted in #12. The
  `__setEndpoints` console hook it duplicated survives in dev builds only — and outlives this ADR's endpoint
  too, for the reason the amendment below gives.

---

## Amended 2026-08-23 (T27, #36) — built, and smaller than it was described

The endpoint exists. Three things about it were decided in the building and are not what a reader of the
decision above would assume.

**It carries no configuration.** The decision says endpoints "are **overridden by** a config document", which
reads as a document that holds them. It does not: what is served is a **patch**, every field optional, and
`{"schemaVersion":1}` is what a healthy deployment answers — meaning *your defaults are correct*. The nine
paths, the CSRF rules and the pacing window live in the extension and nowhere else. The alternative, an API
holding its own copy, buys one thing (a document you can read to see what clients will do) and costs the
failure this whole ADR is written against: a second copy of nine private paths, which goes stale on its own
schedule and is then served, confidently, to every installed build at once.

**"Strictly data" is now a list rather than a promise.** The hard constraint above says "paths, header names,
DOM selectors, regex patterns" — and the regex is the one that had to go. The CSRF `mode` is an enum at both
ends (`meta`, `cookie`, `fetch`, `none`), so a document naming a fifth branch fails to parse and the
deployment does not start; and the `fetch` extractor is a **selector and an attribute**, never a pattern, so
nothing served is compiled and every served value is only ever compared against something. There is no shape
in this document that reaches an evaluator, which is a stronger statement than "we will not send one".

**A tester's local override outranks the served document**, which is the resolution order #36 left open.
Overrides exist only in a `build:dev` bundle and are typed by hand by somebody working a path out against the
live site; a document arriving remotely, minutes later, mid-session, would undo the one thing they are holding
still. That is why `__setEndpoints` outlives this endpoint rather than being superseded by it. Every real user
is on the layer below, because none of them can write the one above.

**And the negative consequence above got a floor.** "A bad config deploy can break the Marktplaats layer for
all users at once" is still true of a *valid* document with a wrong path in it — nothing can check whether
`/seller/api/delete-ad-v2` is a path Marktplaats serves. What is no longer possible is the accidental half of
it: a malformed or misspelt document stops the API from starting rather than deploying quietly as an empty
one, because the operator writing it is mid-outage and this is the only moment anybody can tell them. And a
document a *client* cannot read is ignored whole — never half-applied — so an older build meets a newer
document by falling back to what it shipped with.
