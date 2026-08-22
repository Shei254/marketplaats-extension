package com.mprelist.billing.internal;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import com.mprelist.catalog.TaggedPrice;
import com.mprelist.subscription.QuotaPeriod;
import com.mprelist.subscription.SubscriberOnStripe;
import com.mprelist.subscription.SubscriptionStatus;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * An event, read as far as this application needs it and no further (#82, T51; #30, T20).
 *
 * <p><strong>Read with Jackson rather than deserialised into Stripe's own model.</strong> The library will
 * turn an event into a typed {@code Price} or {@code Subscription} — but only when the API version the event
 * was created under matches the version that library was built against, and returns nothing at all when it
 * does not. That is a silent no-op on a webhook: the endpoint answers 200, nothing is written, and the only
 * symptom is a plan that never appears or a payment that never unlocks anything. Reading the handful of
 * fields below cannot fail that way.
 *
 * <p>It is also what makes the <em>two</em> shapes of a billing period readable at once. Stripe moved
 * {@code current_period_start} and {@code current_period_end} off the subscription and onto each of its items
 * in the 2025 API versions — the pinned {@code stripe-java} has no accessor for the old place at all — so a
 * period is looked for on the item first and on the subscription second, and an account still pinned to an
 * older version keeps working. A typed model would simply have answered null for whichever half it was not
 * built for.
 *
 * @param id Stripe's {@code evt_…}. Not used to decide anything: what makes a redelivery harmless is that the
 * mirror applies the newest statement of the current state and ignores anything older (see
 * {@code SubscriptionMirror}), which needs the timestamp rather than the id. It is here because a log line
 * about an event nobody can find in the Stripe dashboard is a log line nobody can act on
 * @param type the event type, which is the whole of what decides who handles it
 * @param created the moment Stripe generated it — <em>their</em> clock, which is the order the events were
 * made in rather than the order they happened to arrive. Whole seconds, because that is what Stripe sends
 * @param object the {@code data.object}: the Price, the Subscription, or whatever else the endpoint is
 * subscribed to
 */
record StripeEvent(String id, String type, OffsetDateTime created, JsonNode object) {

	/**
	 * @param payload the verified body. Verified first, always: this is where a stranger's JSON would become
	 * a tier if the order were the other way round
	 * @throws tools.jackson.core.JacksonException if the body is not JSON at all, which the route answers as
	 * the {@code 400} an unreadable request gets everywhere else in this application
	 */
	static StripeEvent in(String payload) {
		JsonNode event = JSON.readTree(payload);
		return new StripeEvent(event.path("id").asString(""), event.path("type").asString(""),
				// Zero where the field is absent, which no event Stripe signs has ever been: an event stamped
				// at the epoch is applied to a row nothing has been mirrored onto and ignored on one where
				// something has, which is the safe way round for a timestamp we could not read.
				Instant.ofEpochSecond(event.path("created").asLong(0)).atOffset(ZoneOffset.UTC),
				event.path("data").path("object"));
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

	/**
	 * The three events a subscription's whole life is told in (#30, T20): it started, something about it
	 * changed, it is over.
	 *
	 * <p><strong>{@code checkout.session.completed} is deliberately not among them.</strong> It says a payment
	 * page was finished and carries our {@code client_reference_id}, but not the status, the Price or the
	 * period — and Stripe usually sends it <em>after</em> the subscription was created, so a mirror that waited
	 * for it would be a mirror that acts on the second event and needs the first. The three below carry
	 * everything, including our own tag, so each one is complete on its own and their order between themselves
	 * is the only order that has to be right.
	 *
	 * <p>Nor is {@code invoice.payment_failed}: a card that fails moves the subscription to {@code past_due},
	 * and Stripe reports that as an update here. Handling both would be two events racing to write one status.
	 */
	boolean isAboutASubscription() {
		return SUBSCRIPTION_CREATED.equals(this.type) || SUBSCRIPTION_UPDATED.equals(this.type)
				|| SUBSCRIPTION_DELETED.equals(this.type);
	}

	/**
	 * Which subscription this is, whose customer holds it, and whose account it belongs to if our own tag is
	 * still on it — or nothing at all where Stripe named no subscription or no customer, which is not a shape
	 * any real event has.
	 *
	 * <p>A tag that is not a UUID is read as no tag rather than as an error: it can only have been written by
	 * hand in the dashboard, the two Stripe ids below still find the row for anybody who has paid before, and
	 * an event refused over it would be one retried for three days over something no retry changes.
	 */
	Optional<SubscriberOnStripe> subscriber() {
		String subscription = text(this.object.path("id"));
		String customer = text(this.object.path("customer"));
		if (subscription == null || customer == null) {
			return Optional.empty();
		}
		return Optional.of(new SubscriberOnStripe(subscription, customer, taggedAccount()));
	}

	/**
	 * Stripe's status, as one of the seven this application stores — or nothing where Stripe has sent one we
	 * have never heard of.
	 *
	 * <p>Empty rather than a guess, and the caller's answer to it is to change nothing and say so loudly. The
	 * {@code status} column is held to those seven by a check constraint, so the alternatives are inventing a
	 * status that is not the one Stripe reported or failing the write inside a webhook — and Stripe adds
	 * statuses ({@code paused} is one this application never asks for and could still be sent).
	 */
	Optional<SubscriptionStatus> subscriptionStatus() {
		String status = text(this.object.path("status"));
		if (status == null) {
			return Optional.empty();
		}
		try {
			return Optional.of(SubscriptionStatus.valueOf(status.toUpperCase(Locale.ROOT)));
		}
		catch (IllegalArgumentException outsideTheSeven) {
			return Optional.empty();
		}
	}

	/**
	 * The status exactly as Stripe spelled it, for the one line that has to say which word we could not read.
	 *
	 * <p>Beside {@link #subscriptionStatus()} rather than folded into it, because everything that <em>acts</em>
	 * on a status has to act on one of the seven: a caller that could reach the raw text is a caller that could
	 * come to branch on a spelling nothing else in this application knows.
	 *
	 * @return the word, or {@code null} where the event carried none
	 */
	String statusAsStripeSpellsIt() {
		return text(this.object.path("status"));
	}

	/**
	 * The Price the subscription is for, which is what names the tier it grants.
	 *
	 * <p>The first item's, because everything this application sells is one line at quantity one
	 * ({@code OpenCheckout}) — a subscription with several items was assembled somewhere other than our
	 * Checkout, and picking one of its Prices would be guessing which of them the customer is meant to be on.
	 * The tier that Price belongs to is the catalog's to answer, not this record's.
	 */
	Optional<String> subscribedPriceId() {
		return Optional.ofNullable(text(this.object.path("items").path("data").path(0).path("price").path("id")));
	}

	/**
	 * Stripe's current billing period, which is the window a subscriber's quota is counted in and the
	 * {@code resetAt} every client renders.
	 *
	 * <p>Looked for on the subscription's first item and then on the subscription itself, which is the same
	 * field in the two places Stripe has kept it — see this record's own documentation. Empty where neither
	 * carries a whole window, which leaves the caller with nothing to write rather than a period made up out
	 * of one bound and a guess.
	 */
	Optional<QuotaPeriod> billingPeriod() {
		Optional<QuotaPeriod> onTheItem = windowOn(this.object.path("items").path("data").path(0));
		return onTheItem.isPresent() ? onTheItem : windowOn(this.object);
	}

	/** Our own {@code app_user} id, as {@code OpenCheckout} tagged the subscription with when it was bought. */
	private Optional<UUID> taggedAccount() {
		String tagged = text(this.object.path("metadata").path(OpenCheckout.ACCOUNT_TAG));
		if (tagged == null) {
			return Optional.empty();
		}
		try {
			return Optional.of(UUID.fromString(tagged));
		}
		catch (IllegalArgumentException notOneOfOurs) {
			return Optional.empty();
		}
	}

	/**
	 * The {@code current_period_*} pair on whichever node carries it, as seconds since the epoch — both
	 * bounds or neither, since a window with one end is not one anything can count usage in.
	 */
	private static Optional<QuotaPeriod> windowOn(JsonNode node) {
		long start = node.path("current_period_start").asLong(0);
		long end = node.path("current_period_end").asLong(0);
		if (start <= 0 || end <= start) {
			return Optional.empty();
		}
		return Optional.of(new QuotaPeriod(Instant.ofEpochSecond(start).atOffset(ZoneOffset.UTC),
				Instant.ofEpochSecond(end).atOffset(ZoneOffset.UTC)));
	}

	/** A field that is absent, null, or present and empty are one case here: nothing was said. */
	private static String text(JsonNode field) {
		String value = field.asString("").strip();
		return value.isEmpty() ? null : value;
	}

	/** This module's own mapper, for {@code TierRows}' reason: what goes out over HTTP is configured elsewhere. */
	private static final JsonMapper JSON = JsonMapper.builder().build();

	/**
	 * The tag ADR-0019 makes the link, spelled as the Stripe dashboard spells it.
	 *
	 * <p>Package-visible because {@code UnadoptedStripePrices} looks for its <em>absence</em> (T53, #84), and
	 * a second spelling of it there would mean an operator's list of "Prices with no tag" and this module's
	 * idea of a tag drifting apart — which shows up as a Price that is adopted and listed as unadopted, or
	 * neither. Same arrangement {@code OpenCheckout.ACCOUNT_TAG} has with the reader below it.
	 */
	static final String TIER_CODE = "tier_code";

	private static final String PRICE_CREATED = "price.created";

	private static final String PRICE_UPDATED = "price.updated";

	private static final String SUBSCRIPTION_CREATED = "customer.subscription.created";

	private static final String SUBSCRIPTION_UPDATED = "customer.subscription.updated";

	private static final String SUBSCRIPTION_DELETED = "customer.subscription.deleted";

}
