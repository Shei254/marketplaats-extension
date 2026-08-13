# `infra` — local stack

Empty on purpose. ADR-0011 reserves this for the local development stack; `docker-compose.yml` (Postgres +
Keycloak) arrives with
[#14 (T05)](https://github.com/Shei254/marketplaats-extension/issues/14), and the version-controlled
Keycloak realm export with [#15 (T06)](https://github.com/Shei254/marketplaats-extension/issues/15).

The realm is exported here as config, not hand-clicked into a running container — that is an acceptance
criterion of #15, and this directory is where the export belongs.
