import type { JSX } from "react";

import type { Slot } from "./anchors";
import { Hosts, isOurs, type Mount } from "./hosts";
import { PageButtons, type PagePort } from "./PageButtons";
import { pageButtonCss } from "./page-styles";

/**
 * Keeping the **Page buttons** in step with a page that redraws itself (T41).
 *
 * Mijn Advertenties is a client-rendered list: paging, searching and Marktplaats's
 * own state changes replace rows without a navigation. A `MutationObserver` on
 * `<body>` re-reads the rows on the next frame after anything changes and
 * re-renders only when the set of mounted buttons did — our own hosts going in
 * would otherwise be a change that causes itself.
 *
 * **Silent degradation**: a page with no recognisable rows gets nothing, and
 * nothing here throws into the page.
 */
export interface Renderer {
  render(element: JSX.Element): void;
  unmount(): void;
}

export class PageButtonsOnPage {
  private hosts: Hosts | null = null;
  private renderer: Renderer | null = null;
  private observer: MutationObserver | null = null;
  private frame: number | null = null;
  private mounts: Mount[] = [];
  private rows = new Map<string, HTMLElement | null>();
  private grants = false;

  constructor(
    private readonly options: {
      doc: Document;
      worker: PagePort;
      findSlots: (root: ParentNode) => Slot[];
      plansUrl: string;
      render: (overlay: HTMLElement) => Renderer;
      refresh: () => void;
    },
  ) {}

  /** Mounts, or re-renders with a new plan if already mounted. */
  start(grantsNothing: boolean): void {
    this.grants = grantsNothing;
    if (this.hosts) return this.draw();
    const { doc } = this.options;
    this.hosts = new Hosts(doc, pageButtonCss);
    // The tree's own container sits inside the overlay rather than being it, so
    // the card and toast it portals into the overlay are siblings of the root
    // and never children React thinks it owns.
    const rootElement = doc.createElement("div");
    this.hosts.overlay().append(rootElement);
    this.renderer = this.options.render(rootElement);
    this.observer = new MutationObserver((records) => {
      if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every(isOurs))) return;
      this.schedule();
    });
    this.observer.observe(doc.body, { childList: true, subtree: true });
    doc.defaultView?.addEventListener("resize", this.onResize);
    this.scan(true);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.options.doc.defaultView?.removeEventListener("resize", this.onResize);
    if (this.frame !== null) this.options.doc.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.renderer?.unmount();
    this.renderer = null;
    this.hosts?.dispose();
    this.hosts = null;
    this.mounts = [];
  }

  /** Re-reads the rows now rather than on the next frame; for the tests. */
  scanNow(): void {
    this.scan(false);
  }

  private readonly onResize = () => this.hosts?.measure();

  private schedule(): void {
    const view = this.options.doc.defaultView;
    if (this.frame !== null || !view) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = null;
      this.scan(false);
    });
  }

  private scan(force: boolean): void {
    if (!this.hosts) return;
    let slots: Slot[] = [];
    try {
      slots = this.options.findSlots(this.options.doc);
    } catch {
      slots = [];
    }
    const mounts = this.hosts.sync(slots);
    this.rows = new Map(slots.map((slot) => [slot.listingId, slot.row]));
    if (!force && sameMounts(mounts, this.mounts)) return;
    this.mounts = mounts;
    this.draw();
  }

  private draw(): void {
    if (!this.renderer || !this.hosts) return;
    this.renderer.render(
      <PageButtons
        worker={this.options.worker}
        mounts={this.mounts}
        overlay={this.hosts.overlay()}
        rowOf={this.rowOf}
        grantsNothing={this.grants}
        plansUrl={this.options.plansUrl}
        onRefresh={this.options.refresh}
      />,
    );
  }

  private readonly rowOf = (listingId: string) => this.rows.get(listingId) ?? null;
}

function sameMounts(a: Mount[], b: Mount[]): boolean {
  return a.length === b.length && a.every((mount, i) => mount.container === b[i]?.container);
}
