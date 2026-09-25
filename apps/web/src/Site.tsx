import { Icon, UiStyles } from "@mprelist/ui";
import type { JSX } from "react";

import { BRAND } from "./brand";
import { Landing } from "./public/landing";
import { PrivacyPage, TermsPage } from "./public/legal";
import { BillingPage, CancelPage, NotFoundPage, SuccessPage } from "./public/pages";
import type { LoadPlans } from "./public/plans-on-offer";
import { PATHS, pageFor, type Page } from "./routes";
import { siteCss } from "./site-styles";

/**
 * The frame every page of this site is drawn in, and the switch that picks one
 * (T50, #81).
 *
 * A function of its props and nothing else — the path is handed in rather than
 * read off `location`, so what the site shows at a URL can be asserted without a
 * browser. `main.tsx` is the only file here that touches the document.
 *
 * **The Privacy and Terms links arrived with the pages they point at** (T36, #45),
 * which is why T50 shipped without them: a link to an address this site answers
 * with "there's nothing here" is worse than a link that arrives with its page.
 * They are in the header and the footer on every page, as the canvas draws them,
 * and the one you are reading is marked rather than repeated as a link to itself.
 *
 * **The landing page is the one page not in the card** (T58): it is the whole
 * window, and its header lies on top of its hero. The header, footer and
 * disclaimer are the same elements either way; only what holds them differs.
 *
 * **`loadPlans` is the one thing the landing page asks after it is drawn** (T58):
 * `GET /api/plans`, with no token. Handed in rather than called here, so this stays
 * a function of its props and `main.tsx` stays the only file that knows where the
 * API is.
 */
export function Site({
  pathname,
  year,
  loadPlans,
}: {
  pathname: string;
  year: number;
  loadPlans: LoadPlans;
}): JSX.Element {
  const showing = pageFor(pathname);
  const wide = showing === "landing";
  const frame = (
    <>
      <header className={wide ? "web-header web-header--over" : "web-header"}>
        <span className="web-brand">
          <span className="mp-mark web-mark">
            <Icon name="logo" />
          </span>
          {BRAND.name}
        </span>
        <nav className="web-nav">
          <DocumentLink to="privacy" showing={showing} />
          <DocumentLink to="terms" showing={showing} />
        </nav>
      </header>
      <main className={wide ? "web-page web-page--landing" : "web-page"}>
        {page(showing, loadPlans)}
      </main>
      <footer className="web-footer">
        <span>
          © {year} {BRAND.name}
        </span>
        <span className="web-footer-links">
          <a href={PATHS.privacy}>Privacy</a> · <a href={PATHS.terms}>Voorwaarden</a> ·{" "}
          <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
        </span>
      </footer>
      {/* The landing page's last line, under the footer where the artboard puts it:
          the Web Store's Impersonation policy expects it of a listing that uses
          somebody else's name, and this page is where that listing points. */}
      {wide ? (
        <p className="web-disclaimer">
          {BRAND.name} is een onafhankelijk product en is niet gelieerd aan Marktplaats.
        </p>
      ) : null}
    </>
  );
  return (
    <div className={wide ? "mp-root web-stage web-stage--wide" : "mp-root web-stage"}>
      {/* The design system's sheet first, this surface's rules second: the stage
          is a background `.mp-root` also sets, and later wins at equal weight. */}
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: siteCss }} />
      {/* The landing page is the whole window, with its header lying on the hero;
          every other page is one card on the stage (T58). */}
      {wide ? frame : <div className="web-card">{frame}</div>}
    </div>
  );
}

/**
 * One header link, and the page you are on is not one.
 *
 * `aria-current="page"` rather than a class of its own: it is what a screen reader
 * reads out, and the stylesheet can hang the canvas's emphasis off the same
 * attribute rather than off a second spelling of the same fact. It stays a link —
 * a nav that dropped the current entry would move the other one as you navigate.
 */
function DocumentLink({ to, showing }: { to: "privacy" | "terms"; showing: Page }): JSX.Element {
  return (
    <a href={PATHS[to]} aria-current={showing === to ? "page" : undefined}>
      {to === "privacy" ? "Privacy" : "Voorwaarden"}
    </a>
  );
}

/** Total over the route table, so a page added there without one here does not compile. */
function page(name: Page, loadPlans: LoadPlans): JSX.Element {
  switch (name) {
    case "landing":
      return <Landing loadPlans={loadPlans} />;
    case "privacy":
      return <PrivacyPage />;
    case "terms":
      return <TermsPage />;
    case "success":
      return <SuccessPage />;
    case "cancel":
      return <CancelPage />;
    case "billing":
      return <BillingPage />;
    case "not-found":
      return <NotFoundPage />;
  }
}
