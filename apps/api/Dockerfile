# syntax=docker/dockerfile:1
#
# The API as one image, built from this directory alone (T55, #86).
#
# The build context is `apps/api` and nothing above it, which is a decision rather than an economy: this
# application's Gradle build reads the repository's `.env` and its *tests* read four files from the working
# tree — the compose file, the realm, the extension manifest and `.env.example`. None of that may reach a
# deployed image. `bootJar` needs none of it either, and the build below is `bootJar` and not `build`:
# the suite runs in CI (`.github/workflows/ci.yml`) and on a laptop, where Docker and Testcontainers are,
# and re-running it here would need a Docker daemon inside the build.
#
# See infra/docker-compose.prod.yml for how it is run, and docs/adr/0020-deployment.md for why it is a
# container at all.

FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /build

COPY gradlew ./
COPY gradle gradle
COPY settings.gradle.kts build.gradle.kts ./
COPY src src

# One step, with the Gradle home as a cache mount rather than an image layer: Gradle's own distribution and
# every dependency land there and are reused by the next build, and none of them belong in the result.
#
# Warming that up in an earlier `RUN` — the obvious way to keep a source edit from re-resolving anything — is
# what this deliberately does not do: the mount below *hides* whatever an earlier layer wrote to the same
# path, so the warm-up would be a download every build pays for and then throws away.
#
# `--no-daemon` because the daemon would outlive nothing here: one build, one JVM.
RUN --mount=type=cache,target=/root/.gradle \
    chmod +x gradlew && ./gradlew --no-daemon bootJar

# The JDK above compiles; a JRE runs. ADR-0012 says Java 21 and `build.gradle.kts` says it as a toolchain,
# so the two lines that name a version here are held to it by the compiler rather than by care.
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Not root. Nothing here writes to the filesystem — Flyway writes to Postgres and every snapshot lives in
# the user's own browser (ADR-0001) — so the process needs no directory of its own.
RUN addgroup -S mprelist && adduser -S -G mprelist mprelist
USER mprelist

COPY --from=build /build/build/libs/*.jar app.jar

# `server.port` in application.yml, pinned there for the same reason it is repeated here: infra's Keycloak
# was moved to 8081 to keep 8080 free for this, and that pairing should not rest on a default staying put.
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
