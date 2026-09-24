import {
  cardGrantOf,
  priceAndRhythmOf,
  waysToPay,
  type Plan,
} from "@mprelist/contracts";
import { Button, Icon, Skeleton } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX } from "react";

import { BRAND } from "../brand";
import type { LoadPlans, PlansOnOffer } from "./plans-on-offer";

/**
 * The landing page at `/` (T58, #89), which the Web Store listing names as the
 * homepage. The drawing is `docs/design/Landing.dc.html`.
 *
 * **The words are the listing's.** `store/listing.md`'s description is what the
 * reviewer and a searcher read, and this page is where its Homepage URL takes
 * them. Saying something different here would be two accounts of one product, so
 * the steps and the three things to know are the same sentences. It keeps the
 * listing's rules as well: the delete comes first, Marktplaats is named as
 * somebody else's, and none of the words that imply its approval appear.
 *
 * **The plan cards are the popup's, read aloud the same way.** `GET /api/plans` is
 * asked with no token and answers what it answers the popup, and the wording comes
 * from `@mprelist/contracts` rather than a second copy. Nothing is sold from here:
 * Checkout opens from the popup, which knows who is buying (ADR-0017).
 */

/**
 * The listing, by the id the Store gave the draft (T56). The id never changes, so
 * the link is right from the day the listing is approved, and a `404` until then.
 */
export const STORE_URL =
  "https://chromewebstore.google.com/detail/cefnlogjhmeceojlaoionfjpdkklmnaf";

/**
 * The page, holding the one thing it learns after it is drawn: what is on sale.
 * `loadPlans` is handed in, so what is asked and when can be driven by a test.
 */
export function Landing({ loadPlans }: { loadPlans: LoadPlans }): JSX.Element {
  const [plans, setPlans] = useState<PlansOnOffer | "loading">("loading");

  const ask = useCallback(() => {
    let current = true;
    setPlans("loading");
    void loadPlans().then((answer) => {
      if (current) setPlans(answer);
    });
    return () => {
      current = false;
    };
  }, [loadPlans]);

  useEffect(ask, [ask]);

  return <LandingPage plans={plans} onRetry={ask} />;
}

/** The page as a function of what the plans question has answered so far. */
export function LandingPage({
  plans,
  onRetry,
}: {
  plans: PlansOnOffer | "loading";
  onRetry: () => void;
}): JSX.Element {
  return (
    <>
      <section className="web-hero">
        <h1 className="web-hero-title">Zet je advertentie weer bovenaan</h1>
        <p className="web-copy web-hero-copy">
          Nieuwe advertenties staan op Marktplaats bovenaan; na een paar dagen
          zakt de jouwe weg. Met {BRAND.name} herplaats je hem vanuit je
          browser, met alle tekst en foto’s, en staat hij weer bovenaan de
          recente advertenties.
        </p>
        <a
          className="mp-btn mp-btn--block mp-btn--primary web-install"
          href={STORE_URL}
        >
          Toevoegen aan Chrome
          <Icon name="external" />
        </a>
        <p className="web-micro web-hero-micro">
          Gratis te installeren · werkt in Chrome
        </p>
        <BeforeAndAfter />
      </section>

      <section className="web-section">
        <h2 className="web-section-title">Zo werkt het</h2>
        {/* Each step's words in one span: the item is a flex row beside its number,
            and bare text beside a <b> would be three flex items rather than a sentence. */}
        <ol className="web-steps">
          <li>
            <span>Open marktplaats.nl en log in zoals je gewend bent.</span>
          </li>
          <li>
            <span>
              Klik op het {BRAND.name}-icoon in je werkbalk en log in met je{" "}
              {BRAND.name}-account.
            </span>
          </li>
          <li>
            <span>
              Kies een van je advertenties en klik op <b>Herplaats</b>.
            </span>
          </li>
        </ol>
      </section>

      <section className="web-section web-section--subtle">
        <h2 className="web-section-title">Goed om te weten</h2>
        <ul className="web-points">
          <li>
            Herplaatsen verwijdert je advertentie en plaatst hem direct opnieuw,
            met alle tekst en foto’s.
          </li>
          <li>
            Alles gebeurt in je eigen browser, onder je eigen Marktplaats-login.{" "}
            {BRAND.name} ziet je Marktplaats-wachtwoord niet, en de tekst en
            foto’s van je advertenties komen nooit bij ons.
          </li>
          <li>
            Je hebt een {BRAND.name}-account nodig. Aanmelden is gratis, en een
            gratis abonnement geeft een beperkt aantal herplaatsingen per maand.
          </li>
        </ul>
      </section>

      <section className="web-section">
        <h2 className="web-section-title">Abonnementen</h2>
        <PlanCards plans={plans} onRetry={onRetry} />
      </section>
    </>
  );
}

/** Where plans are chosen, leading into the cards — or ending the section when there are none. */
function LeadIn({ intoCards }: { intoCards: boolean }): JSX.Element {
  return (
    <p className="web-section-copy">
      Wil je vaker herplaatsen, dan kies je in de extensie een betaald
      abonnement{intoCards ? ":" : "."}
    </p>
  );
}

function PlanCards({
  plans,
  onRetry,
}: {
  plans: PlansOnOffer | "loading";
  onRetry: () => void;
}): JSX.Element {
  if (plans === "loading") {
    return (
      <>
        <LeadIn intoCards />
        <div className="web-plans" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="web-plan">
              <Skeleton width="45%" height={14} />
              <Skeleton width="80%" height={12} />
              <Skeleton width="60%" height={12} />
            </div>
          ))}
        </div>
      </>
    );
  }
  if (plans.status === "unavailable") {
    return (
      <>
        <LeadIn intoCards={false} />
        <div className="web-plans-unavailable">
          <p>
            De prijzen kunnen nu niet worden geladen. Je vindt ze ook in de
            extensie, onder <b>Kies een abonnement</b>.
          </p>
          <Button tone="retry" shape="rect" onClick={onRetry}>
            Opnieuw proberen
          </Button>
        </div>
      </>
    );
  }
  // An empty list is an answer: nothing is on sale, so there is nothing to draw
  // and nothing to pay for. The sentence still says where plans are chosen.
  if (plans.plans.length === 0) return <LeadIn intoCards={false} />;
  const payWith = waysToPay(plans.paymentMethods);
  return (
    <>
      <LeadIn intoCards />
      <div className="web-plans">
        {plans.plans.map((plan) => (
          <PlanCard key={plan.tier.code} plan={plan} />
        ))}
      </div>
      {payWith ? <p className="web-pay-with">{payWith}</p> : null}
    </>
  );
}

function PlanCard({ plan }: { plan: Plan }): JSX.Element {
  return (
    <div className="web-plan">
      <p className="web-plan-name">{plan.tier.name}</p>
      <p className="web-plan-grant">{cardGrantOf(plan)}</p>
      {plan.prices.map((price) => (
        <p key={price.interval} className="web-plan-price">
          {priceAndRhythmOf(price)}
        </p>
      ))}
    </div>
  );
}

/**
 * Where a reposted ad lands, drawn rather than said: four rows of recent ads, the
 * visitor's sunk to the bottom and then back on top. No Marktplaats styling — the
 * rows are this product's own tokens, so nothing here dresses up as their site.
 */
function BeforeAndAfter(): JSX.Element {
  return (
    <div className="web-compare" aria-hidden="true">
      <Column
        title="Na een paar dagen"
        rows={["vandaag", "gisteren", "2 dagen"]}
        yours="5 dagen"
        yoursFirst={false}
      />
      <span className="web-compare-arrow">→</span>
      <Column
        title="Na herplaatsen"
        rows={["vandaag", "gisteren", "2 dagen"]}
        yours="zojuist"
        yoursFirst
      />
    </div>
  );
}

function Column({
  title,
  rows,
  yours,
  yoursFirst,
}: {
  title: string;
  rows: string[];
  yours: string;
  yoursFirst: boolean;
}): JSX.Element {
  const mine = (
    <div className="web-compare-row web-compare-row--yours">
      <span className="web-compare-thumb" />
      <span>
        <b>Jouw fiets</b> · {yours}
      </span>
      {yoursFirst ? <span className="web-compare-top">Bovenaan</span> : null}
    </div>
  );
  const others = rows.map((when) => (
    <div key={when} className="web-compare-row">
      <span className="web-compare-thumb" />
      <span>Nieuw geplaatst · {when}</span>
    </div>
  ));
  return (
    <div className="web-compare-column">
      <p className="web-compare-title">{title}</p>
      {yoursFirst ? mine : null}
      {others}
      {yoursFirst ? null : mine}
    </div>
  );
}
