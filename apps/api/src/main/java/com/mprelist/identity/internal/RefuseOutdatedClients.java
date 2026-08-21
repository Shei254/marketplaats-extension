package com.mprelist.identity.internal;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The backward-compatibility lever (T43, #52, ADR-0011): the one thing this API can say to a client build
 * that must stop calling it.
 *
 * <p><strong>Why it exists before it is needed.</strong> An extension ships through a store review that takes
 * days and cannot be forced onto anybody; this API ships in minutes. So at any moment several builds are
 * calling one backend, and the API has exactly two ways to cope: keep every change additive, or be able to
 * turn a build away. The first is the policy and the second is the exception — and the exception has to be
 * *in the published build already*, because a lever added later cannot reach the releases that predate it.
 * That is the whole argument for building this before there are users rather than after.
 *
 * <p><strong>The policy is additive-by-default.</strong> New fields may appear in responses and new routes may
 * appear beside old ones; existing fields keep their meaning; a client that ignores what it does not
 * recognise keeps working — which is how {@code relistQuotaPerPeriod} arrived (#41) and how a denial reason a
 * client has never heard of is already handled ({@code docs/enforcement-contract.md}). Raising the minimum
 * strands every user who has not updated yet, so it is for correctness and safety only: a build that would
 * delete somebody's ad wrongly, or one holding a token it must not. Never for tidiness.
 *
 * <p><strong>426 with an empty body, and the status is what the client reads.</strong> That is the one
 * deliberate exception to "the code is the whole of what a client acts on": the contract's reason codes are
 * statements about the <em>user</em> — their quota, their card, their pace — and this is a statement about
 * their software. It carries no {@code reason} for the same rule that governs every other {@code 4xx} which
 * is not a denial. A client too old to know what 426 means falls into "unavailable, retry", which is the
 * right thing for a build we have just refused to serve: it stops.
 *
 * <p>An interceptor rather than a filter, so it runs <em>after</em> the security chain: a caller with no token
 * is answered {@code 401} first, and being signed out is not something updating fixes.
 */
@Configuration(proxyBeanMethods = false)
class RefuseOutdatedClients implements HandlerInterceptor, WebMvcConfigurer {

	/**
	 * @param minimumExtensionVersion the oldest extension build this API still serves. `0` means every one of
	 * them, which is the value it ships with and the only value that is not a decision — see the class
	 * documentation for what raising it costs. There is no line for {@code apps/web} because it does not call
	 * this API yet (T54, #85); the day it does, it gets one of its own rather than sharing this
	 */
	RefuseOutdatedClients(@Value("${mprelist.clients.minimum-extension-version}") String minimumExtensionVersion) {
		this.minimumExtensionVersion = minimumExtensionVersion;
		LOG.info("Oldest {} release this API serves: {}", EXTENSION, minimumExtensionVersion);
	}

	@Override
	public void addInterceptors(InterceptorRegistry registry) {
		// Every route the contract describes, and every route a later ticket adds under it. Not the Stripe
		// webhook, which is `/api/stripe/**` — Stripe is not a client of ours and sends no such header — but
		// it would be served anyway, since a request that names no release is never refused.
		registry.addInterceptor(this).addPathPatterns("/api/**");
	}

	@Override
	public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
		String header = request.getHeader(CLIENT_HEADER);
		return ClientRelease.in(header)
				.filter(release -> EXTENSION.equals(release.surface()))
				.filter(release -> release.olderThan(this.minimumExtensionVersion))
				.map(release -> refuse(release, response))
				.orElse(true);
	}

	/**
	 * @return {@code false}, always: the handler does not run. Said out loud in the log because this is the
	 * only place a stranded user is visible to us — they see an update prompt and go away, and nothing else
	 * about them reaches an operator
	 */
	private boolean refuse(ClientRelease release, HttpServletResponse response) {
		LOG.warn("Refused {} {}: older than the minimum {} this API serves", release.surface(), release.version(),
				this.minimumExtensionVersion);
		response.setStatus(HttpStatus.UPGRADE_REQUIRED.value());
		return false;
	}

	private final String minimumExtensionVersion;

	/**
	 * The surface this minimum is about, spelled as the extension spells it in the header it sends. Two copies
	 * of one word, held together by {@code ClientVersionTest} — which sends the header a client would.
	 */
	private static final String EXTENSION = "extension";

	/** The header, and the same string `CrossOriginCallers` has to allow or no browser will ever send it. */
	static final String CLIENT_HEADER = "X-Mprelist-Client";

	private static final Logger LOG = LoggerFactory.getLogger(RefuseOutdatedClients.class);

}
