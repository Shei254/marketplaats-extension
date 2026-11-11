import { Icon, Spinner } from "@mprelist/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import type { WireRelistOutcome } from "../background/messages";
import type { PendingRepost } from "../domain/types";
import type { LockedState } from "../gate/authorization-gate";
import { useCountdown } from "../popup/AdList";
import {
  AD_UNCHANGED,
  BUSY,
  IDLE,
  PACING_NOTE,
  UNCONFIRMED,
  labelFor,
  refusalNote,
  rowStateFor,
  toneFor,
  tooltipFor,
  type RowState,
} from "../popup/relisting";
import type { WorkerPort } from "../popup/screen";
import type { Mount } from "./hosts";

/**
 * Every **Page button** on Mijn Advertenties, as one React tree (ADR-0040, T42).
 *
 * **One tree, many portals**, because the lock is a property of the list and not
 * of a row — the popup's `AdList` makes the same argument — and the buttons are
 * in a dozen shadow roots. Each portal is a view onto the one state here.
 *
 * **What it does is the popup's row, word for word**: the same `relist` to the
 * same worker, the same labels and hover text (`relisting.ts`), one repost at a
 * time across both surfaces (the worker's `relistStatus`), a cooldown counted
 * down on every button. What it adds is what a row on someone else's page has to
 * say for itself, since there is no popup header above it: a card under the
 * button with the refusal's sentence and at most one action, a faded row and a
 * *Vernieuwen* toast once its ad has gone back to the top, and a pending repost
 * shown but never let go — *Niet terugzetten* stays in the popup.
 */
export type PagePort = Pick<
  WorkerPort,
  "relist" | "retry" | "pendingReposts" | "msBeforeNextRelist" | "relistStatus" | "portal"
>;

/** What the card says, and the one thing it offers. */
type CardAction =
  | { kind: "plans"; label: string }
  | { kind: "portal"; label: string }
  | { kind: "again"; label: string }
  /** Put the ad back from its snapshot — the worker's `retry`, the popup's Opnieuw. */
  | { kind: "resume"; label: string }
  | null;

interface CardView {
  tone: "info" | "warn" | "error";
  text: string;
  action: CardAction;
}

/** The sentence a repost that deleted the ad and could not put it back says here. */
export const PUTTING_BACK =
  "Er ging iets mis tijdens het herplaatsen. We zetten je advertentie automatisch terug. " +
  "Je kunt het hier opnieuw proberen; laten gaan kan in de extensie.";

/** A pending repost the background has stopped retrying (`needsUser`). */
export const NEEDS_YOU =
  "Dit lukt niet vanzelf. Probeer het opnieuw; laten gaan kan in de extensie.";

/** What a waiting row is told when the worker turns out never to have deleted it. */
export const SETTLED_UNCHANGED = AD_UNCHANGED;

/**
 * What a waiting row is told when the background settled it before the page ever
 * saw it pending, so there is no `deleted` to read: the page claims neither.
 */
export const SETTLED_UNSEEN =
  "De extensie heeft deze herplaatsing afgerond. Vernieuw de pagina om te zien hoe het ging.";

/** How often the page asks what the worker still holds, while a row waits on it. */
export const PENDING_CHECK_MS = 5_000;

const RESUME: CardAction = { kind: "resume", label: "Opnieuw" };

export const PUTTING_BACK_LABEL = "Wordt teruggezet";
export const TOAST_TEXT = "Advertentie staat weer bovenaan";
export const REFRESH = "Vernieuwen";
/**
 * The busy label on the page. The popup's *Bezig met herplaatsen…* is wider than
 * the cell Marktplaats gives the button (~170px), so it spilled over both edges
 * and pushed the spinner out of sight; the hover text still says it in full.
 */
export const BUSY_LABEL = "Herplaatsen…";

export function PageButtons({
  worker,
  mounts,
  overlay,
  rowOf,
  grantsNothing,
  plansUrl,
  onRefresh,
}: {
  worker: PagePort;
  mounts: Mount[];
  overlay: HTMLElement;
  /** The row a listing is drawn in, so a reposted one can fade. */
  rowOf: (listingId: string) => HTMLElement | null;
  /** The plan grants no reposts at all — the one lock known before a click (T32). */
  grantsNothing: boolean;
  plansUrl: string;
  onRefresh: () => void;
}): JSX.Element {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [remote, setRemote] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const secondsLeft = useCountdown(cooldownUntil, () => setCooldownUntil(null));
  const [pacingUntil, setPacingUntil] = useState<number | null>(null);
  const pacingSeconds = useCountdown(pacingUntil, () => setPacingUntil(null));
  const [card, setCard] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  /** Waiting rows the background has handed back to the user (`needsUser`). */
  const [needsYou, setNeedsYou] = useState<Record<string, boolean>>({});
  /** A sentence a row's card says instead of its state's, once a wait settles. */
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** The last time each waiting row was seen in the worker's pending list. */
  const lastSeen = useRef(new Map<string, PendingRepost>());
  const anchors = useRef(new Map<string, HTMLButtonElement>());

  // Who holds the worker's one slot, asked once now, again whenever the tab
  // comes back into view (the popup may have started one meanwhile), and every
  // two seconds while somebody does — the popup's own rhythm.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      clearTimeout(timer);
      const active = await worker.relistStatus().catch(() => null);
      if (!alive) return;
      setRemote(active);
      if (active !== null) timer = setTimeout(() => void check(), 2_000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [worker]);

  const start = useCallback(
    async (listingId: string, via: "relist" | "retry" = "relist") => {
      setCard(null);
      setRunning(listingId);
      setStates((current) => ({ ...current, [listingId]: { kind: "busy" } }));
      setNeedsYou(({ [listingId]: _, ...rest }) => rest);
      setNotes(({ [listingId]: _, ...rest }) => rest);
      // Only a fresh relist is paced, as in the popup: a retry puts back an ad
      // that is already deleted, which is recovery and waits for nothing.
      if (via === "relist") {
        const waitMs = await worker.msBeforeNextRelist().catch(() => 0);
        if (waitMs > 0) setPacingUntil(Date.now() + waitMs);
      }

      let state: RowState;
      try {
        const outcome: WireRelistOutcome =
          via === "relist" ? await worker.relist(listingId) : await worker.retry(listingId);
        state = rowStateFor(outcome);
      } catch (error) {
        state = {
          kind: "failed",
          tone: "error",
          action: "relist",
          message: `Er is niets herplaatst. ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      setStates((current) => ({ ...current, [listingId]: state }));
      setRunning(null);
      setPacingUntil(null);
      if (state.kind === "refused" && state.locked.state === "cooldown") {
        setCooldownUntil(Date.now() + (state.locked.retryAfter ?? 0) * 1000);
      } else if (state.kind === "done") {
        setToast(true);
      } else if (cardFor(state, grantsNothing) !== null) {
        setCard(listingId);
      }
    },
    [worker, grantsNothing],
  );

  // Rows waiting on the background: one the worker could not confirm, and one it
  // is putting back after a failed create. While there are any, ask the worker
  // what it still holds — straight away when a row starts waiting, since the
  // background's first quick retry comes two seconds after a failure, and every
  // few seconds after — and stop asking once there are none.
  const waiting = Object.entries(states)
    .filter(([, state]) => state.kind === "parked" || (state.kind === "failed" && state.action === "retry"))
    .map(([listingId]) => listingId)
    .sort()
    .join(" ");
  const [checked, setChecked] = useState(0);
  const askedFor = useRef("");
  useEffect(() => {
    if (waiting === "") {
      askedFor.current = "";
      return;
    }
    const ids = waiting.split(" ");
    const delay = askedFor.current === waiting ? PENDING_CHECK_MS : 0;
    askedFor.current = waiting;
    let alive = true;
    const timer = setTimeout(async () => {
      const held = await worker.pendingReposts().catch(() => null);
      if (!alive) return;
      for (const listingId of held === null ? [] : ids) {
        const entry = held!.find((repost) => repost.listingId === listingId);
        if (!entry) {
          settle(listingId);
          continue;
        }
        lastSeen.current.set(listingId, entry);
        if (entry.needsUser) {
          setNeedsYou((current) => (current[listingId] ? current : { ...current, [listingId]: true }));
          setCard((open) => open ?? listingId);
        }
      }
      setChecked((n) => n + 1);
    }, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };

    /**
     * The worker holds no snapshot for this row any more, so the background
     * settled it, and `deleted` as last seen says which way. Seen deleted: the ad
     * was put back. Seen not deleted: the delete never ran and the repost was
     * cancelled — the ad is as it was. Never seen: it settled before the first
     * check, and the page says neither. (A deleted one let go in the popup also
     * reads as put back; ADR-0040 keeps letting go there, and the popup is where
     * it was done.)
     */
    function settle(listingId: string) {
      const last = lastSeen.current.get(listingId);
      lastSeen.current.delete(listingId);
      setNeedsYou(({ [listingId]: _, ...rest }) => rest);
      if (last?.deleted) {
        setStates((current) => ({ ...current, [listingId]: { kind: "done" } }));
        setCard((open) => (open === listingId ? null : open));
        setToast(true);
        return;
      }
      setStates((current) => ({ ...current, [listingId]: IDLE }));
      setNotes((current) => ({ ...current, [listingId]: last ? SETTLED_UNCHANGED : SETTLED_UNSEEN }));
      setCard((open) => open ?? listingId);
    }
  }, [waiting, checked, worker]);

  // A reposted ad's row is the old ad: it fades, so it reads as finished, and
  // stays where it is until the seller refreshes.
  useEffect(() => {
    for (const [listingId, state] of Object.entries(states)) {
      if (state.kind !== "done") continue;
      const row = rowOf(listingId);
      if (row && row.style.opacity !== "0.5") {
        row.style.transition = "opacity 300ms ease";
        row.style.opacity = "0.5";
      }
    }
  }, [states, rowOf, mounts]);

  const press = (listingId: string) => {
    const state = states[listingId] ?? IDLE;
    if (notes[listingId]) {
      setNotes(({ [listingId]: _, ...rest }) => rest);
      return void start(listingId);
    }
    if (state.kind === "idle" && grantsNothing) return setCard((open) => (open === listingId ? null : listingId));
    if (state.kind === "idle" || (state.kind === "failed" && state.action === "relist")) return void start(listingId);
    setCard((open) => (open === listingId ? null : listingId));
  };

  const act = (listingId: string, action: NonNullable<CardAction>) => {
    if (action.kind === "again") return void start(listingId);
    if (action.kind === "resume") return void start(listingId, "retry");
    if (action.kind === "portal") void worker.portal();
    setCard(null);
  };

  const anchorOfCard = useCallback(() => (card === null ? null : visibleAnchor(anchors.current, card)), [card]);
  const closeCard = useCallback(() => setCard(null), []);
  const cardState = card === null ? null : (states[card] ?? IDLE);
  const cardView =
    card === null || cardState === null
      ? null
      : notes[card]
        ? { tone: "info" as const, text: notes[card]!, action: null }
        : needsYou[card] && cardState.kind === "parked"
          ? { tone: "warn" as const, text: NEEDS_YOU, action: RESUME }
          : cardFor(cardState, grantsNothing);

  return (
    <>
      {mounts.map((mount) => {
        const own = states[mount.listingId] ?? IDLE;
        // The worker's slot, whoever took it: this page or the popup. A repost the
        // popup is running on this very ad draws as busy here too.
        const holder = running ?? remote;
        const state: RowState = own.kind === "idle" && holder === mount.listingId ? { kind: "busy" } : own;
        const elsewhere = holder !== null && holder !== mount.listingId;
        const view = viewFor({
          state,
          needsYou: needsYou[mount.listingId] === true && state.kind === "parked",
          elsewhere,
          grantsNothing,
          cooldown: state.kind === "idle" ? secondsLeft : null,
          pacing: running === mount.listingId ? pacingSeconds : null,
          title: titleOf(mount),
        });
        return createPortal(
          <PageButton
            variant={mount.variant}
            view={view}
            expanded={card === mount.listingId}
            buttonRef={(element) => {
              const key = `${mount.listingId}:${mount.variant}`;
              if (element) anchors.current.set(key, element);
              else anchors.current.delete(key);
            }}
            onPress={() => press(mount.listingId)}
          />,
          mount.container,
          `${mount.listingId}:${mount.variant}`,
        );
      })}
      {createPortal(
        <>
          {card !== null && cardView && (
            <Card
              view={cardView}
              anchor={anchorOfCard}
              plansUrl={plansUrl}
              onAction={(action) => act(card, action)}
              onClose={closeCard}
            />
          )}
          {toast && <Toast onRefresh={onRefresh} onClose={() => setToast(false)} />}
        </>,
        overlay,
      )}
    </>
  );
}

interface ButtonView {
  tone: "idle" | "busy" | "done" | "retry" | "locked" | "cooldown";
  label: string;
  title: string;
  disabled: boolean;
  count: boolean;
}

/**
 * How one button looks, from the row's state and what the rest of the page is
 * doing. Exported for the tests: it is the whole of the button's behaviour that
 * is not a click.
 */
export function viewFor({
  state,
  needsYou = false,
  elsewhere,
  grantsNothing,
  cooldown,
  pacing,
  title,
}: {
  state: RowState;
  /** A waiting repost the background has handed back to the user. */
  needsYou?: boolean;
  /** Another repost holds the worker's slot, from this page or the popup. */
  elsewhere: boolean;
  grantsNothing: boolean;
  /** Seconds left on the account's cooldown, or null. */
  cooldown: number | null;
  /** Seconds the worker is pacing this row's repost by, or null. */
  pacing: number | null;
  title: string;
}): ButtonView {
  if (state.kind === "busy" && pacing !== null) {
    return { tone: "busy", label: `Over ${pacing}s`, title: PACING_NOTE, disabled: true, count: true };
  }
  if (state.kind === "idle" && cooldown !== null) {
    return { tone: "cooldown", label: `Over ${cooldown}s`, title: refusalNote({ state: "cooldown", retryAfter: cooldown }, false), disabled: true, count: true };
  }
  if (state.kind === "failed" && state.action === "retry") {
    return { tone: "retry", label: PUTTING_BACK_LABEL, title: PUTTING_BACK, disabled: false, count: false };
  }
  if (needsYou) {
    return { tone: "retry", label: "Opnieuw", title: NEEDS_YOU, disabled: false, count: false };
  }
  if (state.kind === "idle" && grantsNothing) {
    return { tone: "locked", label: labelFor(state), title: refusalNote({ state: "upgrade", resetAt: null }, true), disabled: false, count: false };
  }
  if (state.kind === "idle" && elsewhere) {
    return { tone: "locked", label: labelFor(state), title: BUSY, disabled: true, count: false };
  }
  const tone = toneFor(state, false);
  return {
    tone: tone === "primary" ? "idle" : tone,
    label: state.kind === "busy" ? BUSY_LABEL : labelFor(state),
    title: tooltipFor(state, title),
    // Busy and done are finished with; every other state is pressable, and the
    // ones that are not a fresh attempt open the card that says why.
    disabled: state.kind === "busy" || state.kind === "done",
    count: false,
  };
}

/**
 * What the card under a button says, or null when there is nothing to say. Only
 * `refusalNote`'s sentence for a refusal, so the popup and the page never give
 * one refusal two wordings; and at most one action, the one thing that changes
 * the answer.
 */
export function cardFor(state: RowState, grantsNothing: boolean): CardView | null {
  switch (state.kind) {
    case "idle":
      return grantsNothing
        ? { tone: "info", text: refusalNote({ state: "upgrade", resetAt: null }, true), action: PLANS }
        : null;
    case "refused":
      if (state.locked.state === "cooldown") return null;
      return { tone: "info", text: refusalNote(state.locked, grantsNothing), action: actionFor(state.locked) };
    case "failed":
      return state.action === "retry"
        ? { tone: "warn", text: PUTTING_BACK, action: RESUME }
        : { tone: "error", text: state.message, action: { kind: "again", label: "Opnieuw proberen" } };
    case "parked":
      return { tone: "info", text: UNCONFIRMED, action: null };
    case "waiting":
      return { tone: "info", text: BUSY, action: null };
    case "busy":
    case "done":
      return null;
  }
}

const PLANS: CardAction = { kind: "plans", label: "Bekijk abonnementen" };

function actionFor(locked: LockedState): CardAction {
  switch (locked.state) {
    case "upgrade":
    case "no-tier":
    case "not-in-plan":
      return PLANS;
    case "update-card":
      return { kind: "portal", label: "Betaling bijwerken" };
    case "retry":
      return { kind: "again", label: "Opnieuw proberen" };
    case "cooldown":
      return null;
  }
}

function titleOf(mount: Mount): string {
  // The ad's title is the row's, which the page has and we do not: the image's
  // alt text and the title link both carry it.
  const host = (mount.container.getRootNode() as ShadowRoot).host;
  const row = host.closest(".cells") ?? host.closest("li, tr, article");
  const link = row?.querySelector<HTMLElement>(".description-column a, a[href*='/seller/view/']");
  return link?.textContent?.trim() || "deze advertentie";
}

function visibleAnchor(anchors: Map<string, HTMLButtonElement>, listingId: string): HTMLButtonElement | null {
  for (const variant of ["button", "link"] as const) {
    const element = anchors.get(`${listingId}:${variant}`);
    if (element && element.getClientRects().length > 0) return element;
  }
  return null;
}

/** Keep the page's own row handlers from seeing a click that was ours. */
const ours = (event: MouseEvent) => event.stopPropagation();

function PageButton({
  variant,
  view,
  expanded,
  buttonRef,
  onPress,
}: {
  variant: Mount["variant"];
  view: ButtonView;
  expanded: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onPress: () => void;
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={variant === "button" ? "pb-btn" : "pb-link"}
      data-tone={view.tone}
      title={view.title}
      aria-label={view.title}
      aria-expanded={expanded || undefined}
      disabled={view.disabled}
      onClick={(event) => {
        ours(event);
        onPress();
      }}
    >
      <Glyph tone={view.tone} />
      <span className={view.count ? "pb-label pb-count" : "pb-label"}>{view.label}</span>
    </button>
  );
}

function Glyph({ tone }: { tone: ButtonView["tone"] }): JSX.Element {
  switch (tone) {
    case "busy":
      return <Spinner />;
    case "done":
      return <Icon name="check" />;
    case "cooldown":
      return <Icon name="clock" />;
    case "locked":
      return <Icon name="lock" />;
    case "retry":
      return <Icon name="warning" />;
    case "idle":
      return (
        <span className="pb-mark" aria-hidden="true">
          <Icon name="logo" />
        </span>
      );
  }
}

const CARD_WIDTH = 304;
const GUTTER = 16;

function Card({
  view,
  anchor,
  plansUrl,
  onAction,
  onClose,
}: {
  view: CardView;
  anchor: () => HTMLElement | null;
  plansUrl: string;
  onAction: (action: NonNullable<CardAction>) => void;
  onClose: () => void;
}): JSX.Element {
  const [place, setPlace] = useState<{ top: number; left: number; caret: number; above: boolean } | null>(null);
  const self = useRef<HTMLDivElement>(null);

  // Fixed to the viewport and re-placed on every scroll and resize, because the
  // row it is about lives in Marktplaats's layout and ours lives on <body>.
  useLayoutEffect(() => {
    const placeIt = () => {
      const rect = anchor()?.getBoundingClientRect();
      if (!rect) return setPlace(null);
      const centre = rect.left + rect.width / 2;
      const left = Math.min(Math.max(centre - CARD_WIDTH / 2, GUTTER), window.innerWidth - CARD_WIDTH - GUTTER);
      // Below the button, unless the viewport ends first: then above it, so the
      // card is never cut off at the foot of the window.
      const height = self.current?.offsetHeight ?? 160;
      const above = rect.bottom + 10 + height > window.innerHeight - GUTTER && rect.top - 10 - height > GUTTER;
      setPlace({ top: above ? rect.top - 10 - height : rect.bottom + 10, left, caret: centre - left, above });
    };
    placeIt();
    window.addEventListener("scroll", placeIt, true);
    window.addEventListener("resize", placeIt);
    return () => {
      window.removeEventListener("scroll", placeIt, true);
      window.removeEventListener("resize", placeIt);
    };
  }, [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onDown = (event: PointerEvent) => {
      const path = event.composedPath();
      const button = anchor();
      if (self.current && !path.includes(self.current) && !(button && path.includes(button))) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={self}
      className="pb-card"
      data-above={place?.above || undefined}
      role="dialog"
      aria-label={view.text}
      // Drawn hidden until placed, so its height can be measured before it is
      // decided which side of the button it goes.
      style={
        place
          ? { top: place.top, left: place.left, ["--pb-caret" as string]: `${place.caret}px` }
          : { top: 0, left: 0, visibility: "hidden" }
      }
      onClick={ours}
    >
      <div className="pb-card-head" data-tone={view.tone}>
        <span className="pb-mark" aria-hidden="true">
          <Icon name="logo" />
        </span>
        <span className="pb-brand">{__BRAND_NAME__}</span>
        <button type="button" className="pb-close" aria-label="Sluiten" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="pb-card-text">{view.text}</p>
      {view.action?.kind === "plans" && (
        <a className="pb-action" href={plansUrl} target="_blank" rel="noopener" onClick={() => onAction(view.action!)}>
          {view.action.label}
          <Icon name="external" />
        </a>
      )}
      {view.action && view.action.kind !== "plans" && (
        <button type="button" className="pb-action" onClick={() => onAction(view.action!)}>
          {view.action.label}
        </button>
      )}
    </div>
  );
}

function Toast({ onRefresh, onClose }: { onRefresh: () => void; onClose: () => void }): JSX.Element {
  return (
    <div className="pb-toast" role="status" onClick={ours}>
      <span className="pb-toast-check" aria-hidden="true">
        <Icon name="check" />
      </span>
      <span>{TOAST_TEXT}</span>
      <button type="button" className="pb-action" onClick={onRefresh}>
        <Icon name="refresh" />
        {REFRESH}
      </button>
      <button type="button" className="pb-close" aria-label="Sluiten" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
