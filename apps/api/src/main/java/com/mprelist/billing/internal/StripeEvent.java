package com.mprelist.billing.internal;

import java.util.Optional;

import com.mprelist.catalog.TaggedPrice;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * An event, read as far as this application needs it and no further (#82, T51).
 *
 * <p><strong>Read with Jackson rather than deserialised into Stripe's own model.</strong> The library will
 * turn an event into a typed {@code Price} — but only when the API version the event was created under
 * matches the version that library was built against, and returns nothing at all when it does not. That is a
 * silent no-op on a webhook: the endpoint answers 200, the catalog is not updated, and the only symptom is
 * that a plan never appears. Reading four fields out of the tree cannot fail that way, and the four are
 * exactly the ones ADR-0019 names.
 *
 * <p>What it is <em>not</em> is a general event type. There is no id here, no created timestamp, no
 * livemode flag: #30 (T20) needs all three, because mirroring a subscription's status is order-dependent and
 * has to be idempotent on the event id, and this one is neither — an upsert on a tier code says the same
 * thing however many times it arrives and in whatever order.
 */
record StripeEvent(String type, JsonNode object) {

	/**
	 * @param payload the verified body. Verified first, always: this is where a stranger's JSON would become
	 * a tier if the order were the other way round
	 * @throws tools.jackson.core.JacksonException if the body is not JSON at all, which the route answers as
	 * the {@code 400} an unreadable request gets everywhere else in this application
	 */
	static StripeEvent in(String payload) {
		JsonNode event = JSON.readTree(payload);
		return new StripeEvent(event.path("type").asString(""), event.path("data").path("object"));
	}

	/**
	 * The two ADR-0019 syncs. Nothing else is an error — Stripe sends whatever the endpoint is subscribed to,
	 * and an endpoint subscribed to more than it handles is the ordinary case rather than a misconfiguration.
	 */
	boolean isAboutAPrice() {
		return PRICE_CREATED.equals(this.type) || PRICE_UPDATED.equals(this.type);
	}

	/**
	 * The Price as the catalog takes it, or nothing where this one carries no {@code metadata.tier_code}.
	 *
	 * <p>Empty is the answer for an untagged Price and it is a deliberate one: Stripe Prices get created for
	 * one-offs, coupons and experiments, and a sync that adopted all of them would turn a billing experiment
	 * into a tier (ADR-0019). The cost is that a tag somebody forgot is silent — which is why T53's admin
	 * screen has to list the Prices nothing adopted.
	 *
	 * <p>{@code nickname} is Stripe's own optional label for a Price and is what names a tier this catalog has
	 * never heard of. It is usually unset, so it travels as a suggestion: {@link TaggedPrice} says what happens
	 * to one that is absent, and the answer is that a tier keeps the name it already had.
	 */
	Optional<TaggedPrice> taggedPrice() {
		String code = text(this.object.path("metadata").path(TIER_CODE));
		String id = text(this.object.path("id"));
		if (code == null || id == null) {
			return Optional.empty();
		}
		return Optional.of(new TaggedPrice(code, id, text(this.object.path("nickname"))));
	}

	/** A field that is absent, null, or present and empty are one case here: nothing was said. */
	private static String text(JsonNode field) {
		String value = field.asString("").strip();
		return value.isEmpty() ? null : value;
	}

	/** This module's own mapper, for {@code TierRows}' reason: what goes out over HTTP is configured elsewhere. */
	private static final JsonMapper JSON = JsonMapper.builder().build();

	/** The tag ADR-0019 makes the link, spelled as the Stripe dashboard spells it. */
	private static final String TIER_CODE = "tier_code";

	private static final String PRICE_CREATED = "price.created";

	private static final String PRICE_UPDATED = "price.updated";

}
