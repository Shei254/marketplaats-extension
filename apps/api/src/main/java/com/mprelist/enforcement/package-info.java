/**
 * The gate: {@code POST /api/relist/authorize} and {@code POST /api/relist/complete}, per
 * {@code docs/enforcement-contract.md}. Planned as {@code domain} — the decision logic, pure, no Spring —
 * over {@code internal/jpa} (ADR-0012).
 *
 * <p>Empty until #22 (T13) and #23 (T14).
 */
@ApplicationModule
package com.mprelist.enforcement;

import org.springframework.modulith.ApplicationModule;
