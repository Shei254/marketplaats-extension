import { Badge, Button, Note, Skeleton } from "@mprelist/ui";
import {useCallback, useEffect, useState, type JSX, useRef} from "react";

import type { WireRelistOutcome } from "../background/messages";

import type { ListingSummary, PendingRepost } from "../domain/types";
import {STALE_TAB, describePrice, type AdsView, type PriceLine, INITIAL_MORE} from "./ads";
import { IDLE, PACING_NOTE, refusalNote, refusedTone, rowStateFor, type RowState } from "./relisting";
import type { WorkerPort } from "./screen";

/**
 * The ad list, and the Repost button on each row (T30a #39, T30b #79).
 *
 * **One relist at a time.** While a row is running every other row's button is
 * locked, which is the POC popup's behaviour and the reason it had it: a
 * distracted click on three rows in a row is three ads deleted before the first
 * has been posted again, and delete-first (ADR-0003) makes that irreversible in a
 * way a slow queue would not. That is serialisation and **not pacing**: the
 * human-shaped gap between relists arrived with T46 (#54) and is the worker's,
 * because a backend can refuse a call that came too soon but cannot make one
 * arrive at a plausible moment. What this list does with it is *show* it — a
 * wait nobody explained is indistinguishable from a hang.
 *
 * The row state lives here rather than in each row, for the same reason: the lock
 * is a property of the list, and a row that owned its own state could not know
 * another was running.
 *
 * **And one lock that is the plan's** (T32, #41). A tier granting nothing locks
 * every button before anything is clicked, which is ADR-0007's "render
 * locked-vs-active *before* any click" for the one case where that can be done
 * honestly — see the `grantsNothing` prop below for why the remainder is not.
 */
export function AdList({
  view,
  worker,
  onOutcome,
  grantsNothing,
  empty = "Je hebt geen actieve advertenties.",
  pending = [],
  onLetGo = () => {},
  onReloadMarktplaats = () => {},
}: {
  view: AdsView;
  worker: WorkerPort;
  /**
   * Every finished attempt, handed up whole. The plan strip belongs to the screen
   * above and moves on the quota this carries; the ad list is reloaded there too,
   * since a reposted ad has a new id.
   */
  onOutcome: (outcome: WireRelistOutcome) => void;
  /**
   * Whether the plan this list is drawn under grants no reposts at all (T32, #41)
   * — `plans.ts`'s `grantsNothing`, and the only thing this component is told
   * about the subscription.
   *
   * **One boolean rather than the plan**: the screen above holds the plan, this
   * list holds the order the ads are in, and handing it the whole `DisplayState`
   * would let it start deciding entitlement questions that are not its.
   *
   * **And the grant rather than the remainder.** A grant is the Tier's own
   * property — only an operator or a purchase moves it — so every row can be
   * locked on it and still be right in a minute. `quotaRemaining` goes back *up*
   * without the holder acting, so a button disabled on that is one a refund has
   * already made wrong; it stays live, the click costs a round trip, and
   * `authorize` refuses it before any delete (ADR-0007).
   *
   * **Nothing is written on the rows.** The list is uniform when this is true and
   * `NoRepostsPrompt` says it once, directly above — twenty copies of one sentence
   * under twenty rows is the third line per row that stops a 360px list being
   * scannable. Chrome draws no tooltip on a disabled control either, which is why
   * there is nothing to hover.
   *
   * **A row holding a deleted ad keeps its Opnieuw**, and that falls out of
   * `toneFor` rather than being carved out here: `locked` only darkens an *idle*
   * button. It is the behaviour to want. Finishing a relist whose delete already
   * ran needs no fresh grant (`docs/enforcement-contract.md`), so the one thing
   * this lock must never do is strand somebody's ad inside the extension because
   * an operator zeroed their tier while it was there.
   */
  grantsNothing: boolean;
  /**
   * What an empty list means, which this component cannot know: an account with
   * no ads and a search that matched none are the same three states and two
   * different sentences (T31, #40). The default is the first, because the list
   * without a query is what this was before there was a box.
   */
  empty?: string;
  /**
   * Reposts that did not finish (ADR-0039), drawn above the ads whatever state
   * the list is in — a `deleted` ad is not in the list, and these rows are the
   * only place the user sees it.
   */
  pending?: PendingRepost[];
  onLetGo?: (listingId: string) => void;
  /** Reload a **Stale tab**; the list is asked for again once it has. */
  onReloadMarktplaats?: (tabId: number) => void;
}): JSX.Element {
  const [running, setRunning] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, RowState>>({});
  /**
   * When the account's cooldown ends, if one is running. **The whole list is
   * locked, not the row that met it**: the pacing rails are per user (ADR-0008),
   * so the next ad would be refused for the same reason and a button that offered
   * to try is a button that lies.
   */
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const secondsLeft = useCountdown(cooldownUntil, () => setCooldownUntil(null));
  /**
   * When the relist that is running will actually start, if the worker is pacing
   * it (T46, #54). **Only the running row shows this** — unlike a cooldown, which
   * is the account's and locks the list, this is one attempt waiting its turn, and
   * every other button is already locked because a relist is in flight.
   */
  const [pacingUntil, setPacingUntil] = useState<number | null>(null);
  const pacingSeconds = useCountdown(pacingUntil, () => setPacingUntil(null));

  const firstPage = view.status === "ready" ? view.ads : null;
  const [more, setMore] = useState(INITIAL_MORE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const generation = useRef(0);

// A repost moves the ad to the top, so every later page has shifted. The screen
// reloads page 1 after each outcome; drop the extra pages with it and let any
// request still in flight discover it is stale.
  useEffect(() => {
    generation.current += 1;
    setMore(INITIAL_MORE);
    setLoadingMore(false);
    setMoreError(null);
  }, [firstPage]);

  const batchSize = firstPage?.length ?? 0; // the first response defines the batch size
  const total = more.total ?? (view.status === "ready" ? view.total : 0);
  const hasMore =
      firstPage !== null && !more.exhausted && more.nextBatch <= pageCount(total, batchSize);

  const loadMore = useCallback(async () => {
    if (loadingMore || firstPage === null) return;
    const gen = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await worker.ads(more.nextBatch, firstPage.length);
      if (gen !== generation.current) return;
      setMore((current) => {
        const seen = new Set([...firstPage, ...current.ads].map((ad) => ad.id));
        return {
          ads: [...current.ads, ...page.ads.filter((ad) => !seen.has(ad.id))],
          nextBatch: current.nextBatch + 1,
          total: page.totalNumberOfResults,
          exhausted: page.ads.length === 0,
        };
      });
    } catch (error) {
      if (gen !== generation.current) return;
      setMoreError(
          `Meer advertenties konden niet worden geladen. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (gen === generation.current) setLoadingMore(false);
    }
  }, [worker, loadingMore, firstPage, more.nextBatch]);

  const start = useCallback(
    async (listingId: string, action: "relist" | "retry") => {
      setRunning(listingId);
      setStates((current) => ({ ...current, [listingId]: { kind: "busy" } }));

      // The worker paces a relist before it starts (T46, #54); this asks how long
      // so the row can count it down. It is a question, not the wait itself — the
      // worker waits whether or not anybody asked, and would still wait if this
      // answer never came, which is why a failure to get one is 0 rather than a
      // reason not to start.
      //
      // Only for a fresh relist. A retry is usually a resume of an ad that is
      // already deleted, which is recovery and is not paced at all; asking would
      // draw a countdown for a wait that is not going to happen.
      if (action === "relist") {
        const waitMs = await worker.msBeforeNextRelist().catch(() => 0);
        if (waitMs > 0) setPacingUntil(Date.now() + waitMs);
      }

      let state: RowState;
      let outcome: WireRelistOutcome | null = null;
      try {
        outcome = action === "relist" ? await worker.relist(listingId) : await worker.retry(listingId);
        state = rowStateFor(outcome);
      } catch (error) {
        // The worker itself did not answer. Nothing ran, so this is the same
        // shape as a refusal to start rather than a relist that failed halfway.
        state = {
          kind: "failed",
          tone: "error",
          action: "relist",
          message: `Nothing was reposted. ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      setStates((current) => ({ ...current, [listingId]: state }));
      setRunning(null);
      // Whatever the countdown still said, the attempt is over: an answer that
      // arrived early — a worker that could not pace, a refusal — must not leave
      // a clock ticking on a row that has finished.
      setPacingUntil(null);
      if (state.kind === "refused" && state.locked.state === "cooldown") {
        // A refusal carrying no seconds locks nothing: there is nothing to count,
        // and a lock for an unknown length is worse than letting the next attempt
        // be refused too. It becomes a cooldown that has already elapsed, which
        // `useCountdown` clears on its first read — one place decides that rather
        // than two agreeing.
        setCooldownUntil(Date.now() + (state.locked.retryAfter ?? 0) * 1000);
      }
      onOutcome(outcome ?? { status: "refused", locked: { state: "retry" } });
    },
    [worker, onOutcome],
  );

  const noTab = view.status === "failed" && view.noTab === true;
  return (
    <>
      {pending.length > 0 && (
        <ul className="popup-ads popup-pending">
          {pending.map((repost) => (
            <PendingRow
              key={repost.listingId}
              repost={repost}
              busy={repost.running || states[repost.listingId]?.kind === "busy"}
              noTab={noTab}
              onRetry={() => void start(repost.listingId, "retry")}
              onLetGo={() => onLetGo(repost.listingId)}
            />
          ))}
        </ul>
      )}
      <Ads
        view={view}
        empty={empty}
        onReloadMarktplaats={onReloadMarktplaats}
        rows={(ads) => (
            <ul className="popup-ads">
              {[...ads, ...more.ads].map((ad) => (
                  <AdRow
                      ad={ad}
                      key={ad.id}
                      state={states[ad.id] ?? IDLE}
                      locked={(running !== null && running !== ad.id) || secondsLeft !== null || grantsNothing}
                      secondsLeft={secondsLeft}
                      pacingSeconds={running === ad.id ? pacingSeconds : null}
                      onStart={start}
                      grantsNothing={grantsNothing}
                  />
              ))}
              {hasMore && (
                  <li className="popup-ads-more">
                    {moreError && <Note tone="error">{moreError}</Note>}
                    <Button shape="rect" tone={loadingMore ? "busy" : "secondary"} onClick={() => void loadMore()}>
                      {loadingMore ? "Laden…" : `Meer laden · ${ads.length + more.ads.length} van ${total}`}
                    </Button>
                  </li>
              )}
            </ul>
        )}
      />
    </>
  );
}

/** The ads themselves, in whichever of their states the list is in. */
function Ads({
  view,
  empty,
  onReloadMarktplaats,
  rows,
}: {
  view: AdsView;
  empty: string;
  onReloadMarktplaats: (tabId: number) => void;
  rows: (ads: ListingSummary[]) => JSX.Element;
}): JSX.Element {
  switch (view.status) {
    case "loading":
      return <LoadingRows />;
    case "stale":
      return (
        <div className="popup-ads-failed">
          <Note tone="warn">{STALE_TAB}</Note>
          <Button shape="rect" tone="primary" onClick={() => onReloadMarktplaats(view.tabId)}>
            Pagina vernieuwen
          </Button>
        </div>
      );
    case "failed":
      return (
        <div className="popup-ads-failed">
          <Note tone="error">Je advertenties konden niet worden geladen. {view.message}</Note>
        </div>
      );
    case "ready":
      // An account with no ads is an answer, not a failure — and a spinner left
      // turning over one is the version of this screen that looks broken.
      return view.ads.length === 0 ? <p className="popup-ads-empty">{empty}</p> : rows(view.ads);
  }
}

/**
 * A **Pending repost** (ADR-0039): an ad the extension is holding because a
 * repost did not finish. It says whether it is being put back, waits for the
 * user, or waits for a marktplaats.nl tab — and it can be let go, after asking,
 * except while it is being put back.
 */
function PendingRow({
  repost,
  busy,
  noTab,
  onRetry,
  onLetGo,
}: {
  repost: PendingRepost;
  busy: boolean;
  noTab: boolean;
  onRetry: () => void;
  onLetGo: () => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const note = busy
    ? "Wordt teruggezet…"
    : repost.needsUser
      ? "Terugzetten lukt niet vanzelf — klik op Opnieuw."
      : noTab
        ? "Onderbroken: open Marktplaats om af te ronden"
        : "Wordt teruggezet…";
  return (
    <li className="popup-ad" data-state="pending">
      <div className="popup-ad-row">
        <div className="popup-ad-info">
          <span className="popup-ad-title" title={repost.title}>
            {repost.title}
          </span>
        </div>
        {busy ? (
          <Button shape="rect" tone="busy">
            Bezig…
          </Button>
        ) : (
          !noTab && (
            <Button shape="rect" tone="retry" onClick={onRetry}>
              Opnieuw
            </Button>
          )
        )}
      </div>
      {asking ? (
        <>
          <Note tone="warn">
            Deze advertentie staat niet meer op Marktplaats. Weet je zeker dat je hem niet wilt terugzetten?
          </Note>
          <div className="popup-ad-row">
            <Button shape="rect" tone="secondary" onClick={onLetGo}>
              Ja, niet terugzetten
            </Button>
            <Button shape="rect" tone="ghost" onClick={() => setAsking(false)}>
              Annuleren
            </Button>
          </div>
        </>
      ) : (
        <>
          <Note tone={repost.needsUser ? "error" : "warn"}>{note}</Note>
          {!busy && (
            <Button shape="rect" tone="ghost" onClick={() => setAsking(true)}>
              Niet terugzetten
            </Button>
          )}
        </>
      )}
    </li>
  );
}

/**
 * One ad: what it is called, what it costs, and what its Repost button is doing.
 *
 * The title is truncated by CSS rather than by cutting the string, so the whole of
 * it stays in the DOM — a `title` attribute carries it to a tooltip, which is the
 * only way to read a long one in a 360px window.
 */
export function AdRow({
  ad,
  state,
  locked,
  secondsLeft,
  pacingSeconds,
  onStart,
  grantsNothing,
}: {
  ad: ListingSummary;
  state: RowState;
  /** Another row is relisting, the account is in a cooldown, or the plan grants nothing. */
  locked: boolean;
  /**
   * Whether the plan grants no reposts at all, which this row needs even though
   * `locked` above already carries it: a refusal that landed here before the
   * buttons went dark has to be read against the plan to pick its sentence.
   *
   * **Not two spellings of one fact**, which is the shape this repo refuses — a
   * cooldown locks a row on a plan granting plenty, so `locked` is true in states
   * this is false in. One implies the other and never the reverse.
   */
  grantsNothing: boolean;
  /** Seconds until the account's cooldown ends, when one is running. */
  secondsLeft?: number | null;
  /**
   * Seconds until this row's own relist starts, while the worker is pacing it
   * (T46, #54). Different from the cooldown above in what it means and in who it
   * applies to: that one is the backend refusing the account, this one is us
   * deliberately not going yet.
   */
  pacingSeconds?: number | null;
  onStart: (listingId: string, action: "relist" | "retry") => void;
}): JSX.Element {
  const action = state.kind === "failed" ? state.action : "relist";
  // The row's own wait wins over the account's: this row is the one running, and
  // what it is waiting for is the number it should be counting down.
  const counting = pacingSeconds ?? secondsLeft ?? null;
  return (
    <li className="popup-ad" data-state={state.kind}>
      <div className="popup-ad-row">
        <div className="popup-ad-info">
          <span className="popup-ad-title" title={ad.title}>
            {ad.title}
          </span>
          <PriceMeta price={describePrice(ad)} reserved={ad.reserved} />
        </div>
        <Button
          shape="rect"
          tone={counting != null ? "cooldown" : toneFor(state, locked)}
          title={tooltipFor(state, ad.title)}
          onClick={() => onStart(ad.id, action)}
        >
          {counting != null ? `${counting}s` : labelFor(state)}
        </Button>
      </div>
      <RowNote state={state} pacing={pacingSeconds != null} grantsNothing={grantsNothing} />
    </li>
  );
}

/**
 * The line under the title: whether the ad is promised to a buyer, what kind of
 * price it has, its number where it has one, and whether bids are taken on top.
 *
 * **One line and never a stack.** The row is 360px wide with a button in it, so a
 * second line here is a third line in the row, and a list whose rows are three
 * lines tall stops being scannable at about six ads. That budget is also why the
 * aside is a word and not a sentence: "bieden mogelijk" spelled out is what tips
 * the longest chip over the edge and puts an ellipsis in the middle of it. The
 * chip and the number hold their width; the aside is the part that clips, because
 * of the three it is the one whose absence changes least.
 *
 * Nothing is drawn at all when there is nothing to say — an unrecognised
 * `priceType` with no price — rather than an empty line that still costs a
 * baseline. That row is a title and a button, which is what it was before any of
 * this.
 */
function PriceMeta({ price, reserved }: { price: PriceLine; reserved: boolean }): JSX.Element | null {
  if (!reserved && !price.label && !price.amount && !price.bidding) return null;
  return (
    <span className="popup-ad-meta">
      {reserved && (
        <Badge tone="accent" className="popup-ad-reserved" title={RESERVED_TOOLTIP}>
          Gereserveerd
        </Badge>
      )}
      {price.label && <Badge className="popup-ad-type">{price.label}</Badge>}
      {price.amount && <span className="popup-ad-price">{price.amount}</span>}
      {price.bidding && <span className="popup-ad-bidding">· bieden</span>}
    </span>
  );
}

/**
 * What the badge says on hover — and the half of it that matters is the second
 * sentence (T71, #157).
 *
 * A repost deletes the ad first (ADR-0002), and until T71 the ad that came back
 * was not reserved: an item its seller had promised went quietly back on the open
 * market. The badge is the first place a seller learns this ad is different, so it
 * is also the place to say the mechanic knows.
 */
const RESERVED_TOOLTIP = "Gereserveerd voor een koper. Bij herplaatsen blijft de advertentie gereserveerd.";

/**
 * The countdown on a cooldown, in whole seconds, ending itself when it runs out.
 *
 * A timer rather than a static number because a cooldown a user cannot see the end
 * of is indistinguishable from something broken — and when it reaches zero the
 * buttons come back on their own, which is the half that makes it a countdown
 * rather than a label.
 */
function useCountdown(until: number | null, onElapsed: () => void): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [until]);

  if (until === null) return null;
  const left = Math.ceil((until - now) / 1000);
  if (left <= 0) {
    // Cleared through the caller's state rather than here, so the elapsed
    // cooldown unlocks every row at once and this hook stays a function of time.
    queueMicrotask(onElapsed);
    return null;
  }
  return left;
}

function RowNote({
  state,
  pacing,
  grantsNothing,
}: {
  state: RowState;
  pacing?: boolean;
  grantsNothing: boolean;
}): JSX.Element | null {
  // Said before anything else, because while it is true the row is "busy" and a
  // busy row says nothing at all — which is the hang this note exists to not be.
  if (pacing) return <Note tone="warn">{PACING_NOTE}</Note>;
  switch (state.kind) {
    case "done":
      return <Note tone="ok">Herplaatst. Je advertenties worden opnieuw geladen…</Note>;
    case "failed":
      return <Note tone={state.tone}>{state.message}</Note>;
    case "refused":
      return <Note tone="warn">{refusalNote(state.locked, grantsNothing)}</Note>;
    default:
      return null;
  }
}

/**
 * Which button this is. The tones carry their own glyphs (`@mprelist/ui`), and
 * every inert one is disabled by the component rather than by this caller —
 * which is what stops a locked row being clickable at all.
 */
function toneFor(state: RowState, locked: boolean): "primary" | "busy" | "done" | "retry" | "locked" | "cooldown" {
  switch (state.kind) {
    case "busy":
      return "busy";
    case "done":
      return "done";
    case "failed":
      return "retry";
    case "refused":
      return refusedTone(state.locked);
    case "idle":
      return locked ? "locked" : "primary";
  }
}

function labelFor(state: RowState): string {
  switch (state.kind) {
    case "busy":
      return "Bezig met herplaatsen…";
    case "done":
      return "Herplaatst";
    case "failed":
      // "Opnieuw" is a resume from the snapshot — the ad is already gone and this
      // is what puts it back. "Opnieuw proberen" starts over on an ad that is
      // still there.
      return state.action === "retry" ? "Opnieuw" : "Opnieuw proberen";
    default:
      return "Herplaats";
  }
}

/**
 * The hover text, which is where the sentence that matters goes: **Repost deletes
 * the ad first** (ADR-0002), and a button that says only "Repost" does not say so
 * anywhere. The POC popup put it here and this keeps it.
 */
function tooltipFor(state: RowState, title: string): string {
  if (state.kind === "idle") {
    return `Verwijder “${title}” en plaats de advertentie opnieuw, zodat deze weer bovenaan staat.`;
  }
  return labelFor(state);
}

/** The shape of the answer while it is on its way — the canvas's Loading artboard. */
function LoadingRows(): JSX.Element {
  return (
    <ul className="popup-ads">
      {[78, 62, 88].map((width) => (
        <li className="popup-ad" key={width}>
          <div className="popup-ad-row">
            <div className="popup-ad-info" style={{ flex: 1 }}>
              <Skeleton width={`${width}%`} height={11} />
              <span className="popup-ad-meta">
                <Skeleton width={58} height={14} shape="pill" />
                <Skeleton width={44} height={10} />
              </span>
            </div>
            <Skeleton width={74} height={28} shape="pill" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function pageCount(total: number, batchSize: number): number {
  return batchSize > 0 ? Math.ceil(total / batchSize) : 1;
}