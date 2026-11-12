package com.mprelist.billing.internal;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.stripe.StripeClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * A Scheduled switch that has taken over lets go of its subscription at once (T90, ADR-0042), rather than
 * holding it for the whole next period, when Stripe would still refuse to cancel it at period end.
 *
 * <p>Against the bytes on the wire, for {@code PlanSwitchTest}'s reason.
 */
class ReleaseFinishedSchedulesTest {

	private HttpServer stripe;

	private final List<String> asked = new ArrayList<>();

	/** The schedule Stripe answers with. */
	private String schedule = schedule("active", "release", true);

	private boolean stripeAnswers = true;

	@BeforeEach
	void startStripe() throws IOException {
		this.stripe = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		this.stripe.createContext("/v1/", exchange -> {
			String call = exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath();
			this.asked.add(call);
			if (!this.stripeAnswers) {
				respond(exchange, 500, "{\"error\":{\"message\":\"no\"}}");
				return;
			}
			switch (call) {
				case "GET /v1/subscription_schedules/sub_sched_1" -> respond(exchange, 200, this.schedule);
				case "POST /v1/subscription_schedules/sub_sched_1/release" -> respond(exchange, 200,
						"{\"id\":\"sub_sched_1\",\"object\":\"subscription_schedule\",\"status\":\"released\"}");
				default -> respond(exchange, 404, "{\"error\":{\"message\":\"not faked\"}}");
			}
		});
		this.stripe.start();
	}

	@AfterEach
	void stopStripe() {
		this.stripe.stop(0);
	}

	@Test
	void aScheduleInItsLastPhaseIsReleased() {
		releases().after(StripeEvent.in(updated("\"sub_sched_1\"")));

		assertThat(this.asked).containsExactly("GET /v1/subscription_schedules/sub_sched_1",
				"POST /v1/subscription_schedules/sub_sched_1/release");
	}

	/** Still waiting for its switch: that is the pending switch itself, and it stays. */
	@Test
	void oneWithAPhaseStillToComeIsLeftAlone() {
		this.schedule = schedule("active", "release", false);

		releases().after(StripeEvent.in(updated("\"sub_sched_1\"")));

		assertThat(this.asked).containsExactly("GET /v1/subscription_schedules/sub_sched_1");
	}

	/** A schedule made in the dashboard that ends by cancelling: releasing it would undo a cancellation. */
	@Test
	void oneThatEndsAnyOtherWayIsLeftAlone() {
		this.schedule = schedule("active", "cancel", true);

		releases().after(StripeEvent.in(updated("\"sub_sched_1\"")));

		assertThat(this.asked).containsExactly("GET /v1/subscription_schedules/sub_sched_1");
	}

	@Test
	void aSubscriptionNoScheduleHoldsAsksStripeNothing() {
		releases().after(StripeEvent.in(updated("null")));

		assertThat(this.asked).isEmpty();
	}

	/** Never a reason to refuse the event: the next renewal's event tries again. */
	@Test
	void aStripeThatWillNotAnswerIsALogLine() {
		this.stripeAnswers = false;

		releases().after(StripeEvent.in(updated("\"sub_sched_1\"")));

		assertThat(this.asked).containsExactly("GET /v1/subscription_schedules/sub_sched_1");
	}

	@Test
	void andSoIsAStripeNobodyConfigured() {
		new ReleaseFinishedSchedules(new StripeAccount("")).after(StripeEvent.in(updated("\"sub_sched_1\"")));

		assertThat(this.asked).isEmpty();
	}

	private ReleaseFinishedSchedules releases() {
		return new ReleaseFinishedSchedules(new StripeAccount(StripeClient.builder()
				.setApiKey("sk_test_not_a_real_key")
				.setApiBase("http://localhost:" + this.stripe.getAddress().getPort())
				.setMaxNetworkRetries(0)
				.build()));
	}

	private static String updated(String schedule) {
		return "{\"id\":\"evt_1\",\"type\":\"customer.subscription.updated\",\"created\":1800000000,"
				+ "\"data\":{\"object\":{\"id\":\"sub_1\",\"object\":\"subscription\",\"customer\":\"cus_1\","
				+ "\"status\":\"active\",\"schedule\":" + schedule + "}}}";
	}

	/**
	 * Two phases, the first until 2000 and the second from then until 3000, with the current one being the
	 * second where {@code inLastPhase}: the switch has taken over.
	 */
	private static String schedule(String status, String endBehavior, boolean inLastPhase) {
		String current = inLastPhase ? "{\"start_date\":2000,\"end_date\":3000}"
				: "{\"start_date\":0,\"end_date\":2000}";
		return "{\"id\":\"sub_sched_1\",\"object\":\"subscription_schedule\",\"status\":\"" + status + "\","
				+ "\"end_behavior\":\"" + endBehavior + "\",\"current_phase\":" + current + ","
				+ "\"phases\":[{\"start_date\":0,\"end_date\":2000},{\"start_date\":2000,\"end_date\":3000}]}";
	}

	private static void respond(HttpExchange exchange, int status, String body) throws IOException {
		byte[] bytes = body.getBytes(UTF_8);
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(status, bytes.length);
		try (OutputStream out = exchange.getResponseBody()) {
			out.write(bytes);
		}
	}

}
