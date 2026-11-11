import type { Slot } from "./anchors";

/**
 * The shadow roots a **Page button** is drawn into (ADR-0040, T41).
 *
 * **Shadow DOM, so neither stylesheet reaches the other**: Marktplaats's CSS
 * cannot deform the button and ours cannot leak onto their page. Every root gets
 * its own copy of the stylesheet, because a sheet does not cross a shadow
 * boundary.
 *
 * **The geometry is theirs.** The wide button's height, corner, font and width
 * are read off the *Sneller verkopen* button it sits above and handed in as CSS
 * properties, so the two line up whatever Marktplaats sets them to. The colour
 * stays ours, which is the split ADR-0040 records.
 *
 * **One host per Marktplaats control**, and its visibility follows that
 * control's: Marktplaats shows the wide button or the narrow link depending on
 * the screen, and a Page button beside a hidden one would be the only thing left
 * in the cell.
 */
export interface Mount {
  listingId: string;
  variant: "button" | "link";
  /** The element inside the shadow root that React portals into. */
  container: HTMLElement;
}

const HOST_ATTRIBUTE = "data-adbump-page-button";

export class Hosts {
  private readonly byPartner = new Map<HTMLElement, { host: HTMLElement; mount: Mount }>();
  private overlayContainer: HTMLElement | null = null;
  private overlayHost: HTMLElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly css: string,
  ) {}

  /**
   * Draws a host beside every control in `slots`, drops the ones whose control
   * has gone, and answers what is mounted now. Safe to call as often as the page
   * changes: a control that already has its host keeps it, and so keeps
   * whatever its React subtree was showing.
   */
  sync(slots: Slot[]): Mount[] {
    const wanted = new Map<HTMLElement, { listingId: string; variant: Mount["variant"] }>();
    for (const slot of slots) {
      if (slot.desktop) wanted.set(slot.desktop, { listingId: slot.listingId, variant: "button" });
      if (slot.mobile) wanted.set(slot.mobile, { listingId: slot.listingId, variant: "link" });
    }

    for (const [partner, { host }] of this.byPartner) {
      if (!wanted.has(partner) || !partner.isConnected || !host.isConnected) {
        host.remove();
        this.byPartner.delete(partner);
      }
    }

    for (const [partner, { listingId, variant }] of wanted) {
      if (!this.byPartner.has(partner)) this.byPartner.set(partner, this.create(partner, listingId, variant));
    }

    this.measure();
    return [...this.byPartner.values()].map(({ mount }) => mount);
  }

  /** Re-reads the geometry and visibility of every control; for a resize. */
  measure(): void {
    for (const [partner, { host, mount }] of this.byPartner) {
      const shown = partner.offsetParent !== null || partner.getClientRects().length > 0;
      host.style.display = shown ? (mount.variant === "button" ? "block" : "inline-block") : "none";
      if (!shown) continue;
      const style = this.doc.defaultView?.getComputedStyle(partner);
      if (!style) continue;
      host.style.setProperty("--pb-font", style.fontFamily);
      host.style.setProperty("--pb-size", style.fontSize);
      if (mount.variant !== "button") continue;
      host.style.setProperty("--pb-height", style.height);
      host.style.setProperty("--pb-radius", style.borderRadius);
      host.style.setProperty("--pb-weight", style.fontWeight);
      const width = partner.getBoundingClientRect().width;
      if (width > 0) host.style.width = `${width}px`;
    }
  }

  /** One host on `<body>` for what floats: the card and the toast. */
  overlay(): HTMLElement {
    if (this.overlayContainer?.isConnected) return this.overlayContainer;
    const { host, container } = this.shadowHost();
    host.style.cssText = "position:fixed;inset:0;width:0;height:0;z-index:2147483646;";
    this.doc.body.append(host);
    this.overlayHost = host;
    this.overlayContainer = container;
    return container;
  }

  dispose(): void {
    for (const { host } of this.byPartner.values()) host.remove();
    this.byPartner.clear();
    this.overlayHost?.remove();
    this.overlayHost = null;
    this.overlayContainer = null;
  }

  private create(partner: HTMLElement, listingId: string, variant: Mount["variant"]) {
    const { host, container } = this.shadowHost();
    host.setAttribute("data-variant", variant);
    if (variant === "button") {
      host.style.marginBottom = "8px";
      // Above the column the two controls share, rather than inside it: a column
      // laid out as a row would otherwise put the button *beside* the one it is
      // meant to sit on top of.
      const column = partner.parentElement;
      const before = column && column.contains(partner) && column !== this.doc.body ? column : partner;
      before.before(host);
    } else {
      host.style.marginRight = "12px";
      partner.before(host);
    }
    return { host, mount: { listingId, variant, container } };
  }

  private shadowHost(): { host: HTMLElement; container: HTMLElement } {
    const host = this.doc.createElement("span");
    host.setAttribute(HOST_ATTRIBUTE, "");
    const shadow = host.attachShadow({ mode: "open" });
    const style = this.doc.createElement("style");
    style.textContent = this.css;
    const container = this.doc.createElement("div");
    // The light palette, always: Marktplaats is a light page whatever the
    // operating system prefers, and our `:host` rule would otherwise go dark.
    container.setAttribute("data-mp-theme", "light");
    container.className = "pb";
    shadow.append(style, container);
    return { host, container };
  }
}

/** Whether an element is one of ours, so the page's observer can ignore it. */
export function isOurs(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(HOST_ATTRIBUTE);
}
