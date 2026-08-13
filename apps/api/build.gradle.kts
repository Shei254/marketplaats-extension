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
    // Only the @ApplicationModule annotation the package-info files carry. The analyzer that reads it
    // (spring-modulith-core) is a test dependency: nothing verifies boundaries at runtime.
    implementation("org.springframework.modulith:spring-modulith-api")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.modulith:spring-modulith-core")
    testImplementation(boundaryFixture.output)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
