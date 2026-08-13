# `apps/api` — Spring Boot API

Empty on purpose. This directory is the home ADR-0011 reserves for the backend; the code arrives with
[#16 (T07 · Spring Boot skeleton with enforced module boundaries)](https://github.com/Shei254/marketplaats-extension/issues/16).

Planned by [ADR-0012](../../docs/adr/0012-backend-modular-monolith.md): Gradle, Java 21, package base
`com.mprelist`, modules `identity` / `catalog` / `subscription` / `enforcement` / `admin`, with a Spring
Modulith boundary test that fails the build on a cross-module `internal/` reach.

Gradle, not npm, and so deliberately **not** an npm workspace — the root scripts skip a directory with no
`package.json`, and CI will run `./gradlew` here separately. Both are covered in
[../../README.md](../../README.md#working-on-it).
