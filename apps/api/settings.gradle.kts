plugins {
    // Resolves the Java 21 toolchain from a download when the machine has no JDK 21 installed.
    // Without it, `./gradlew test` fails on every machine whose JDK happens not to be 21, which
    // is most of them — see the toolchain block in build.gradle.kts.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "api"
