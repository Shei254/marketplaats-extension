package com.mprelist.billing.internal;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.mprelist.billing.StripePaymentMethods;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.net.ApiResource;
import com.stripe.net.StripeResponse;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * What the Stripe dashboard says a buyer may pay with, asked periodically and remembered (T65, #137).
 *
 * <p><strong>The default configuration, because that is the one our Checkout gets.</strong>
 * {@link OpenCheckout} sets no {@code payment_method_configuration} on the session, so Stripe applies the
 * account's default — reading it is therefore reading the very object Checkout will consult, not a proxy for
 * it. Stripe allows a second configuration with a different set for subscriptions, and an account that
 * <em>passed</em> one would make this answer wrong; nothing here passes one, and the day something does, this
 * is the class that has to learn about it.
 *
 * <p><strong>The raw body read with Jackson, not the sixty typed getters.</strong> The SDK generates a nested
 * class per method — {@code PaymentMethodConfiguration$Ideal}, {@code $Paypal}, {@code $Twint} — with no way
 * to iterate them, so a typed reading is sixty hardcoded calls that silently omit the sixty-first the day
 * Stripe adds it. Walking the JSON instead makes this total over whatever Stripe returns: a method is any
 * field carrying a {@code display_preference} turned {@code on}, which is already true of the ones that do
 * not exist yet.
 *
 * <p>It is the same choice {@code StripeEvent} makes, for the reason {@code build.gradle.kts} states of it —
 * read with Jackson rather than deserialised into the library's model, so the shape of Stripe's answer
 * decides what we can read rather than the version of a jar. Here it also keeps Gson, which is Stripe's own
 * serialiser and nothing of ours, off this application's compile classpath.
 *
 * <p><strong>Failures are not remembered</strong>, the rule {@link CachedStripePrices} keeps and for its
 * reason: a five-second blip must cost a retry rather than a TTL.
 *
 * <p><strong>But that cache's safety argument does not transfer, and this is the important difference.</strong>
 * Stripe Prices are <em>immutable</em>, so a remembered amount cannot go stale and its TTL only bounds how
 * long a mistake is shown. A payment method configuration is <em>mutable in place</em>: an operator ticks
 * PayPal and the same object now says something else. So this TTL is doing real freshness work, and it is the
 * whole reason a method enabled in the dashboard does not appear in the popup at once. Anybody shortening or
 * lengthening it is trading "how soon a new method is advertised" against how often Stripe is asked, which is
 * a different trade from the one next door.
 */
@Service
class CachedPaymentMethods implements StripePaymentMethods {

	/**
	 * {@code @Autowired} for {@link CachedStripePrices}' reason: two constructors, and without it the context
	 * fails to start looking for a default one with a message that names neither Stripe nor the real problem.
	 */
	@Autowired
	CachedPaymentMethods(StripeAccount stripe, @Value("${mprelist.stripe.payment-method-cache}") Duration remembered) {
		this(stripe, remembered, Instant::now);
	}

	/** Package-private, for the suite that serves Stripe's own JSON on a loopback port and ages this clock. */
	CachedPaymentMethods(StripeAccount stripe, Duration remembered, Supplier<Instant> now) {
		this.stripe = stripe;
		this.remembered = remembered;
		this.now = now;
	}

	@Override
	public List<String> offered() {
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			return List.of();
		}
		Remembered<List<String>> held = this.held;
		if (held != null && held.isFresh(this.now.get())) {
			return held.answer();
		}
		Optional<List<String>> fetched = fetch(client.get());
		// Only what came back, exactly as the price cache does: remembering an outage would keep the sentence
		// off the plan screen for a whole TTL after Stripe came back.
		fetched.ifPresent(methods -> this.held = new Remembered<>(methods, this.now.get().plus(this.remembered)));
		return fetched.orElseGet(List::of);
	}

	/**
	 * One list call, and everything that can go wrong with it is the same answer: no sentence.
	 *
	 * <p>The whole set is logged whenever it is refreshed rather than only the tokens nobody has named. This
	 * class cannot know what the popup can spell — the display names are the client's, which is what keeps
	 * Stripe's vocabulary crossing the boundary unedited — so it says what Stripe offers and lets the operator
	 * compare. A method that appears here and never on a plan card is a line missing from the popup's map.
	 */
	private Optional<List<String>> fetch(StripeClient stripe) {
		try {
			StripeResponse answer = stripe.rawRequest(ApiResource.RequestMethod.GET, CONFIGURATIONS, null);
			JsonNode configuration = defaultIn(JSON.readTree(answer.body()));
			if (configuration == null) {
				LOG.warn("Stripe returned no default payment method configuration, so the plan screen will "
						+ "not say what can be paid with. Nothing else is affected — Checkout still offers "
						+ "whatever the dashboard has enabled.");
				return Optional.empty();
			}
			List<String> on = turnedOn(configuration);
			LOG.info("Stripe offers {} on the configuration named `{}`. A method here that never reaches a "
					+ "plan card is one the popup has no name for.", on,
					configuration.path("name").asString(""));
			return Optional.of(on);
		}
		catch (StripeException unavailable) {
			// The message, not the exception: it is what an operator reads, and the stack is Stripe's client.
			LOG.warn("Could not ask Stripe what can be paid with: {}", unavailable.getMessage());
			return Optional.empty();
		}
		catch (JacksonException unreadable) {
			// A 200 whose body is not the list this asked for. The same answer as an outage, because the
			// caller's question is the same: is there a sentence to render.
			LOG.warn("Stripe's payment method configurations could not be read: {}", unreadable.getMessage());
			return Optional.empty();
		}
	}

	/**
	 * The configuration Checkout will apply, which is the one flagged {@code is_default}.
	 *
	 * <p>An account may hold several — Stripe's own suggestion for offering a different set to subscriptions
	 * than to one-off payments — and reading the wrong one advertises methods a buyer will never be shown.
	 * The default is the right one here precisely because {@link OpenCheckout} names none.
	 */
	private static JsonNode defaultIn(JsonNode list) {
		for (JsonNode configuration : list.path("data")) {
			if (configuration.path("is_default").asBoolean(false)) {
				return configuration;
			}
		}
		return null;
	}

	/**
	 * Every field that is a payment method turned on, in the order Stripe wrote them.
	 *
	 * <p>The shape is the discriminator rather than a list of names: a method is an object carrying a
	 * {@code display_preference} whose {@code value} is {@code on}. {@code id}, {@code active}, {@code name},
	 * {@code is_default} and {@code livemode} are not objects or carry no preference, so they fall out without
	 * being named here — which is what stops this needing an edit when Stripe adds either a method or a field.
	 *
	 * <p>{@code available} is deliberately not read. It says whether this account <em>could</em> turn the
	 * method on; what the buyer meets is what it <em>has</em> turned on, and an unavailable method cannot be
	 * on in the first place.
	 */
	private static List<String> turnedOn(JsonNode configuration) {
		List<String> on = new ArrayList<>();
		for (Map.Entry<String, JsonNode> field : configuration.properties()) {
			if (!field.getValue().isObject()) {
				continue;
			}
			if ("on".equals(field.getValue().path("display_preference").path("value").asString(""))) {
				on.add(field.getKey());
			}
		}
		return List.copyOf(on);
	}

	/**
	 * One answer rather than the price cache's map: there is one Stripe account and it has one default
	 * configuration, so there is nothing to key on. Volatile because two popups opening at once read it from
	 * two request threads, and a torn read here would show one of them a sentence assembled from nothing.
	 */
	private volatile Remembered<List<String>> held;

	private final StripeAccount stripe;

	private final Duration remembered;

	/** The clock, so the suite can age an entry rather than sleep through one. */
	private final Supplier<Instant> now;

	/** Stripe's own path, spelled once. There is no typed call here to carry it. */
	private static final String CONFIGURATIONS = "/v1/payment_method_configurations";

	/** This module's own mapper, exactly as {@code StripeEvent} keeps one, and for its reason. */
	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final Logger LOG = LoggerFactory.getLogger(CachedPaymentMethods.class);

}
