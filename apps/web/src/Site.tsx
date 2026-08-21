import { Icon, UiStyles } from "@mprelist/ui";
import type { JSX } from "react";

import { BRAND } from "./brand";
import { CancelPage, NotFoundPage, SuccessPage } from "./public/pages";
import { pageFor, type Page } from "./routes";
import { siteCss } from "./site-styles";

/**
 * The frame every page of this site is drawn in, and the switch that picks one
 * (T50, #81).
 *
 * A function of its props and nothing else — the path is handed in rather than
 * read off `location`, so what the site shows at a URL can be asserted without a
 * browser. `main.tsx` is the only file here that touches the document.
 *
 * **The header carries no Privacy and Terms links yet**, though the canvas draws
 * them in both the header and the footer. Those pages are T36 (#45); a link to an
 * address this site answers with "there's nothing here" is worse than a link that
 * arrives with the page it points at. The footer's support address is real today
 * and is there.
 */
export function Site({ pathname, year }: { pathname: string; year: number }): JSX.Element {
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
        </header>
        <main className="web-page">{page(pageFor(pathname))}</main>
        <footer className="web-footer">
          <span>
            © {year} {BRAND.name}
          </span>
          <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
        </footer>
      </div>
    </div>
  );
}

/** Total over the route table, so a page added there without one here does not compile. */
function page(name: Page): JSX.Element {
  switch (name) {
    case "success":
      return <SuccessPage />;
    case "cancel":
      return <CancelPage />;
    case "not-found":
      return <NotFoundPage />;
  }
}
