package com.mprelist.identity.internal;

import java.time.Duration;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Which browser origins may call this API, and with what.
 *
 * <p><strong>Every client of this API is cross-origin and always will be.</strong> The extension calls from
 * {@code chrome-extension://<id>} and {@code apps/web}'s admin corner from its own host, so without this a
 * browser refuses the answer before any of our code sees a problem — the symptom being a console line about a
 * missing {@code Access-Control-Allow-Origin} and a screen that shows "unavailable" for a backend that
 * answered perfectly well.
 *
 * <p><strong>Both halves of this configuration have now been got wrong once, the same way.</strong> T54 (#85)
 * shipped an admin UI without adding its origin here, and T53 (#84) shipped {@code PUT} routes without adding
 * the method — and neither is visible from this side, because a browser refuses before the request is sent
 * and this application logs nothing at all. That is why the origins are named at startup below, and why
 * {@code CrossOriginTest} holds this list against {@code mprelist.web.base-url} and against the realm's own
 * {@code webOrigins} rather than against a literal written twice.
 *
 * <p><strong>Why not the extension's own host permission instead.</strong> An MV3 worker with the API's host
 * in {@code host_permissions} is exempt from CORS entirely, which would have needed no change here. It was
 * rejected for two reasons: host permissions are static in the manifest, so a deployed API and a local one
 * would both have to be listed in what ships to the Web Store — {@code http://localhost:8080/*} included,
 * where a reviewer reads it (T58) — and {@code apps/web} has no such escape hatch, so this configuration is
 * needed for the admin UI (T54) whatever the extension does. One mechanism for both clients, in the place
 * that already decides who gets in.
 *
 * <p><strong>It is not a security boundary and is not written as one.</strong> CORS decides which page's
 * script may read an answer; the token decides who is answered at all, and every route stays closed behind
 * one. What this prevents is a mistake — a site the user is visiting reading their plan out of our API in the
 * background — and what it must not become is a substitute for the resource server above it.
 *
 * <p>The origins are configured rather than defaulted in code, like the rails and the reconciliation window,
 * and there is deliberately no fallback: an API that quietly allowed nobody is exactly the failure this
 * exists to fix, and one that quietly allowed anybody is worse.
 */
@Configuration(proxyBeanMethods = false)
class CrossOriginCallers {

	private static final Logger LOG = LoggerFactory.getLogger(CrossOriginCallers.class);

	/**
	 * @param origins comma-separated and matched exactly — no patterns and no {@code *}. The extension's is
	 * {@code chrome-extension://} plus the id T44 pinned, which {@code application.yml} substitutes from the
	 * environment exactly as the realm file does, so that neither holds a literal copy that can go stale
	 */
	/**
	 * Declared as the concrete {@link UrlBasedCorsConfigurationSource} rather than the interface, so the chain
	 * can ask for it by type. Spring MVC publishes a {@code CorsConfigurationSource} of its own — the handler
	 * mapping introspector — and asking for the interface finds both.
	 */
	@Bean
	UrlBasedCorsConfigurationSource browsersThatMayCallThisApi(
			@Value("${mprelist.cors.allowed-origins}") List<String> origins) {
		CorsConfiguration allowed = new CorsConfiguration();
		allowed.setAllowedOrigins(origins);
		// The three this API answers. `PUT` arrived with the admin catalog (T53, #84) and is exactly as
		// load-bearing as the other two: a method a preflight does not allow makes the browser abandon the
		// call, so an operator's every save would fail with nothing in this application's log to show for it.
		// There is no `DELETE`, because nothing here deletes — a tier is retired by unpublishing it.
		//
		// `OPTIONS` is not among them and does not need to be: a preflight is answered by the filter this
		// configures rather than routed, and what it is checked against is the method the caller says it is
		// preparing to send.
		allowed.setAllowedMethods(List.of("GET", "POST", "PUT"));
		// `Authorization` is never a safelisted header and `Content-Type: application/json` is not one
		// either, so every call this API takes is preflighted and both have to be named here.
		//
		// `X-Mprelist-Client` is the third, and it is the one that fails most confusingly if forgotten (T43,
		// #52): a header a preflight does not allow is not stripped, it makes the *whole call* fail before it
		// is sent, so leaving it out would break every request in order to carry a diagnostic.
		allowed.setAllowedHeaders(
				List.of("Authorization", "Content-Type", "Accept", RefuseOutdatedClients.CLIENT_HEADER));
		// **No credentials.** Nothing here is authenticated by a cookie — the token is the whole of the
		// caller's identity and it arrives in a header the caller's own code sets. Saying so keeps the grant
		// as narrow as it can be, and keeps this from being the line that would let a third-party page make
		// authenticated calls with a session it did not have to obtain.
		allowed.setAllowCredentials(false);
		// How long a browser may skip the preflight. Half an hour of a popup opening and closing costs one
		// round trip rather than one per call, and the origins it caches are ours to change with a restart.
		allowed.setMaxAge(Duration.ofMinutes(30));

		// Said out loud at startup, because the failure it causes is reported by a *browser* and names this
		// application nowhere: a console line about a missing header, and a popup showing "unavailable" for
		// an API that answered. The commonest cause is the extension id not being in this process's
		// environment, so the log names the origins it will actually accept.
		LOG.info("Browser origins allowed to call this API: {}", origins);

		UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
		source.registerCorsConfiguration("/**", allowed);
		return source;
	}

}
