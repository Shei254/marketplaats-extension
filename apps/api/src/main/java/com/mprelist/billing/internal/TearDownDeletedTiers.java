package com.mprelist.billing.internal;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.mprelist.catalog.OutstandingCleanup;
import com.mprelist.catalog.StripeCleanup;
import com.mprelist.catalog.TierTeardown;
import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Price;
import com.stripe.param.PriceUpdateParams;
import com.stripe.param.ProductUpdateParams;

/**
 * The Stripe half of a deleted tier, drained a call at a time (T77,
 * <a href="../../../../../../../../docs/adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md">ADR-0032</a>).
 *
 * <p>{@code DELETE /api/admin/tiers/{code}} deletes the row immediately and enqueues what it owes Stripe in
 * the same Postgres transaction, because the alternative is N Stripe calls inside one HTTP request — a
 * request that times out halfway through cancelling strangers' subscriptions. This is what makes the two
 * systems agree afterwards, and {@code ReservationReconciliation} is its one precedent: a {@code @Scheduled}
 * job doing on a fixed delay what a request had no business doing inline.
 *
 * <p><strong>Three calls, and the untagging is the one that is not tidiness.</strong> Archiving a Price is
 * what "delete" means in Stripe — {@code PriceService} has no {@code delete} at all — but an archived Price
 * still carries {@code metadata.tier_code}, and archiving it <em>fires</em> a {@code price.updated}. Left
 * tagged, that event walks straight back into {@code PriceAdoptions.adopt} and drafts the tier that was just
 * deleted. Cleared in the same call, the tag reads as absent and the event the clearing itself fires is a
 * no-op by construction.
 *
 * <p><strong>Idempotent by being statements of the state wanted.</strong> Archived, untagged, cancelled —
 * every one of these can be made twice and mean the same thing, which is why nothing here takes a lock and why
 * two instances draining at once cost two calls rather than a corruption.
 *
 * <p><strong>Nothing gives up.</strong> A row Stripe refuses for ever keeps its attempt count and its last
 * error and stays outstanding — which also keeps its tier code closed to the sync — and that is the cost
 * ADR-0032 accepts out loud: this is the application's first durable work queue, and a row nobody can drain is
 * a row somebody has to notice. What is <em>not</em> a refusal is Stripe saying the object is not there:
 * a Price that does not exist cannot resurrect a tier, which is the whole of what archiving it was for.
 */
@Service
class TearDownDeletedTiers {

	/**
	 * @param batch how many outstanding calls one run makes. Configuration rather than a constant for
	 * {@code ReservationReconciliation}'s reason: it is a judgement about how much of somebody else's rate
	 * limit to spend at once, which is a thing the world tells us rather than a thing this code knows
	 */
	TearDownDeletedTiers(StripeAccount stripe, TierTeardown teardown,
			@Value("${mprelist.stripe.teardown.batch}") int batch) {
		this.stripe = stripe;
		this.teardown = teardown;
		this.batch = batch;
	}

	/**
	 * Makes Stripe agree with a catalog a tier was deleted from.
	 *
	 * <p><strong>A fixed delay, so a run that is slow or blocked delays the next rather than overlapping
	 * it</strong> — and it fires at startup, which is what drains whatever accumulated while nothing was
	 * running. The same shape #24's reconciliation has, for the same reasons.
	 *
	 * <p><strong>An unconfigured Stripe is not an error here.</strong> Every developer's stack has no API key
	 * (see {@link StripeAccount}), and a job that logged a failure every few minutes on all of them would be a
	 * line everybody learns to stop reading. The rows simply stay outstanding, which is true: nothing has been
	 * torn down.
	 *
	 * <p>Logged only when it moved something, for the reconciliation's reason. This number is worth reading —
	 * it is how far behind the catalog Stripe is.
	 */
	@Scheduled(fixedDelayString = "${mprelist.stripe.teardown.interval}")
	void makeStripeAgreeWithTheCatalog() {
		List<OutstandingCleanup> outstanding = this.teardown.outstanding(this.batch);
		if (outstanding.isEmpty()) {
			return;
		}
		Optional<StripeClient> client = this.stripe.client();
		if (client.isEmpty()) {
			LOG.warn("{} Stripe call(s) are outstanding for deleted tiers and no Stripe API key is configured, "
					+ "so nothing can be torn down. Until it is, those tier codes stay closed to the price "
					+ "sync.", outstanding.size());
			return;
		}
		int done = 0;
		for (OutstandingCleanup call : outstanding) {
			done += make(client.get(), call) ? 1 : 0;
		}
		LOG.info("Tore down {} of {} outstanding Stripe call(s) left by deleted tiers.", done,
				outstanding.size());
	}

	/**
	 * One call, and the row moved to whichever side of it the answer puts it.
	 *
	 * <p>Every {@link StripeException} is caught rather than any particular one: what this job is between is a
	 * network and somebody else's rate limiter, and the shape of a failure is not something to enumerate. What
	 * <em>is</em> enumerated is the one code that means success — see {@link #alreadyGone}.
	 */
	private boolean make(StripeClient stripe, OutstandingCleanup call) {
		try {
			/*
			 * A switch *expression* over every constant, with no `default`, so that a fourth StripeCleanup
			 * kind is a compilation failure here — where somebody has to decide what call it is — rather than
			 * a row this job silently marks done having asked Stripe nothing. The same argument
			 * `SubscriptionStatus.endsTheSubscription()` makes about Stripe adding a status.
			 *
			 * What it yields is the one thing the three arms genuinely differ about: archiving a Price is
			 * also how the Product id is learned, because it was never stored.
			 */
			Optional<String> product = switch (call.kind()) {
				case CANCEL_SUBSCRIPTION -> {
					stripe.subscriptions().cancel(call.stripeId());
					yield Optional.empty();
				}
				case ARCHIVE_PRICE -> Optional.ofNullable(archive(stripe, call).getProduct());
				case ARCHIVE_PRODUCT -> {
					stripe.products().update(call.stripeId(),
							ProductUpdateParams.builder().setActive(false).build());
					yield Optional.empty();
				}
			};
			// Enqueued rather than archived inline, which keeps one row per Stripe object: a tier sold monthly
			// and annually offers the same Product twice, and the partial unique index makes the second offer
			// a no-op.
			product.ifPresent(id -> this.teardown.enqueue(call.tierCode(), StripeCleanup.ARCHIVE_PRODUCT,
					List.of(id)));
			this.teardown.done(call.id());
			return true;
		}
		catch (StripeException refused) {
			if (alreadyGone(stripe, call, refused)) {
				// Stripe has nothing left to do because the object is not there, or is already in the state
				// this row asks for — a Price deleted in test mode, a subscription cancelled by hand, a
				// Product archived twice. That is what "done" means.
				LOG.info("Stripe has nothing left to {} for {} on the deleted tier `{}`, so that row is done.",
						call.kind(), call.stripeId(), call.tierCode());
				this.teardown.done(call.id());
				return true;
			}
			// WARN and not ERROR: a rate limit or a blip is ordinary and the next run retries it. What an
			// operator is meant to notice is the attempt count climbing on one row, which is why it is in the
			// line and in the column.
			LOG.warn("Stripe would not {} {} for the deleted tier `{}` (attempt {}): {}", call.kind(),
					call.stripeId(), call.tierCode(), call.attempts() + 1, refused.getMessage());
			this.teardown.failed(call.id(), refused.getMessage());
			return false;
		}
	}

	/**
	 * Archive the Price, clear its tag, and queue its Product.
	 *
	 * <p><strong>{@code active = false} and the cleared tag ride in one {@code price.update}</strong>, so
	 * there is no moment at which a Price is archived and still carrying a code — which is exactly the moment
	 * a {@code price.updated} would resurrect the tier.
	 *
	 * <p><strong>The Product id is learned here and nowhere else</strong>, because it has never been stored:
	 * {@code tier_price} holds Price ids and the tier row that might have held a Product id does not exist any
	 * more by the time this runs. The {@code update} answers with the Price, so the {@code retrieve} ADR-0032
	 * budgeted for is not a second call after all. Enqueuing it rather than archiving it inline keeps one row
	 * per Stripe object: a tier sold monthly and annually offers the same Product twice, and the partial
	 * unique index makes the second offer a no-op.
	 */
	private static Price archive(StripeClient stripe, OutstandingCleanup call) throws StripeException {
		return stripe.prices().update(call.stripeId(), PriceUpdateParams.builder()
				.setActive(false)
				.putMetadata(StripeEvent.TIER_CODE, "")
				.build());
	}

	/**
	 * Whether Stripe has nothing left to do, which is this job's other way of succeeding.
	 *
	 * <p>{@code resource_missing} is the first half and is checked on the error <em>code</em> rather than on
	 * the status or the message: a {@code 404} is also what an API key without permission gets on some
	 * resources, and the message is prose Stripe may reword. An object Stripe does not hold cannot resurrect
	 * a tier or bill anybody, which is the whole of what the row asked for.
	 *
	 * <p><strong>Cancelling needs a second half, and leaving it out is what would make a row stick for
	 * ever.</strong> A subscription somebody cancelled in the dashboard still <em>exists</em>, so cancelling
	 * it again is refused as an ordinary invalid request rather than as a missing resource — and a row that
	 * can never drain keeps its tier's code closed to {@code adopt} indefinitely, which is precisely the
	 * permanent tombstone ADR-0032 rejected. So a refused cancellation asks what Stripe actually holds, and a
	 * subscription already in a terminal state is done.
	 *
	 * <p>The extra call is on the failure path only: the ordinary cancellation succeeds in one, and this runs
	 * where the alternative is a row somebody has to notice by hand. A retrieve that itself fails leaves the
	 * row outstanding, which is the honest answer to not knowing.
	 */
	private static boolean alreadyGone(StripeClient stripe, OutstandingCleanup call, StripeException refused) {
		if (RESOURCE_MISSING.equals(refused.getCode())) {
			return true;
		}
		if (call.kind() != StripeCleanup.CANCEL_SUBSCRIPTION) {
			return false;
		}
		try {
			// Named before it is compared, because `Set.of(…).contains(null)` *throws* — and an exception
			// from here is not a StripeException, so it would escape the catch this is called from and take
			// the whole run down rather than one row. A subscription Stripe describes without a status is not
			// one this can call finished.
			String status = stripe.subscriptions().retrieve(call.stripeId()).getStatus();
			return status != null && TERMINAL.contains(status);
		}
		catch (StripeException unanswerable) {
			// Including `resource_missing`, which says the subscription is not there at all — the same
			// answer by a different route, and the one case where asking twice was worth it.
			return RESOURCE_MISSING.equals(unanswerable.getCode());
		}
	}

	private final StripeAccount stripe;

	private final TierTeardown teardown;

	private final int batch;

	private static final String RESOURCE_MISSING = "resource_missing";

	/**
	 * The Stripe subscription statuses that mean it is over and will not bill again — Stripe's own spellings,
	 * which is the vocabulary this module deals in (the normalized seven are {@code subscription}'s).
	 */
	private static final Set<String> TERMINAL = Set.of("canceled", "incomplete_expired");

	private static final Logger LOG = LoggerFactory.getLogger(TearDownDeletedTiers.class);

}
