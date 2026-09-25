import { Badge, Button, Icon } from "@mprelist/ui";
import type { JSX, ReactNode } from "react";

import { BRAND } from "../brand";
import { ADMIN_PAGES, adminPage, navGroups, type AdminPageId } from "./admin-nav";

/**
 * The frame every admin page is drawn in: a sidebar that says where you are, and a
 * column that holds one page.
 *
 * <h2>Why a sidebar rather than a wider page</h2>
 *
 * Before this the admin corner was a single scroll of two stacked cards with a
 * brand bar over them — which reads as one long document, and a document has no
 * room for a second subject. The moment there is more than one thing an operator
 * comes here to do, the question "where am I, and what else is there?" has to have
 * an answer on screen; a sidebar is that answer, and it is the same answer at
 * two pages as at ten.
 *
 * <h2>The page decides nothing about its own chrome</h2>
 *
 * Title, lede and the words in the sidebar all come from `admin-nav.ts`, so a page
 * is a body and a set of actions and nothing else. That is what stops the second
 * page from being a second design: there is no place for it to spell a heading
 * differently, because it does not spell one.
 *
 * <h2>Sticky the whole height, and a row on a narrow window</h2>
 *
 * The catalog is the one thing here that grows without limit, so the sidebar is
 * `position: sticky` at full height — an operator who has scrolled to the tier
 * they want can still see where they are and still sign out. Under 900px it stops
 * being a column and becomes a strip of nav across the top, which needs no toggle,
 * no state and no button that can be left in the wrong position.
 */
export function AdminShell({
  page,
  onNavigate,
  role,
  onSignOut,
  actions,
  children,
}: {
  page: AdminPageId;
  onNavigate: (page: AdminPageId) => void;
  /** The realm role this session carries, which is the whole of what we know about who is here. */
  role: string;
  onSignOut: () => void;
  /** The page's own primary action, beside its heading. */
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const current = adminPage(page);
  // A heading over a single word is a label for nothing. It comes back with the
  // page that makes the list worth grouping.
  const grouped = ADMIN_PAGES.length > 1;
  return (
    <div className="mp-root admin-app">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <span className="admin-brand">
            <span className="mp-mark admin-mark">
              <Icon name="site-logo" />
            </span>
            <span className="web-wordmark">{BRAND.name}</span>
            {/* What this build *is*, rather than part of the product's name. */}
            <span className="admin-brand-tag">admin</span>
          </span>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          {navGroups().map(({ group, pages }) => (
            <div className="admin-nav-group" key={group}>
              {grouped ? <p className="admin-nav-heading">{group}</p> : null}
              {pages.map((entry) => {
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="admin-nav-item"
                    // The state *and* the announcement in one attribute: a screen
                    // reader says "current page", and the rule that tints it reads
                    // the same thing rather than a class kept in step by hand.
                    aria-current={entry.id === page ? "page" : undefined}
                    onClick={() => onNavigate(entry.id)}
                  >
                    <span className="admin-nav-glyph">
                      <Icon name={entry.icon} size={16} />
                    </span>
                    <span className="admin-nav-label">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <span className="admin-who">
            <span className="admin-who-label">Signed in</span>
            {/* No name and no address: this client asks for `openid` and nothing
                more (#108), so the role is honestly all this page knows. */}
            <span className="admin-who-role">
              <Badge tone="accent">{role}</Badge>
            </span>
          </span>
          <Button shape="rect" tone="secondary" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-page">
          <header className="admin-page-head">
            <div className="admin-page-headings">
              <h1>{current.title}</h1>
              <p className="admin-page-lede">{current.lede}</p>
            </div>
            {actions ? <div className="admin-page-actions">{actions}</div> : null}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
