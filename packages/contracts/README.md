# `packages/contracts` — shared API types

Empty on purpose. ADR-0011 reserves this for the API contract types consumed by **both** clients, the
extension and the dashboard, so a contract change lands atomically in one commit.

No ticket owns its creation. **T25 (the authorization gate,
[#34](https://github.com/Shei254/marketplaats-extension/issues/34)) creates it** — it is the first ticket in
iteration 1 that needs the wire types, and T27 is deferred, so the race the earlier wording anticipated no
longer exists. See [`../../docs/backlog.md`](../../docs/backlog.md), slice B.

The wire shapes it has to encode are already specified in
[`docs/enforcement-contract.md`](../../docs/enforcement-contract.md) — that document, not this package, is
the source of truth.

Note the standing constraint from ADR-0011: shared source is **not** lockstep releases. The API stays
backward-compatible with older installed extension versions, so a change here that removes or renames a
field is a versioning decision ([#52, T43](https://github.com/Shei254/marketplaats-extension/issues/52)),
not a refactor.
