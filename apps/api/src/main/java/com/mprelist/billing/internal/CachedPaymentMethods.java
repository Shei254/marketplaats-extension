package com.mprelist.billing.internal;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
 * <p><strong>This account's own default, which is not the same thing as the first object flagged
 * {@code is_default}.</strong> A list can hold several that claim it: a Connect platform's configurations for
 * its connected accounts come back here too, each carrying its own default, and they are told apart by
 * {@code parent} — a configuration that has one is a child of somebody else's and is not what our sessions
 * resolve to. Reading the first flag in list order picked exactly such a child on the account this was first
 * pointed at, and the plan screen then advertised a set Checkout never applied. That is the "second answer
 * beside the dashboard's" this feature exists to prevent, reached by a different route (ADR-0022).
 *
 * <p><strong>And only what a subscription can actually be billed on.</strong> iDEAL, Bancontact and Sofort
 * charge a second time by setting up a SEPA Direct Debit mandate rather than by themselves, so with
 * {@code sepa_debit} turned off a {@code subscription} Checkout offers none of them however firmly the
 * configuration says {@code on}. This is not the hardcoded recurring table ADR-0022 refused: it is a second
 * field on the object already being read, which is the shape that ADR's "revisit if" asked for. PayPal's
 * recurring approval is still not on it, and stays the documented residual.
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
	 * Stripe's vocabulary crossing the boundary unedited — so it says what Stripe offers a subscription and
	 * lets the operator compare. A method that appears here and never on a plan card is a line missing from
	 * the popup's map; one that is enabled and never appears here at all is the SEPA rule below, which logs
	 * itself separately.
	 */
	private Optional<List<String>> fetch(StripeClient stripe) {
		try {
			StripeResponse answer = stripe.rawRequest(ApiResource.RequestMethod.GET, CONFIGURATIONS, null);
			JsonNode configuration = ourDefaultIn(JSON.readTree(answer.body()));
			if (configuration == null) {
				LOG.warn("Stripe returned no default payment method configuration of this account's own, so "
						+ "the plan screen will not say what can be paid with. Nothing else is affected — "
						+ "Checkout still offers whatever the dashboard has enabled.");
				return Optional.empty();
			}
			List<String> billable = subscribable(turnedOn(configuration));
			LOG.info("Stripe offers {} for subscriptions on the configuration named `{}`. A method here that "
					+ "never reaches a plan card is one the popup has no name for; one the plan card names "
					+ "and Checkout then omits is logged by `OpenCheckout` against the session itself.",
					billable, configuration.path("name").asString(""));
			return Optional.of(billable);
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
	 * The configuration Checkout will apply: this account's own, flagged {@code is_default}.
	 *
	 * <p>An account may hold several — Stripe's own suggestion for offering a different set to subscriptions
	 * than to one-off payments — and reading the wrong one advertises methods a buyer will never be shown.
	 * The default is the right one here precisely because {@link OpenCheckout} names none.
	 *
	 * <p><strong>{@code is_default} alone does not pick it out.</strong> The list also carries the
	 * configurations a Connect platform holds for its connected accounts, each with a default of its own, and
	 * {@code parent} is what separates them: ours has none. Without that test this returned whichever claimed
	 * default came first in Stripe's ordering, which on a platform account is not reliably ours — the plan
	 * screen then names a set the buyer never meets, silently, since both objects are perfectly valid.
	 *
	 * <p>Two of our own claiming it should be impossible and is therefore logged rather than resolved: Stripe
	 * would have to have changed what {@code is_default} means, and a guess dressed up as an answer is the
	 * thing to avoid on a screen somebody is buying from.
	 */
	private static JsonNode ourDefaultIn(JsonNode list) {
		List<JsonNode> ours = new ArrayList<>();
		for (JsonNode configuration : list.path("data")) {
			if (configuration.path("is_default").asBoolean(false) && isOurs(configuration)) {
				ours.add(configuration);
			}
		}
		if (ours.isEmpty()) {
			return null;
		}
		if (ours.size() > 1) {
			LOG.warn("Stripe reports {} default payment method configurations belonging to this account — {} "
					+ "— when there can be one. Reading `{}`, which is the first, and it may not be the one "
					+ "Checkout applies.", ours.size(),
					ours.stream().map(configuration -> configuration.path("id").asString("")).toList(),
					ours.get(0).path("id").asString(""));
		}
		return ours.get(0);
	}

	/**
	 * Whether a configuration is this account's rather than one it holds for a connected account.
	 *
	 * <p>Absent and {@code null} are both "ours" — Stripe writes the field as {@code null} on an
	 * unparented configuration, and an older API version omitted it — so the test is for a {@code parent}
	 * that is actually there.
	 */
	private static boolean isOurs(JsonNode configuration) {
		JsonNode parent = configuration.path("parent");
		return parent.isMissingNode() || parent.isNull();
	}

	/**
	 * What is left once the methods that cannot carry a subscription on their own are taken out.
	 *
	 * <p>This product sells subscriptions and nothing else, so {@code offered()} answering "what Checkout
	 * offers" has to mean a {@code subscription} Checkout. iDEAL, Bancontact and Sofort bill a second time by
	 * setting up a SEPA Direct Debit mandate, so without {@code sepa_debit} there is no mandate to set up and
	 * Stripe drops them from the session — advertised on the plan screen and absent at the hand-off, which is
	 * the one failure this sentence must not have.
	 *
	 * <p><strong>It is a filter and not a table.</strong> The condition is read off the same configuration,
	 * one field over, so nothing here is a second copy of what the dashboard says; a method Stripe teaches to
	 * bill recurring tomorrow needs no edit unless it is one of these three. And when the drift does come it
	 * comes in the safe direction: this can only leave a method out, and a sentence that never claimed to be
	 * exhaustive is not made false by an omission — only by a name that is not there at Checkout.
	 */
	private static List<String> subscribable(List<String> on) {
		if (on.contains(SEPA_DEBIT)) {
			return on;
		}
		List<String> withoutMandate = on.stream().filter(THROUGH_SEPA::contains).toList();
		if (withoutMandate.isEmpty()) {
			return on;
		}
		LOG.info("{} are turned on but SEPA Direct Debit is not, so a subscription Checkout will not offer "
				+ "them and the plan screen will not name them: they charge again through a SEPA mandate, and "
				+ "there is none to set up. Turning SEPA Direct Debit on is what brings them back.",
				withoutMandate);
		List<String> billable = new ArrayList<>(on);
		billable.removeAll(THROUGH_SEPA);
		return List.copyOf(billable);
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

	/** The mandate the three below are billed through, in Stripe's spelling. */
	private static final String SEPA_DEBIT = "sepa_debit";

	/**
	 * The bank redirects that have no recurrence of their own: each takes one payment and leaves a SEPA
	 * Direct Debit mandate behind, which is what the subscription is actually charged on afterwards.
	 */
	private static final Set<String> THROUGH_SEPA = Set.of("ideal", "bancontact", "sofort");

	/** This module's own mapper, exactly as {@code StripeEvent} keeps one, and for its reason. */
	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final Logger LOG = LoggerFactory.getLogger(CachedPaymentMethods.class);

}
