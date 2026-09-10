import { Icon, UiStyles } from "@mprelist/ui";
import type { JSX } from "react";

import { BRAND } from "./brand";
import { PrivacyPage, TermsPage } from "./public/legal";
import { BillingPage, CancelPage, NotFoundPage, SuccessPage } from "./public/pages";
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
 */
export function Site({ pathname, year }: { pathname: string; year: number }): JSX.Element {
  const showing = pageFor(pathname);
  return (
    <div className="mp-root web-stage">
      {/* The design system's sheet first, this surface's rules second: the stage
          is a background `.mp-root` also sets, and later wins at equal weight. */}
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: siteCss }} />
      <div className="web-card">
        <header className="web-header">
          <span className="web-brand">
            <span className="web-mark">
              <Icon name="logo" />
            </span>
            {BRAND.name}
          </span>
          <nav className="web-nav">
            <DocumentLink to="privacy" showing={showing} />
            <DocumentLink to="terms" showing={showing} />
          </nav>
        </header>
        <main className="web-page">{page(showing)}</main>
        <footer className="web-footer">
          <span>
            © {year} {BRAND.name}
          </span>
          <span className="web-footer-links">
            <a href={PATHS.privacy}>Privacy</a> · <a href={PATHS.terms}>Voorwaarden</a> ·{" "}
            <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
          </span>
        </footer>
      </div>
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
function page(name: Page): JSX.Element {
  switch (name) {
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
