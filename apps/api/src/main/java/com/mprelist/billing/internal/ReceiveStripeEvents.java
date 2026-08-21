package com.mprelist.billing.internal;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.mprelist.catalog.Adoption;
import com.mprelist.catalog.PriceAdoptions;
import com.mprelist.catalog.TaggedPrice;

import tools.jackson.core.JacksonException;

/**
 * {@code POST /api/stripe/webhook} — where a Price created in the Stripe dashboard becomes a tier in our
 * catalog (#82, T51, ADR-0019).
 *
 * <p><strong>What answers what.</strong> A {@code 400} means we could not tell that this was Stripe, or could
 * not read what it sent; Stripe shows those on the endpoint's own page and retries. A {@code 200} means the
 * event was handled <em>or deliberately ignored</em>, and the second is the common case — an endpoint hears
 * about everything it is subscribed to, and this ticket handles two event types. Answering non-2xx to the
 * rest would put this endpoint permanently in a retry loop over events it will never do anything with, which
 * is the state that hides a real failure.
 *
 * <p><strong>An operator's mistake is a log line, not a retry.</strong> A Price with no {@code tier_code}, or
 * one re-tagged onto a tier that would have to steal another's Price, is answered {@code 200} and said out
 * loud here: retrying cannot fix a tag, and three days of Stripe redelivering it would only bury the events
 * that are worth attention. Absence is the failure mode ADR-0019 names as the price of the metadata tag, and
 * these lines plus T53's unadopted-Price list are the whole of what makes it visible.
 */
@RestController
class ReceiveStripeEvents {

	ReceiveStripeEvents(SignedByStripe stripe, PriceAdoptions catalog) {
		this.stripe = stripe;
		this.catalog = catalog;
	}

	/**
	 * @param payload the raw body, taken as a {@link String} and handed to the signature check before anything
	 * parses it. A body bound to a type would be a body re-serialised to verify, and a signature is over bytes
	 * @param signature Stripe's, or absent — which is refused in the same shape as a wrong one, since a caller
	 * who did not sign is one we cannot identify
	 */
	@PostMapping(PATH)
	ResponseEntity<Void> anEventArrived(@RequestBody String payload,
			@RequestHeader(name = SIGNATURE_HEADER, required = false) String signature) {
		if (!this.stripe.signed(payload, signature)) {
			return ResponseEntity.badRequest().build();
		}
		StripeEvent event;
		try {
			event = StripeEvent.in(payload);
		}
		catch (JacksonException unreadable) {
			// Signed by Stripe and not JSON is a pairing that should not happen, so it is worth a line of its
			// own: the alternative reading is that our secret is shared with something that is not Stripe.
			LOG.warn("An event carrying Stripe's signature was not readable as JSON: {}", unreadable.getMessage());
			return ResponseEntity.badRequest().build();
		}
		if (event.isAboutAPrice()) {
			event.taggedPrice().ifPresentOrElse(this::adopt, () -> LOG.info(
					"A Price with no `metadata.tier_code` is not a plan, so nothing was adopted ({}). If it "
							+ "was meant to be one, tag it in the Stripe dashboard and save it again.",
					event.type()));
		}
		return ResponseEntity.ok().build();
	}

	private void adopt(TaggedPrice price) {
		Adoption adopted = this.catalog.adopt(price);
		switch (adopted) {
			case FILLED_IN_A_TIER -> LOG.info("Tier `{}` now sells Stripe Price {}. Its quota is untouched.",
					price.tierCode(), price.stripePriceId());
			// Warned rather than merely noted: a draft is a plan nobody can buy, and the thing that makes it
			// buyable is a person setting a quota (T53). Nothing else will produce a second reminder.
			case DRAFTED_A_TIER -> LOG.warn("Stripe Price {} is tagged `{}`, which no tier carried, so a draft "
					+ "was created at quota 0 and unpublished. It sells nothing until somebody says what it "
					+ "grants.", price.stripePriceId(), price.tierCode());
			// An error, because the Price the operator just re-tagged is now in neither tier's story: the one
			// they tagged did not take it, and the one holding it does not know they meant to move it.
			case LEFT_TO_THE_TIER_THAT_HOLDS_IT -> LOG.error("Stripe Price {} is tagged `{}` but is already held "
					+ "by another tier, and a Price belongs to one tier only. Nothing was changed. Point that "
					+ "tier at a different Price first, or create a new Price for `{}`.", price.stripePriceId(),
					price.tierCode(), price.tierCode());
		}
	}

	private final SignedByStripe stripe;

	private final PriceAdoptions catalog;

	private static final Logger LOG = LoggerFactory.getLogger(ReceiveStripeEvents.class);

	/**
	 * Spelled here and, separately, in the filter chain that opens it — {@code identity} holds no constant of
	 * this module's, and this module contributes no rule to that chain (see the package documentation). The
	 * two copies are held to each other by {@code StripePriceSyncTest}, which posts to this path with no token
	 * at all: if the chain ever stops opening exactly this one, every test in that suite is refused with 401.
	 */
	private static final String PATH = "/api/stripe/webhook";

	/** Stripe's own header name. */
	private static final String SIGNATURE_HEADER = "Stripe-Signature";

}
