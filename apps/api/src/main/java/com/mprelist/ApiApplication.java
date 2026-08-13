package com.mprelist;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * The one deployable this workspace builds (ADR-0011), and the package root Spring Modulith derives the
 * module structure from: every direct sub-package of {@code com.mprelist} is an application module.
 */
@SpringBootApplication
public class ApiApplication {

	public static void main(String[] args) {
		SpringApplication.run(ApiApplication.class, args);
	}
}
