import { Icon } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX } from "react";

import { BRAND } from "../brand";
import { PlanSection } from "./plan-cards";
import type { LoadPlans, PlansOnOffer } from "./plans-on-offer";
import { STORE_URL } from "./store";
import { NOBODY, type Account } from "./viewer";

export { largestOf } from "./plan-cards";
export { STORE_URL } from "./store";

/**
 * The landing page at `/` (T58, #89), which the Web Store listing names as the
 * homepage. The whole window rather than the card every other page is: a hero in
 * the mark's gradient that fills the first screen, the three steps, the plans, and
 * the install button again at the bottom.
 *
 * **The words are fewer than the listing's, and claim nothing it does not.**
 * `store/listing.md` is written for a reviewer and says everything; this page is
 * where a visitor decides, and says the least that gets them there. Each line here
 * is something the listing already says — and the listing's rules hold of every
 * one: Marktplaats is named as somebody else's, and none of the words that imply
 * its approval appear. What the listing's "Goed om te weten" covers — that a
 * repost deletes first, what reaches us — is in the Terms and the Privacy page,
 * which the header links on this page as on every other.
 *
 * **The plans are sold from here too** (T85, ADR-0036). `GET /api/plans` is asked
 * with no token, and the wording comes from `@mprelist/contracts` rather than a
 * second copy; who is looking, and what each button does for them, comes in as an
 * `Account` from `src/account/`, so nothing in this file learns it by itself.
 *
 * `docs/design/Landing.dc.html` still draws the page this replaced. This one was
 * built first and the artboard is redrawn from it; `docs/design/README.md` says so.
 */


/**
 * The page, holding the one thing it learns after it is drawn: what is on sale.
 * `loadPlans` is handed in, so what is asked and when can be driven by a test.
 */
export function Landing({
  loadPlans,
  account = NOBODY,
}: {
  loadPlans: LoadPlans;
  account?: Account;
}): JSX.Element {
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

  return <LandingPage plans={plans} onRetry={ask} account={account} />;
}

/** The page as a function of what the plans question has answered so far. */
export function LandingPage({
  plans,
  onRetry,
  account = NOBODY,
}: {
  plans: PlansOnOffer | "loading";
  onRetry: () => void;
  account?: Account;
}): JSX.Element {
  return (
    <>
      <section className="web-hero">
        <div>
          <h1 className="web-hero-title">Zet je advertentie weer bovenaan</h1>
          <p className="web-hero-copy">
            Herplaats hem vanuit je browser, met alle tekst en foto’s.
          </p>
          <Install />
          <p className="web-hero-micro">Gratis te installeren · werkt in Chrome</p>
        </div>
        <Repost />
        <a className="web-scroll" href="#zo-werkt-het" aria-label="Verder naar Zo werkt het" />
      </section>

      <section className="web-band" id="zo-werkt-het">
        <h2 className="web-band-title">Zo werkt het</h2>
        <ol className="web-steps">
          <li>
            <span className="web-step-title">Open Marktplaats</span>
            <span className="web-step-copy">En log in zoals je gewend bent.</span>
          </li>
          <li>
            <span className="web-step-title">Log in bij {BRAND.name}</span>
            <span className="web-step-copy">Via het icoon in je werkbalk.</span>
          </li>
          <li>
            <span className="web-step-title">
              Klik op <b>Herplaats</b>
            </span>
            <span className="web-step-copy">Je advertentie staat weer bovenaan.</span>
          </li>
        </ol>
      </section>

      <section className="web-band web-band--subtle" id="abonnementen">
        <h2 className="web-band-title">Abonnementen</h2>
        <p className="web-band-copy">Begin gratis, of kies een abonnement als je vaker wilt herplaatsen.</p>
        <PlanSection plans={plans} onRetry={onRetry} account={account} installUrl={STORE_URL} />
      </section>

      <section className="web-band web-closing">
        <h2 className="web-band-title">Begin gratis</h2>
        <Install />
        <p className="web-hero-micro">Werkt in Chrome</p>
      </section>
    </>
  );
}

/**
 * Where the extension is had: the Store listing, twice on the page — once at the
 * top and once at the end of it — and both the same element.
 */
function Install(): JSX.Element {
  return (
    <a className="mp-btn mp-btn--primary web-install" href={STORE_URL}>
      Toevoegen aan Chrome
      <Icon name="external" />
    </a>
  );
}

/**
 * Where a reposted ad lands, shown rather than said: four recent ads, the visitor's
 * sinking to the bottom and rising back to the top. The motion is all in
 * `site-styles.ts`; the markup is the still frame — the rows in their "after"
 * order, with each "before" word beside its "after" one and hidden — which is what
 * a visitor who asked for reduced motion sees.
 *
 * No Marktplaats styling: the rows are this product's own tokens, so nothing here
 * dresses up as their site.
 */
function Repost(): JSX.Element {
  return (
    <div className="web-repost" aria-hidden="true">
      <p className="web-repost-caption">
        <Swap before="Na een paar dagen" after="Na herplaatsen" />
      </p>
      <div className="web-repost-list">
        <div className="web-repost-row web-repost-row--yours">
          <span className="web-repost-thumb" />
          <span>
            <b>Jouw fiets</b> · <Swap before="5 dagen" after="zojuist" />
          </span>
          <span className="web-repost-top web-after">Bovenaan</span>
        </div>
        {["vandaag", "gisteren", "2 dagen"].map((when) => (
          <div key={when} className="web-repost-row">
            <span className="web-repost-thumb" />
            <span>Nieuw geplaatst · {when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One place, two words: the one the loop starts on, and the one it lands on. */
function Swap({ before, after }: { before: string; after: string }): JSX.Element {
  return (
    <span className="web-swap">
      <span className="web-before">{before}</span>
      <span className="web-after">{after}</span>
    </span>
  );
}
