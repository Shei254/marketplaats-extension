# `apps/api` — Spring Boot API

Empty on purpose. This directory is the home ADR-0011 reserves for the backend; the code arrives with
[#16 (T07 · Spring Boot skeleton with enforced module boundaries)](https://github.com/Shei254/marketplaats-extension/issues/16).

Planned by [ADR-0012](../../docs/adr/0012-backend-modular-monolith.md): Gradle, Java 21, package base
`com.mprelist`, modules `identity` / `catalog` / `subscription` / `enforcement` / `admin`, with a Spring
Modulith boundary test that fails the build on a cross-module `internal/` reach.

Gradle, not npm, and so deliberately **not** an npm workspace — the root scripts skip a directory with no
`package.json` ([root README](../../README.md#working-on-it)). CI will run `./gradlew` here separately; no CI
config exists in this repo yet. That mixed toolchain is the cost ADR-0011 accepted.
