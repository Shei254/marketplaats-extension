package com.mprelist;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * The one deployable this workspace builds (ADR-0011), and the package root Spring Modulith derives the
 * module structure from: every direct sub-package of {@code com.mprelist} is an application module.
 *
 * <p>{@code @EnableScheduling} for #24's reconciliation, which is the first thing here that runs without
 * anybody calling it. Declared on the application rather than inside the module that wants it: a scheduler is
 * an application-wide capability, and a module switching one on for every other module from inside its own
 * {@code internal} package is a dependency nothing declares and the boundary check cannot see.
 */
@SpringBootApplication
@EnableScheduling
public class ApiApplication {

	public static void main(String[] args) {
		SpringApplication.run(ApiApplication.class, args);
	}
}
