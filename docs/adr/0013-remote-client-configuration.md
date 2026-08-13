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
- **Supersedes:** the POC Options page (`src/options/*`), which is deleted.
