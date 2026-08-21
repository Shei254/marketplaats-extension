import org.springframework.boot.gradle.plugin.SpringBootPlugin

plugins {
    java
    id("org.springframework.boot") version "4.1.0"
}

group = "com.mprelist"
version = "0.0.1-SNAPSHOT"

java {
    // ADR-0012 says Java 21. Stating it as a toolchain rather than as source/target compatibility
    // means the compiler *is* 21 on every machine — a newer local JDK cannot quietly compile against
    // its own API and leave the mismatch to be discovered in the container.
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

// The module structure the boundary guard is pointed at: two modules, one reaching into the other's
// internal package. It cannot live in src/test/java — Spring Modulith skips test output when it scans,
// so a fixture there would be invisible and ModuleBoundaryTest would pass by finding nothing. It also
// cannot live under com.mprelist, or the real verification would scan it and fail on it.
val boundaryFixture = sourceSets.create("boundaryFixture")

dependencies {
    // Gradle's own BOM support rather than the io.spring.dependency-management plugin: one less plugin,
    // and the Spring Boot version stays stated once, in the plugins block above. Boot's BOM does not manage
    // Spring Modulith, so that one version is pinned here — the only version in this file.
    implementation(platform(SpringBootPlugin.BOM_COORDINATES))
    implementation(platform("org.springframework.modulith:spring-modulith-bom:2.1.0"))

    implementation("org.springframework.boot:spring-boot-starter-web")

    // Spring Security as an OAuth2 resource server: the Keycloak-issued access token is the only way in
    // (ADR-0005). The starter without `security-` in its name is the same set of jars and is deprecated in
    // Boot 4 — its own POM says so — so a build that took it would have to be moved again on the release
    // that drops it.
    //
    // No `spring-boot-starter-security-oauth2-client` beside it: this application never obtains a token,
    // it only ever validates one somebody else obtained. The client half is the extension's (#32) and the
    // dashboard's (#42), both of which run in a browser.
    implementation("org.springframework.boot:spring-boot-starter-security-oauth2-resource-server")
    // Only the @ApplicationModule annotation the package-info files carry. The analyzer that reads it
    // (spring-modulith-core) is a test dependency: nothing verifies boundaries at runtime.
    implementation("org.springframework.modulith:spring-modulith-api")

    // Flyway, its Boot auto-configuration, and through it a DataSource and JdbcTemplate. Boot 4 splits
    // auto-configuration into per-technology modules, so flyway-core alone would put Flyway on the
    // classpath and nothing would run it — this starter is what makes `migrate` happen on startup. Not
    // spring-boot-starter-data-jpa: no module maps an entity yet, and Hibernate arriving before the first
    // one would bring `ddl-auto` with it, a second schema author beside these migrations.
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    // Flyway 10 moved per-database support out of the core jar; without this one Postgres is simply an
    // unsupported database at runtime.
    runtimeOnly("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")

    // Stripe, for one thing today: verifying that a webhook really came from Stripe (#82, T51). Signature
    // verification is HMAC over the raw body with a timestamp tolerance and a constant-time compare, and a
    // hand-rolled one is a security-sensitive reimplementation of a published algorithm — this library is
    // Stripe's own account of it. The event itself is read with Jackson rather than deserialised into this
    // library's model, so the API version Stripe stamps an event with cannot decide whether we can read it.
    //
    // It arrives now and stays: #29 opens a Checkout session with it, #30 mirrors subscriptions from it, #31
    // hands out a Customer Portal link and #80 reads the amounts. Boot's BOM does not manage it, so this is
    // the second version pinned by hand in this file.
    implementation("com.stripe:stripe-java:29.2.0")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.modulith:spring-modulith-core")
    // Postgres for the tests, started by them. The schema uses partial indexes, jsonb and expression
    // checks, so an in-memory stand-in would either reject the migration or accept rows Postgres will
    // not — and this suite exists precisely to hold those constraints.
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    // GenericContainer, for the Keycloak the realm test imports into. There is no Keycloak module in
    // Testcontainers' own repository — the community one is a third dependency to pin for a container
    // that needs a command, an env var and a file, all of which GenericContainer already takes. Declared
    // rather than left transitive through -postgresql: this suite uses it directly.
    testImplementation("org.testcontainers:testcontainers")
    // Awaitility, for the one test that arranges a race rather than running one: it waits until Postgres
    // reports a backend blocked on a lock before committing the row that backend is blocked on. Declared
    // for the same reason as the line above — FirstLoginProvisioningTest imports `Awaitility.await`
    // directly, and it arrives only transitively through -starter-test today. Boot's BOM manages the
    // version, so there is none to state here.
    testImplementation("org.awaitility:awaitility")
    testImplementation(boundaryFixture.output)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()

    // Two files outside this project are read at test time, not compiled in: the compose file that names
    // the container images, and the realm KeycloakRealmTest imports. Gradle cannot see that on its own, so
    // without this an edit to either leaves `test` UP-TO-DATE and the previous run's verdict standing —
    // a green suite that never looked at the change. Found by editing the realm and being told it passed.
    //
    // The same two paths are spelled in InfraFiles.java, which finds them by walking up from the working
    // directory instead — Gradle cannot read Java constants and this must resolve at configuration time.
    // Keep the two in step: this list going stale is silent, and costs a green suite that read nothing.
    val repository = rootProject.layout.projectDirectory.dir("../..")
    inputs.files(
        repository.file("infra/docker-compose.yml"),
        repository.file("infra/keycloak/mprelist-realm.json"),
        // The extension's pinned key, which CrossOriginTest derives the allowed origin from.
        repository.file("apps/extension/public/manifest.template.json"),
    ).withPropertyName("workingTreeFilesReadAtTestTime").withPathSensitivity(PathSensitivity.RELATIVE)
}
