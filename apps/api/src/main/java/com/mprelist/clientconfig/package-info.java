/**
 * The client's own configuration: {@code GET /api/client-config}, the document that tells the extension to
 * do something other than what it was built to do (ADR-0013, {@code docs/enforcement-contract.md}).
 *
 * <p><strong>Eighth module, and it depends on nothing.</strong> Every other module here is about a user —
 * who they are, what they bought, what they may spend. This one is about a *build*: Marktplaats moved a path,
 * and every installed extension has to be told before any of them can relist again. It shares no concept with
 * the other seven, so putting it in one of them would misname that module rather than save a package.
 *
 * <p><strong>What it serves is a patch, and it is the whole reason this module holds no knowledge.</strong>
 * The nine internal-API paths, the CSRF rules and the pacing window are the extension's, built in and shipped
 * with it. This module never names one. It carries what an operator has had to *override* — usually nothing —
 * so there is no second copy of anything to go stale, and an empty document is the ordinary answer rather
 * than a failure.
 *
 * <p><strong>Its public API is the route and nothing else.</strong> No other module asks it anything and it
 * asks nothing of anyone: the document comes from configuration, is parsed once at startup, and is served.
 *
 * <p>ADR-0012 keeps the canonical tree of every module's public surface; this one is a leaf with an empty
 * surface, which is the smallest thing that tree has ever had to hold.
 */
@ApplicationModule
package com.mprelist.clientconfig;

import org.springframework.modulith.ApplicationModule;
