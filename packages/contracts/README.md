# `packages/contracts` — shared API types

Empty on purpose. ADR-0011 reserves this for the API contract types consumed by **both** clients, the
extension and the dashboard, so a contract change lands atomically in one commit.

No ticket owns its creation. The first consumers are
[#34 (T25 · authorization gate)](https://github.com/Shei254/marketplaats-extension/issues/34) and
[#36 (T27 · client config)](https://github.com/Shei254/marketplaats-extension/issues/36); whichever lands
first should create the package rather than inline the types.

The wire shapes it has to encode are already specified in
[`docs/enforcement-contract.md`](../../docs/enforcement-contract.md) — that document, not this package, is
the source of truth.

Note the standing constraint from ADR-0011: shared source is **not** lockstep releases. The API stays
backward-compatible with older installed extension versions, so a change here that removes or renames a
field is a versioning decision ([#52, T43](https://github.com/Shei254/marketplaats-extension/issues/52)),
not a refactor.
