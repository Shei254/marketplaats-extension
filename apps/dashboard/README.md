# `apps/dashboard` — React SPA

Empty on purpose. This directory is the home ADR-0011 reserves for the customer dashboard; the code arrives
with [#42 (T33 · React SPA shell + Keycloak login)](https://github.com/Shei254/marketplaats-extension/issues/42).

It will consume `packages/ui` (so the dashboard and the popup share one look) and `packages/contracts` (so
the API contract is typed once for both clients). Plans, account and billing pages follow in #43, #44, #45.

When it gains a `package.json` it becomes an npm workspace automatically ([root
README](../../README.md#working-on-it)).
