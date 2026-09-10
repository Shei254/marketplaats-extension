import {
  amountInMinorUnits,
  decimalsIn,
  inMajorUnits,
  type AdminTier,
  type NewPlan,
  type NewPrice,
  type TierEdit,
} from "@mprelist/contracts";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Note,
  Select,
  type NoteTone,
} from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";

import type {
  AdminApi,
  CatalogAnswer,
  CreateAnswer,
  CurrencyAnswer,
  EditAnswer,
  PricesAnswer,
} from "./admin-api";
import { ADMIN_ROLE } from "./admin-config";
import { DEFAULT_PAGE, type AdminPageId } from "./admin-nav";
import { AdminShell } from "./AdminShell";
import { FeaturesFieldset, useFeatures } from "./FeaturesField";
import { tierCodeFrom } from "./tier-code";

/**
 * The signed-in half of `/admin`: the pages, the data behind them, and the writes
 * an operator makes (T54, #85; T62, #128).
 *
 * **One load for the whole surface.** The catalog, the untagged Stripe prices and
 * the currency arrive together and are held here rather than in the page that
 * shows them — so a second page costs a prop rather than a fetch, and the state
 * every page reads is in one place while there is only one of them.
 *
 * **A table rather than cards**, which is the one deliberate departure from
 * everything else in this repository: the plan cards are a screen somebody is
 * being sold something on, and this is a screen somebody compares eight numbers
 * across five rows on.
 *
 * **One form, in one place.** The three forms — new plan, reprice, edit — are one
 * piece of state and one panel directly under the heading, rather than three
 * independent flags opening panels at the bottom of a table. An operator never has
 * to find where the thing they clicked opened, two of them can never be open at
 * once, and the row a form belongs to is marked while it is.
 *
 * **The form is total over what may be edited**, because the API's `PUT` is: every
 * field is sent on every save, so there is no partial state to reason about here
 * and no way for a field left untouched to arrive as a change.
 *
 * **What it will not offer**: creating a tier, deleting one, typing a Stripe
 * Price id, or typing the code a plan is filed under (`tier-code.ts`). A plan is created by tagging a Price in Stripe and the sync drafts the
 * row (ADR-0019); a tier is retired by unpublishing it, since a subscription
 * references its tier behind a foreign key. Buttons for any of those would be
 * buttons the API refuses.
 */
export function AdminCatalog({
  api,
  onSignedOut,
  onSignOut,
}: {
  api: AdminApi;
  /** The token this tab holds has expired — there is no refresh, so this is a redirect. */
  onSignedOut: () => void;
  /** Leaving on purpose, which ends the session at Keycloak as well as here. */
  onSignOut: () => void;
}): JSX.Element {
  const [page, setPage] = useState<AdminPageId>(DEFAULT_PAGE);
  const [catalog, setCatalog] = useState<CatalogAnswer | null>(null);
  const [prices, setPrices] = useState<PricesAnswer | null>(null);
  const [currency, setCurrency] = useState<CurrencyAnswer | null>(null);
  /** Which form is open, and there is only ever one. */
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState<{ tone: NoteTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [tiers, untagged, priced] = await Promise.all([
      api.tiers(),
      api.unadoptedPrices(),
      api.currency(),
    ]);
    if (tiers.status === "signed-out" || untagged.status === "signed-out") {
      onSignedOut();
      return;
    }
    setCatalog(tiers);
    setPrices(untagged);
    setCurrency(priced);
  }, [api, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * What a write did, said in the operator's own terms.
   *
   * The refusals are the API's four, and each is a different instruction: a `409`
   * means go and create a Price in Stripe, a `404` means the catalog moved under
   * this screen, a `400` should be unreachable for a form that sends every field,
   * and `signed-out` is the only one that is not a sentence but a redirect.
   */
  const applied = useCallback(
    async (answer: EditAnswer, what: string): Promise<void> => {
      if (answer.status === "signed-out") {
        onSignedOut();
        return;
      }
      if (answer.status === "saved") {
        setNote({ tone: "ok", message: `${what} saved.` });
        setPanel(null);
        await load();
        return;
      }
      setNote({ tone: "error", message: refusal(answer) });
    },
    [load, onSignedOut],
  );

  const save = useCallback(
    async (code: string, edit: TierEdit) => {
      setBusy(true);
      await applied(await api.save(code, edit), edit.name);
      setBusy(false);
    },
    [api, applied],
  );

  /**
   * Creating a plan, which is the one write here that also happens in Stripe.
   *
   * The refusals are not the edit form's: `exists` is a code already taken, and
   * `refused` carries Stripe's own sentence — the only answer in this API with a
   * body worth reading, because "amount must be at least 50 cents for usd" is not
   * something a status could say and is exactly what the operator has to change.
   */
  const createPlan = useCallback(
    async (plan: NewPlan) => {
      setBusy(true);
      const answer: CreateAnswer = await api.createPlan(plan);
      setBusy(false);
      if (answer.status === "signed-out") {
        onSignedOut();
        return;
      }
      if (answer.status === "created") {
        // What Stripe made need not be everything that was asked for: two rhythms
        // are two Stripe calls with no transaction spanning them, so the annual
        // Price can be refused once the monthly one exists. The plan is real
        // either way, and an operator told only "created" would believe they had
        // made something they had not.
        const missing = rhythmsMissingFrom(answer.tier, plan);
        setNote(
          missing.length === 0
            ? { tone: "ok", message: `${plan.name} created, and Stripe has the ${priceWord(plan)}.` }
            : {
                tone: "warn",
                message:
                  `${plan.name} was created, but Stripe did not make ` +
                  `${listedPrices(missing.map((rhythm) => rhythm.named))}. Add it from the ` +
                  `plan’s row, where Stripe says what is wrong with it.`,
              },
        );
        setPanel(null);
        await load();
        return;
      }
      setNote({ tone: "error", message: whyNotCreated(answer) });
    },
    [api, load, onSignedOut],
  );

  /**
   * Adding a rhythm to a plan, or repricing one it already sells at.
   *
   * The same call for both, because in Stripe they are the same act — create a
   * Price tagged with the tier's code — and what decides which happened is whether
   * the tier already sells at that rhythm.
   */
  const addPrice = useCallback(
    async (code: string, price: NewPrice) => {
      setBusy(true);
      const answer = await api.addPrice(code, price);
      setBusy(false);
      if (answer.status === "signed-out") {
        onSignedOut();
        return;
      }
      if (answer.status === "created") {
        setNote({ tone: "ok", message: `${code} is now sold by the ${price.interval} too.` });
        setPanel(null);
        await load();
        return;
      }
      setNote({ tone: "error", message: whyNotCreated(answer) });
    },
    [api, load, onSignedOut],
  );

  const makeDefault = useCallback(
    async (tier: AdminTier) => {
      setBusy(true);
      await applied(await api.makeDefault(tier.tier.code), tier.tier.name);
      setBusy(false);
    },
    [api, applied],
  );

  const ready = catalog?.status === "ready" ? catalog : null;

  return (
    <AdminShell
      page={page}
      onNavigate={(next) => {
        setPage(next);
        // A note is about the thing that just happened on the page it happened on;
        // carried to another page it is a sentence with no subject in sight.
        setNote(null);
      }}
      role={ADMIN_ROLE}
      onSignOut={onSignOut}
      actions={
        // Nothing while a form is open, and that is the point of it: the panel is
        // on screen with its own way out, and a second control in the corner
        // saying "Close" is a second thing to have to read.
        ready && !panel ? (
          <Button shape="rect" onClick={() => setPanel({ kind: "new" })} disabled={busy}>
            New plan
          </Button>
        ) : undefined
      }
    >
      <Tiers
        catalog={catalog}
        prices={prices}
        currency={currency}
        panel={panel}
        note={note}
        busy={busy}
        onReload={() => void load()}
        onOpen={setPanel}
        onSave={(code, edit) => void save(code, edit)}
        onCreate={(plan) => void createPlan(plan)}
        onAddPrice={(code, price) => void addPrice(code, price)}
        onMakeDefault={(tier) => void makeDefault(tier)}
      />
    </AdminShell>
  );
}

/** Which form is open. Never two, which is what makes one panel enough. */
type Panel = { kind: "new" } | { kind: "price"; code: string } | { kind: "edit"; code: string } | null;

/**
 * The catalog page: what the whole of it looks like at a glance, whichever form is
 * open, and the rows.
 */
function Tiers({
  catalog,
  prices,
  currency,
  panel,
  note,
  busy,
  onReload,
  onOpen,
  onSave,
  onCreate,
  onAddPrice,
  onMakeDefault,
}: {
  catalog: CatalogAnswer | null;
  prices: PricesAnswer | null;
  currency: CurrencyAnswer | null;
  panel: Panel;
  note: { tone: NoteTone; message: string } | null;
  busy: boolean;
  onReload: () => void;
  onOpen: (panel: Panel) => void;
  onSave: (code: string, edit: TierEdit) => void;
  onCreate: (plan: NewPlan) => void;
  onAddPrice: (code: string, price: NewPrice) => void;
  onMakeDefault: (tier: AdminTier) => void;
}): JSX.Element {
  if (!catalog) return <p className="admin-empty">Loading the catalog…</p>;
  if (catalog.status === "forbidden") {
    // Reachable only if the role went away between the token being minted and this
    // call — the screen above already checks it. Said rather than rendered empty.
    return <Note tone="error">This account no longer has the ADMIN role.</Note>;
  }
  if (catalog.status !== "ready") {
    return (
      <Card>
        <Note tone="warn">The catalog could not be loaded.</Note>
        <div className="admin-form-actions">
          <Button shape="rect" tone="secondary" onClick={onReload}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  const open = panel?.kind === "edit" || panel?.kind === "price" ? panel.code : null;
  const editing = panel?.kind === "edit" ? tierIn(catalog.tiers, panel.code) : null;
  const pricing = panel?.kind === "price" ? tierIn(catalog.tiers, panel.code) : null;

  return (
    <div className="admin-sections">
      {note ? <Note tone={note.tone}>{note.message}</Note> : null}
      <Summary tiers={catalog.tiers} currency={currency} />
      <Untagged answer={prices} />
      {panel?.kind === "new" ? (
        <NewPlanForm
          currency={currency}
          busy={busy}
          onCancel={() => onOpen(null)}
          onCreate={onCreate}
        />
      ) : null}
      {pricing ? (
        <NewPriceForm
          // Remounted per tier: the form holds the row's values as its own state,
          // so a shared instance would open the next tier showing the last one's.
          key={pricing.tier.code}
          tier={pricing}
          currency={currency}
          busy={busy}
          onCancel={() => onOpen(null)}
          onAdd={(price) => onAddPrice(pricing.tier.code, price)}
        />
      ) : null}
      {editing ? (
        <TierForm
          key={editing.tier.code}
          tier={editing}
          busy={busy}
          onCancel={() => onOpen(null)}
          onSave={(edit) => onSave(editing.tier.code, edit)}
        />
      ) : null}
      <Card flush>
        {/* The table scrolls inside the card rather than pushing the page sideways:
            five columns and three row actions do not fit a narrow window, and a
            page that scrolls horizontally loses its own sidebar. */}
        <div className="admin-table-scroll">
          <table className="mp-table admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Relists</th>
                <th>Stripe Price</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalog.tiers.map((tier) => (
                <TierRow
                  key={tier.tier.code}
                  tier={tier}
                  busy={busy}
                  open={open === tier.tier.code}
                  editing={panel?.kind === "edit" && panel.code === tier.tier.code}
                  pricing={panel?.kind === "price" && panel.code === tier.tier.code}
                  onEdit={() =>
                    onOpen(
                      panel?.kind === "edit" && panel.code === tier.tier.code
                        ? null
                        : { kind: "edit", code: tier.tier.code },
                    )
                  }
                  onAddPrice={() =>
                    onOpen(
                      panel?.kind === "price" && panel.code === tier.tier.code
                        ? null
                        : { kind: "price", code: tier.tier.code },
                    )
                  }
                  onMakeDefault={() => onMakeDefault(tier)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/**
 * The four numbers somebody opening this page wants before they read a single row:
 * how many plans there are, how many can actually be bought, how many are half
 * finished, and what the money is in.
 *
 * **Drafts are the one that is a job rather than a fact**, so it is the only tile
 * that changes colour — a draft is a tier the Stripe sync invented and nobody
 * finished, and it is the reason this screen exists.
 */
function Summary({
  tiers,
  currency,
}: {
  tiers: AdminTier[];
  currency: CurrencyAnswer | null;
}): JSX.Element {
  const onSale = tiers.filter((tier) => tier.published).length;
  const drafts = tiers.filter(isDraft).length;
  const priced = currency?.status === "ready" ? currency.currency.toUpperCase() : "—";
  return (
    <div className="admin-stats">
      <Stat label="Tiers" value={tiers.length} note="Everything in the catalog" />
      <Stat label="On sale" value={onSale} note="Buyable from the extension" />
      <Stat
        label="Drafts"
        value={drafts}
        note={drafts === 0 ? "Nothing waiting on you" : "Started in Stripe, not finished here"}
        attention={drafts > 0}
      />
      <Stat
        label="Priced in"
        value={priced}
        note={priced === "—" ? "Stripe could not be asked" : "What Stripe settles in"}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  attention = false,
}: {
  label: string;
  value: ReactNode;
  note: string;
  attention?: boolean;
}): JSX.Element {
  return (
    <div className={attention ? "admin-stat admin-stat--attention" : "admin-stat"}>
      <p className="admin-stat-label">{label}</p>
      <p className="admin-stat-value">{value}</p>
      <p className="admin-stat-note">{note}</p>
    </div>
  );
}

/**
 * The Stripe Prices carrying no `tier_code`, folded back onto the catalog as a
 * line that is closed until somebody opens it (ADR-0019).
 *
 * **It has been in three places, and this is why it is in this one.** It began
 * stacked under the tier table — a list nobody can act on at the end of every
 * scroll. It was then a page of its own with a count in the sidebar, which is
 * worse in the ordinary case: a whole door for a list that is empty on a well-kept
 * account. Here it is silent when there is nothing, one sentence when there is
 * something, and the table only for whoever asks for it.
 *
 * **It lists and does nothing.** There is no adopt button, because Stripe accounts
 * hold Prices for one-offs, coupons and experiments, and only the operator can
 * tell an experiment from a mistake. Adopting is done in Stripe, by adding the
 * tag, which fires `price.updated` and goes through the sync that already exists.
 */
function Untagged({ answer }: { answer: PricesAnswer | null }): JSX.Element | null {
  // Nothing yet, or a refusal the catalog above has already said out loud. Either
  // way this is not the line to say it on.
  if (!answer || answer.status === "forbidden") return null;
  if (answer.status !== "ready") {
    return (
      <Note tone="warn">
        Stripe could not be asked which prices carry no tier, so that list is unknown rather than
        empty.
      </Note>
    );
  }
  // Empty is the *good* state, and the good state says nothing at all.
  if (answer.prices.length === 0) return null;
  const count = answer.prices.length;
  return (
    <details className="admin-untagged">
      {/* Left as the browser's own disclosure: a `display: flex` summary drops the
          marker in two engines, and the marker is the whole of what says this line
          opens. The count is in the sentence rather than in a badge beside it. */}
      <summary className="admin-untagged-line">
        {count === 1 ? "One price in Stripe carries" : `${count} prices in Stripe carry`} no tier.
        Mostly one-offs and experiments — but a plan you meant to create and cannot find will be
        here.
      </summary>
      <div className="admin-table-scroll">
        <table className="mp-table">
          <thead>
            <tr>
              <th>Price</th>
              <th>Nickname</th>
              <th>Amount</th>
              <th>Recurs</th>
            </tr>
          </thead>
          <tbody>
            {answer.prices.map((price) => (
              <tr key={price.id}>
                <td>
                  <code className="mp-code">{price.id}</code>
                </td>
                <td>{price.nickname ?? "—"}</td>
                <td className="admin-numeric">
                  {/* Not `/ 100`: these are whatever currency somebody made them in,
                      and a yen has no minor unit at all (T66). */}
                  {inMajorUnits(price.amount, price.currency)} {price.currency.toUpperCase()}
                </td>
                {/* A one-off is the commonest thing in this list that is not a mistake. */}
                <td>{price.interval ?? "one-off"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-untagged-how">
        Add <code>metadata.tier_code</code> to a price in Stripe and it becomes a tier here on its
        own — nothing needs doing on this screen.
      </p>
    </details>
  );
}

/**
 * One tier. A draft — quota 0 and unpublished — is marked, because it is the row
 * this screen exists to let somebody act on and it looks like every other row
 * until you read two columns.
 */
function TierRow({
  tier,
  busy,
  open,
  editing,
  pricing,
  onEdit,
  onAddPrice,
  onMakeDefault,
}: {
  tier: AdminTier;
  busy: boolean;
  /** This row is the one the open form belongs to. */
  open: boolean;
  editing: boolean;
  pricing: boolean;
  onEdit: () => void;
  onAddPrice: () => void;
  onMakeDefault: () => void;
}): JSX.Element {
  const draft = isDraft(tier);
  return (
    <tr data-draft={draft} data-open={open}>
      <td className="admin-code">{tier.tier.code}</td>
      <td>{tier.tier.name}</td>
      <td className="admin-numeric">{quotaColumn(tier.relistQuotaPerPeriod)}</td>
      <td>
        {/* Every rhythm it is sold at (T62, #128) — monthly and annual Pro are one
            plan, so they are one row with two prices rather than two tiers. */}
        {tier.prices.length === 0 ? (
          <span className="admin-price-none">—</span>
        ) : (
          tier.prices.map((price) => (
            <span key={price.interval} className="admin-price-line">
              <code className="mp-code">{price.stripePriceId}</code>
              <Badge>{price.interval}</Badge>
            </span>
          ))
        )}
      </td>
      <td>
        <span className="admin-states">
          <Badge tone={tier.published ? "ok" : draft ? "warn" : "neutral"}>
            {tier.published ? "on sale" : draft ? "draft" : "not on sale"}
          </Badge>
          {tier.isDefault ? <Badge tone="accent">default</Badge> : null}
        </span>
      </td>
      <td>
        <div className="admin-row-actions">
          {/* Quiet until they are wanted: three solid buttons per row is a wall of
              chrome down the right of the table, and the row is what an operator is
              reading. The one whose form is open stops being quiet, so the panel at
              the top of the page has a row it visibly belongs to. */}
          <Button shape="rect" tone={editing ? "secondary" : "ghost"} onClick={onEdit} disabled={busy}>
            Edit
          </Button>
          <Button
            shape="rect"
            tone={pricing ? "secondary" : "ghost"}
            onClick={onAddPrice}
            disabled={busy}
          >
            Prices
          </Button>
          {tier.isDefault ? null : (
            <Button shape="rect" tone="ghost" onClick={onMakeDefault} disabled={busy}>
              Make default
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * The panel every form is drawn in: what you are doing, to what, and a way out of
 * it that is in the same place every time.
 */
function FormPanel({
  title,
  lede,
  onCancel,
  children,
}: {
  title: string;
  lede?: ReactNode;
  onCancel: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="admin-form">
      <div className="admin-form-head">
        <div>
          <h2 className="admin-form-title">{title}</h2>
          {lede ? <p className="admin-form-lede">{lede}</p> : null}
        </div>
        <Button shape="rect" tone="ghost" onClick={onCancel} aria-label={`Close ${title}`}>
          Close
        </Button>
      </div>
      {children}
    </section>
  );
}

/**
 * The edit form, total over the four editable fields.
 *
 * **The flags are a number and a hatch** (`FeaturesField`, T69). They were a JSON
 * textarea while `features` was an open object with nothing behind it, and this
 * comment said as much — that the day the product decided on a schema was the day
 * it became a real control. ADR-0025 decided `bulk`, T68 seeded it and shipped two
 * readers of it, so the cap is set with the same gesture as the quota it sits
 * beside. The hatch keeps every other shape the column can hold reachable, which
 * is what stops a control over one key from being a form that drops the rest.
 *
 * **"On sale" is refused by the API for a tier with no Price**, and the hint says
 * so before the save rather than after: the way out is Stripe's, and a form that
 * only reported the `409` would be sending an operator to look in the wrong place.
 */
function TierForm({
  tier,
  busy,
  onCancel,
  onSave,
}: {
  tier: AdminTier;
  busy: boolean;
  onCancel: () => void;
  onSave: (edit: TierEdit) => void;
}): JSX.Element {
  const [name, setName] = useState(tier.tier.name);
  const [unlimited, setUnlimited] = useState(tier.relistQuotaPerPeriod === null);
  // The number the field holds while it is *not* unlimited, kept across a tick and
  // an untick so that changing your mind does not lose what you had typed.
  const [quota, setQuota] = useState(String(tier.relistQuotaPerPeriod ?? 0));
  const features = useFeatures(tier.features);
  const [published, setPublished] = useState(tier.published);
  const [problem, setProblem] = useState<string | null>(null);

  const grantsNothing = !unlimited && quotaIn(quota) === 0;
  // **Keyed on the checkbox rather than on the stored row**, because the submit
  // below is: `published && !grantsNothing` refuses both directions, and a warning
  // that only knew about one of them left the other silent. Ticking On sale on a
  // draft — which is quota 0 by definition (ADR-0019), and so the commonest way to
  // ask for this at all — saved with the box quietly back where it started, which
  // is the "quietly corrected" ADR-0029 names as the thing not to do.
  const wontSell = grantsNothing && published;

  const submit = (): void => {
    const parsedQuota = unlimited ? null : quotaIn(quota);
    if (parsedQuota === undefined) {
      setProblem("Relists per period has to be a whole number, and not a negative one.");
      return;
    }
    const flags = features.read();
    if ("problem" in flags) {
      setProblem(flags.problem);
      return;
    }
    if (!name.trim()) {
      setProblem("A tier needs a name — it is what you will look for in this list.");
      return;
    }
    setProblem(null);
    onSave({
      name: name.trim(),
      relistQuotaPerPeriod: parsedQuota,
      features: flags.features,
      // **Withdrawn in the same submit**, rather than sent to be refused. A
      // published tier granting nothing is a `409` (ADR-0029), and since this is a
      // whole `PUT`, zeroing and withdrawing are one request. Said on the form —
      // `NewPlanForm`'s existing habit — because a round trip to be told what is
      // already visible here is not an answer, it is a delay.
      published: published && !grantsNothing,
    });
  };

  return (
    <FormPanel
      title={`Editing ${tier.tier.name}`}
      lede={
        <>
          The tier stored under <code>{tier.tier.code}</code>. Its price is Stripe&apos;s and is not
          edited here.
        </>
      }
      onCancel={onCancel}
    >
      <div className="admin-form-grid">
        <Field label="Name" hint="Display text, and yours to rewrite.">
          <Input id="tier-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field
          label="Relists per period"
          hint="0 on the default tier is how “there is no free tier” is said."
        >
          <Input
            id="tier-quota"
            type="number"
            min={0}
            value={unlimited ? "" : quota}
            disabled={unlimited}
            onChange={(event) => setQuota(event.target.value)}
          />
        </Field>
      </div>
      {/* Ticked, the number above has nothing to say, so it is greyed rather than
          left holding a value the save would ignore (ADR-0029). */}
      <Checkbox
        id="tier-unlimited"
        label="Unlimited — no cap on how many reposts a period grants"
        checked={unlimited}
        onChange={(event) => setUnlimited(event.target.checked)}
      />
      <FeaturesFieldset field={features} id="tier" />
      <Checkbox
        id="tier-published"
        label="On sale — people can buy this from the extension"
        checked={published}
        onChange={(event) => setPublished(event.target.checked)}
      />
      <ul className="admin-notes">
        {tier.prices.length === 0 ? (
          <li>
            This tier has no Stripe price, so it cannot go on sale. Add one with <b>Prices</b> on its
            row, or create it in Stripe tagged <code>metadata.tier_code = {tier.tier.code}</code> —
            either way the same sync adopts it.
          </li>
        ) : null}
        <li>
          Lowering the quota under existing subscribers is allowed: what is left of their period is
          this number minus what they have spent, and never less than zero.
        </li>
      </ul>
      {/* The two warnings ADR-0029 asks for, and they are warnings rather than
          refusals for different reasons: one is a consequence this form then
          carries out itself, and the other is a configuration somebody may
          genuinely want. */}
      {/* Two sentences, because they are two different events: one takes something
          off sale that is on it, and the other declines to put something there. A
          tier that was never on sale has nobody on it to reassure about, and
          telling its operator what happens to "everybody already on it" would be
          answering about a plan they have not sold yet. */}
      {wontSell ? (
        <Note tone="warn">
          {tier.published ? (
            <>
              A plan that grants nothing cannot be sold, so saving this will also take{" "}
              {tier.tier.name} <b>off sale</b>. Everybody already on it keeps the tier and has
              nothing to spend until you raise this again.
            </>
          ) : (
            <>
              A plan that grants nothing cannot be sold, so saving this will <b>not</b> put{" "}
              {tier.tier.name} on sale. Give it some reposts — or tick Unlimited — and it can go on
              sale in the same save.
            </>
          )}
        </Note>
      ) : null}
      {unlimited && tier.isDefault ? (
        <Note tone="warn">
          {tier.tier.name} is the <b>default tier</b>, so this gives unlimited reposts to every new
          account — and to everybody whose subscription ends, since they fall back here. That is a
          real configuration for a single-user deployment and a costly accident otherwise.
        </Note>
      ) : null}
      {problem ? <Note tone="error">{problem}</Note> : null}
      <div className="admin-form-actions">
        <Button shape="rect" tone={busy ? "busy" : "primary"} onClick={submit}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button shape="rect" tone="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}

/**
 * The form that creates a plan in Stripe and a tier here, in one submit.
 *
 * **The currency list is Stripe's**, not ours — what this account can actually
 * settle in, which is a shorter list than Stripe's hundred and thirty and a
 * different one per country. Where it cannot be fetched the form says so and will
 * not create anything, because the alternative is offering a currency that renders
 * a plan card and fails at Checkout.
 *
 * **Both rhythms, on the one form** (T66). Monthly and annual are one plan a buyer
 * picks a rhythm for — T62 (#128) made a tier able to hold both — so both amounts
 * are stated where the plan is created. Before, the form wrote one and the second
 * was a separate act an operator had to remember; in between, the plan card offered
 * no choice, which is the choice a buyer is actually making. Neither is *required*:
 * a plan sold only by the month is a real plan, and a form that insisted on an
 * annual amount would be making one up to satisfy itself.
 *
 * **Money is typed the way money is written**, and turned into Stripe's smallest
 * unit on the way out (`money.ts`). The field used to be labelled "Amount, in
 * cents" and took `999` — the wire format on a screen, converted in an operator's
 * head, into a Price that can never be edited afterwards.
 *
 * **Each amount is still written once.** This is the only place in this product
 * where one is set, and the notes say as much: Stripe Prices are immutable, so
 * changing it later means a new Price — which is exactly what ADR-0019 refused to
 * pretend a form field could do.
 *
 * **The code is not typed** — see `tier-code.ts`. It is derived from the name and
 * printed while the name is being typed, because it is permanent and turns up in
 * Stripe, and because two fields where the second is always a flattened copy of
 * the first is a field that can disagree with itself.
 */
function NewPlanForm({
  currency,
  busy,
  onCancel,
  onCreate,
}: {
  currency: CurrencyAnswer | null;
  busy: boolean;
  onCancel: () => void;
  onCreate: (plan: NewPlan) => void;
}): JSX.Element {
  const pricedIn = currency?.status === "ready" ? currency.currency : null;
  const [name, setName] = useState("");
  // One field per rhythm, keyed by the rhythm rather than held in two `useState`s:
  // what is being collected is a price list, and the submit below reads it as one.
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [quota, setQuota] = useState("0");
  const [unlimited, setUnlimited] = useState(false);
  // A plan is created with its cap rather than created and then edited: the flags
  // used to be a hardcoded `{}` here, so setting one was a second act an operator
  // had to remember (T69).
  const features = useFeatures(NO_FLAGS);
  const [problem, setProblem] = useState<string | null>(null);

  if (!pricedIn) {
    return (
      <FormPanel title="New plan" onCancel={onCancel}>
        <Note tone="warn">
          Stripe could not say what this account settles in, so a plan cannot be priced here right now.
          Creating one in the Stripe dashboard, tagged with its tier code, still works.
        </Note>
      </FormPanel>
    );
  }

  const tierCode = tierCodeFrom(name);

  const submit = (): void => {
    if (!name.trim()) {
      setProblem("A plan needs a name. It is what Stripe calls the Product too.");
      return;
    }
    // A name with no letter or digit anywhere in it — "!!!" — derives to nothing,
    // and the code is what the plan is filed under. Said here rather than sent to
    // an API that would refuse a blank, which is a round trip to be told what is
    // already visible on this form.
    if (!tierCode) {
      setProblem("A name needs a letter or a digit in it: the code the plan is filed under is made from it.");
      return;
    }
    // In RHYTHMS' order, so the cheapest rhythm is first however the fields were
    // filled in — which is the order `GET /api/plans` answers in and the order a
    // card reads.
    const prices: NewPrice[] = [];
    for (const rhythm of RHYTHMS) {
      const typed = amounts[rhythm.interval]?.trim() ?? "";
      if (!typed) continue;
      const amount = amountInMinorUnits(typed, pricedIn);
      if (amount === null) {
        setProblem(amountProblem(rhythm, pricedIn));
        return;
      }
      prices.push({ amount, interval: rhythm.interval });
    }
    if (prices.length === 0) {
      setProblem(
        "A plan states what it costs. Price it by the month, by the year, or both — a buyer picks " +
          "which on the card.",
      );
      return;
    }
    const relists = unlimited ? null : quotaIn(quota);
    if (relists === undefined) {
      setProblem("Relists per period has to be a whole number, and not a negative one.");
      return;
    }
    const flags = features.read();
    if ("problem" in flags) {
      setProblem(flags.problem);
      return;
    }
    setProblem(null);
    onCreate({
      tierCode,
      name: name.trim(),
      prices,
      relistQuotaPerPeriod: relists,
      features: flags.features,
      published: false,
    });
  };

  return (
    <FormPanel
      title="New plan"
      lede="Created in Stripe and adopted here, in one step."
      onCancel={onCancel}
    >
      <div className="admin-form-grid">
        <Field
          label="Name"
          hint={
            <>
              What buyers see, and what Stripe calls the Product. Filed under{" "}
              <code className="mp-code">{tierCode || "…"}</code>, which is permanent.
            </>
          }
        >
          <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {RHYTHMS.map((rhythm, index) => (
          <Field
            key={rhythm.interval}
            label={`${rhythm.fieldLabel}, in ${pricedIn.toUpperCase()}`}
            // Said once, under the first of them, rather than under each: it is one
            // instruction about a pair of fields, and twice reads as two rules.
            hint={
              index === 0
                ? `Written the way money is — ${exampleAmount(pricedIn)}. Leave one empty to not sell at it.`
                : undefined
            }
          >
            <Input
              // Text rather than `type="number"`: a number field will not hold the
              // comma a Dutch operator types, and it changes its own value on a
              // stray scroll — which here would be a wrong price in an immutable
              // Stripe Price. `inputMode` still brings up the numeric keypad.
              id={`plan-amount-${rhythm.interval}`}
              inputMode="decimal"
              placeholder={exampleAmount(pricedIn)}
              value={amounts[rhythm.interval] ?? ""}
              onChange={(e) =>
                setAmounts((typed) => ({ ...typed, [rhythm.interval]: e.target.value }))
              }
            />
          </Field>
        ))}
        <Field label="Relists per period" hint="How many reposts a subscriber gets each period.">
          <Input
            id="plan-quota"
            type="number"
            min={0}
            value={unlimited ? "" : quota}
            disabled={unlimited}
            onChange={(e) => setQuota(e.target.value)}
          />
        </Field>
      </div>
      <Checkbox
        id="plan-unlimited"
        label="Unlimited — no cap on how many reposts a period grants"
        checked={unlimited}
        onChange={(e) => setUnlimited(e.target.checked)}
      />
      <FeaturesFieldset field={features} id="plan" />
      <ul className="admin-notes">
        {/* Shown, not chosen (T63, #129). Every tier is priced in what this Stripe
            account settles in — a plan screen is a comparison, and two currencies
            on it is not one a buyer can make. */}
        <li>
          Priced in <b>{pricedIn.toUpperCase()}</b>, like every tier — that is what this Stripe
          account settles in.
        </li>
        <li>
          Price it at both rhythms and the plan card offers the buyer the choice; price it at one and
          it sells at that one. A rhythm can be added later from the plan&apos;s row.
        </li>
        <li>
          The amount is written once. Stripe prices cannot be edited: changing it later means a new
          price in Stripe tagged <code>metadata.tier_code = {tierCode || "…"}</code>, and everybody
          already subscribed keeps the amount they signed up at.
        </li>
        <li>
          It is created <b>not on sale</b>. Check what Stripe made, then put it on sale from its row.
        </li>
      </ul>
      {problem ? <Note tone="error">{problem}</Note> : null}
      <div className="admin-form-actions">
        <Button shape="rect" tone={busy ? "busy" : "primary"} onClick={submit}>
          {busy ? "Creating…" : "Create in Stripe"}
        </Button>
        <Button shape="rect" tone="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}

/**
 * Adding a rhythm to a plan, or repricing one (T62, #128).
 *
 * **The rhythms it offers are the ones this tier does not already sell at** —
 * except that picking one it *does* is the way to reprice, which is why the list is
 * every rhythm with the existing ones marked rather than the missing ones only. An
 * operator who does not know Stripe Prices are immutable would otherwise look for
 * an edit field and not find one.
 */
function NewPriceForm({
  tier,
  currency,
  busy,
  onCancel,
  onAdd,
}: {
  tier: AdminTier;
  currency: CurrencyAnswer | null;
  busy: boolean;
  onCancel: () => void;
  onAdd: (price: NewPrice) => void;
}): JSX.Element {
  const code = tier.tier.code;
  const sellsAt = tier.prices.map((price) => price.interval);
  const pricedIn = currency?.status === "ready" ? currency.currency : null;
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(sellsAt.includes("month") ? "year" : "month");
  const [problem, setProblem] = useState<string | null>(null);

  if (!pricedIn) {
    return (
      <FormPanel title={`Prices for ${tier.tier.name}`} onCancel={onCancel}>
        <Note tone="warn">
          Stripe could not say what this account settles in, so a price cannot be added here right now.
        </Note>
      </FormPanel>
    );
  }

  const replacing = sellsAt.includes(interval);
  const submit = (): void => {
    const minor = amountInMinorUnits(amount, pricedIn);
    if (minor === null) {
      setProblem(amountProblem(rhythmNamed(interval), pricedIn));
      return;
    }
    setProblem(null);
    onAdd({ amount: minor, interval });
  };

  return (
    <FormPanel
      title={`Prices for ${tier.tier.name}`}
      lede={
        <>
          A price for <code>{code}</code>, in {pricedIn.toUpperCase()}.
        </>
      }
      onCancel={onCancel}
    >
      <div className="admin-form-grid">
        <Field label="Billed every">
          <Select id="price-interval" value={interval} onChange={(e) => setInterval(e.target.value)}>
            {RHYTHMS.map((rhythm) => (
              <option key={rhythm.interval} value={rhythm.interval}>
                {rhythm.interval}
                {sellsAt.includes(rhythm.interval) ? " — already sold, replaces it" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`Amount, in ${pricedIn.toUpperCase()}`}
          hint={`Written the way money is — ${exampleAmount(pricedIn)}.`}
        >
          <Input
            // Text, for the reason the new-plan form's fields are (T66).
            id="price-amount"
            inputMode="decimal"
            placeholder={exampleAmount(pricedIn)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      </div>
      <ul className="admin-notes">
        <li>
          A rhythm this plan does not sell at yet puts the two side by side on one plan card; picking
          one it already sells at creates a replacement price — which is the only way to reprice,
          because Stripe prices cannot be edited.
        </li>
        {replacing ? (
          <li>
            <b>Everybody already subscribed keeps the price they signed up at.</b> That is what
            Stripe&apos;s immutability means, and no screen can change it — they move when they cancel
            and buy again.
          </li>
        ) : null}
      </ul>
      {problem ? <Note tone="error">{problem}</Note> : null}
      <div className="admin-form-actions">
        <Button shape="rect" tone={busy ? "busy" : "primary"} onClick={submit}>
          {busy ? "Creating…" : replacing ? "Replace in Stripe" : "Add in Stripe"}
        </Button>
        <Button shape="rect" tone="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </FormPanel>
  );
}

/**
 * The rhythms a plan may be sold at on this screen, cheapest first (T66).
 *
 * **One list, read by three things** — the new-plan form's fields, the add-a-rhythm
 * form's options, and the sentence that says which rhythm Stripe would not make.
 * They were three copies of `month` and `year` before, which is three places to
 * edit if a plan is ever sold weekly and two of them to forget.
 *
 * Stripe bills by the day and the week too, and neither is offered: a subscription
 * to a relisting quota is not something anybody sells by the day, and an option
 * that exists is an option somebody can pick by accident into a Price that cannot
 * be edited afterwards. A Price created in the Stripe dashboard at any rhythm is
 * still adopted — the catalog stores whatever Stripe says — so this list narrows
 * the form rather than the product.
 */
interface Rhythm {
  /** Stripe's vocabulary, which is what travels on the wire and keys a tier's prices. */
  interval: string;
  /** What the amount field for it is labelled: "Monthly price". */
  fieldLabel: string;
  /** What a sentence calls it: "the monthly price". */
  named: string;
}

const RHYTHMS: readonly Rhythm[] = [
  { interval: "month", fieldLabel: "Monthly price", named: "monthly" },
  { interval: "year", fieldLabel: "Yearly price", named: "yearly" },
];

/**
 * What a plan's flags start as, and the one place this screen writes `{}` at all.
 *
 * A constant rather than a literal in the call, so that the create form's fieldset
 * is not handed a new object on every render — the state it seeds from is read
 * once, and a fresh one each time is the kind of thing that becomes true later.
 */
const NO_FLAGS: Record<string, unknown> = {};

/**
 * The rhythm this screen knows by that interval, or a stand-in named after the
 * interval itself.
 *
 * The fallback is not reachable from either caller today — both pass an interval
 * that came from {@link RHYTHMS}. It is here because the alternative is returning
 * `undefined` and making both call sites handle a case neither can produce, and
 * because a rhythm's `interval` is a wire string: a plan created against a Price
 * made in the Stripe dashboard at some other recurrence would arrive here, and a
 * sentence reading "the week price" is better than a blank one.
 */
function rhythmNamed(interval: string): Rhythm {
  return (
    RHYTHMS.find((rhythm) => rhythm.interval === interval) ?? {
      interval,
      fieldLabel: "Price",
      named: interval,
    }
  );
}

/**
 * What to say about an amount that is not one.
 *
 * The two ways to get it wrong — not a number, and more decimal places than the
 * currency has — are one sentence rather than two, because the correction is the
 * same and the difference between them is not something an operator is wondering
 * about while looking at the field.
 */
function amountProblem(rhythm: Rhythm, currency: string): string {
  const places = decimalsIn(currency);
  return (
    `The ${rhythm.named} amount has to be an amount` +
    (places === 0
      ? `, with no decimal places — ${currency.toUpperCase()} does not have any.`
      : `, with at most ${places} decimal places — ${exampleAmount(currency)}.`)
  );
}

/** `9,99` — what an amount looks like in this currency, for a placeholder and a hint. */
function exampleAmount(currency: string): string {
  const places = decimalsIn(currency);
  return places === 0 ? "1250" : `9,${"9".repeat(places)}`;
}

/**
 * The rhythms this plan was asked to be sold at that the tier did not come back
 * holding (T66).
 *
 * Two Prices are two Stripe calls with no transaction spanning them, so the annual
 * one can be refused once the monthly one exists — and the plan is created either
 * way, because that first Price is real, carries the tag and is adopted regardless.
 * What is left is telling the operator, which is what this is read for.
 */
function rhythmsMissingFrom(tier: AdminTier, asked: NewPlan): Rhythm[] {
  const sold = tier.prices.map((price) => price.interval);
  return asked.prices
    .filter((price) => !sold.includes(price.interval))
    .map((price) => rhythmNamed(price.interval));
}

/** "the Price" or "the Prices", so the good news is not written in the plural about one. */
function priceWord(plan: NewPlan): string {
  return plan.prices.length === 1 ? "Price" : "Prices";
}

/**
 * "the monthly price", or "the monthly and yearly prices" — the noun agreeing with
 * the list in front of it.
 *
 * Only ever one today: a `Created` is never empty, so at most one of two rhythms
 * can be missing. Written for the general case anyway because it is one line more
 * and the alternative — a sentence hardcoded singular — reads wrong the first time
 * a plan is sold at three rhythms, which is a wrongness nobody would go looking
 * for.
 */
function listedPrices(names: string[]): string {
  const joined =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `the ${joined} price${names.length > 1 ? "s" : ""}`;
}

/**
 * What a quota field says, read the one way both forms need it (T73, ADR-0029).
 *
 * **A blank field is `undefined` and not `0`.** `Number("") === 0`, so clearing the
 * box used to submit a tier granting nothing — silently, at both call sites, and on
 * the default tier that is ADR-0019's "there is no free tier" applied by accident.
 * Three answers rather than two, because "nothing typed" and "zero typed" are
 * different things an operator did.
 *
 * @returns the number, or `undefined` where the field says nothing usable.
 * `null` is not one of these: unlimited is the checkbox beside the field, never a
 * value typed into it
 */
function quotaIn(typed: string): number | undefined {
  if (typed.trim() === "") return undefined;
  const quota = Number(typed);
  return Number.isInteger(quota) && quota >= 0 ? quota : undefined;
}

/** What a tier's quota reads as in the table — a number, or the word for no cap. */
function quotaColumn(quota: number | null): string {
  return quota === null ? "Unlimited" : String(quota);
}

/**
 * A tier the Stripe sync invented from an unrecognised Price: quota 0, unbuyable,
 * and something an operator has to finish. The one row on this screen that is a job
 * rather than a fact.
 *
 * Still literally quota 0, and deliberately: a draft is "nobody has said what this
 * grants" and unlimited is somebody saying it (ADR-0029), so a `null` here is a
 * decision rather than a job.
 */
function isDraft(tier: AdminTier): boolean {
  return !tier.published && tier.relistQuotaPerPeriod === 0 && tier.prices.length > 0;
}

function tierIn(tiers: AdminTier[], code: string): AdminTier | null {
  return tiers.find((tier) => tier.tier.code === code) ?? null;
}

/** What each refusal of a *creation* means, which is not what the edit form's mean. */
function whyNotCreated(answer: CreateAnswer): string {
  switch (answer.status) {
    case "exists":
      return "A tier already uses that code. Codes are permanent, so pick another one.";
    case "refused":
      // Stripe's own sentence. It names what to change; nothing here could.
      return answer.problem;
    case "rejected":
      return "The API would not take that plan.";
    case "forbidden":
      return "This account no longer has the ADMIN role.";
    default:
      return "The API could not be reached. Nothing was created.";
  }
}

/** What each refusal means to the person looking at the form. */
function refusal(answer: EditAnswer): string {
  switch (answer.status) {
    case "unsellable":
      // Two facts behind one status since ADR-0029, and both are on the row the
      // form is open over — so the sentence names them and the reload shows which.
      return (
        "That tier cannot go on sale: it either has no Stripe Price — create one in Stripe tagged " +
        "with its code — or grants no reposts. Reload the catalog to see which."
      );
    case "gone":
      return "No tier is stored under that code any more. Reload the catalog.";
    case "rejected":
      return "The API would not take that edit.";
    case "forbidden":
      return "This account no longer has the ADMIN role.";
    default:
      return "The API could not be reached. Nothing was changed.";
  }
}
