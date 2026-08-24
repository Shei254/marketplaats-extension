import type { AdminTier, NewPlan, NewPrice, TierEdit } from "@mprelist/contracts";
import { Badge, Button, Card, Checkbox, Field, Input, Note, Select, Textarea } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";

import { AdminPrices } from "./AdminPrices";
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

/**
 * The signed-in half of `/admin`: the pages, the data behind them, and the writes
 * an operator makes (T54, #85; T62, #128).
 *
 * **One load for the whole surface.** The catalog, the untagged Stripe prices and
 * the currency arrive together and are held here rather than in the page that
 * shows them — which is what lets the sidebar carry a count for a page nobody has
 * opened, and what stops switching pages from being a fetch.
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
 * **What it will not offer**: creating a tier, deleting one, or typing a Stripe
 * Price id. A plan is created by tagging a Price in Stripe and the sync drafts the
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
  const [note, setNote] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
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
        setNote({ tone: "ok", message: `${plan.name} created, and Stripe has the Price.` });
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
  const untagged = prices?.status === "ready" ? prices.prices.length : 0;

  return (
    <AdminShell
      page={page}
      onNavigate={(next) => {
        setPage(next);
        // A note is about the thing that just happened on the page it happened on;
        // carried to another page it is a sentence with no subject in sight.
        setNote(null);
      }}
      counts={{ prices: untagged }}
      role={ADMIN_ROLE}
      onSignOut={onSignOut}
      actions={
        // Nothing while a form is open, and that is the point of it: the panel is
        // on screen with its own way out, and a second control in the corner
        // saying "Close" is a second thing to have to read.
        page === "tiers" && ready && !panel ? (
          <Button shape="rect" onClick={() => setPanel({ kind: "new" })} disabled={busy}>
            New plan
          </Button>
        ) : undefined
      }
    >
      {page === "prices" ? (
        <AdminPrices answer={prices} />
      ) : (
        <Tiers
          catalog={catalog}
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
      )}
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
  currency: CurrencyAnswer | null;
  panel: Panel;
  note: { tone: "ok" | "error"; message: string } | null;
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
      {note ? <Note tone={note.tone === "ok" ? "ok" : "error"}>{note.message}</Note> : null}
      <Summary tiers={catalog.tiers} currency={currency} />
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
      <td className="admin-numeric">{tier.relistQuotaPerPeriod}</td>
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
 * **The flags are a JSON textarea**, which is honest rather than lazy: `features`
 * is an open object, every tier carries `{}` today, and no flag has an
 * implementation behind it (ADR-0014). A set of checkboxes would be inventing a
 * schema this product has not decided on, and the day it does is the day this
 * becomes a real control.
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
  const [quota, setQuota] = useState(String(tier.relistQuotaPerPeriod));
  const [features, setFeatures] = useState(JSON.stringify(tier.features, null, 2));
  const [published, setPublished] = useState(tier.published);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (): void => {
    const parsedQuota = Number(quota);
    if (!Number.isInteger(parsedQuota) || parsedQuota < 0) {
      setProblem("Relists per period has to be a whole number, and not a negative one.");
      return;
    }
    let parsedFeatures: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(features || "{}");
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("not an object");
      }
      parsedFeatures = value as Record<string, unknown>;
    } catch {
      setProblem("Feature flags have to be a JSON object, like {} or {\"bulk\": true}.");
      return;
    }
    if (!name.trim()) {
      setProblem("A tier needs a name — it is what you will look for in this list.");
      return;
    }
    setProblem(null);
    onSave({ name: name.trim(), relistQuotaPerPeriod: parsedQuota, features: parsedFeatures, published });
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
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Feature flags, as JSON">
        <Textarea
          id="tier-features"
          value={features}
          onChange={(event) => setFeatures(event.target.value)}
        />
      </Field>
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
 * **The amount is written once.** It is the only place in this product where one
 * is set, and the notes say as much: Stripe Prices are immutable, so changing it
 * later means a new Price — which is exactly what ADR-0019 refused to pretend a
 * form field could do.
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
  const [tierCode, setTierCode] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState("month");
  const [quota, setQuota] = useState("0");
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

  const submit = (): void => {
    const cents = Number(amount);
    if (!/^[a-z0-9-]+$/.test(tierCode)) {
      setProblem("A tier code is lower-case letters, digits and hyphens — it goes in a URL and in Stripe.");
      return;
    }
    if (!name.trim()) {
      setProblem("A plan needs a name. It is what Stripe calls the Product too.");
      return;
    }
    if (!Number.isInteger(cents) || cents < 0) {
      setProblem("The amount is in cents, as a whole number — 999 is €9.99.");
      return;
    }
    const relists = Number(quota);
    if (!Number.isInteger(relists) || relists < 0) {
      setProblem("Relists per period has to be a whole number, and not a negative one.");
      return;
    }
    setProblem(null);
    onCreate({
      tierCode,
      name: name.trim(),
      amount: cents,
      interval,
      relistQuotaPerPeriod: relists,
      features: {},
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
        <Field label="Tier code" hint="The stable handle, and the tag on the Stripe Price.">
          <Input id="plan-code" value={tierCode} onChange={(e) => setTierCode(e.target.value)} />
        </Field>
        <Field label="Name" hint="What buyers see, and what Stripe calls the Product.">
          <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Amount, in cents" hint={`999 is 9.99 ${pricedIn.toUpperCase()}.`}>
          <Input
            id="plan-amount"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Billed every">
          <Select id="plan-interval" value={interval} onChange={(e) => setInterval(e.target.value)}>
            <option value="month">month</option>
            <option value="year">year</option>
          </Select>
        </Field>
        <Field label="Relists per period" hint="How many reposts a subscriber gets each period.">
          <Input
            id="plan-quota"
            type="number"
            min={0}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
          />
        </Field>
      </div>
      <ul className="admin-notes">
        {/* Shown, not chosen (T63, #129). Every tier is priced in what this Stripe
            account settles in — a plan screen is a comparison, and two currencies
            on it is not one a buyer can make. */}
        <li>
          Priced in <b>{pricedIn.toUpperCase()}</b>, like every tier — that is what this Stripe
          account settles in.
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
    const cents = Number(amount);
    if (!Number.isInteger(cents) || cents < 0) {
      setProblem("The amount is in cents, as a whole number — 999 is €9.99.");
      return;
    }
    setProblem(null);
    onAdd({ amount: cents, interval });
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
            <option value="month">
              month{sellsAt.includes("month") ? " — already sold, replaces it" : ""}
            </option>
            <option value="year">
              year{sellsAt.includes("year") ? " — already sold, replaces it" : ""}
            </option>
          </Select>
        </Field>
        <Field label="Amount, in cents" hint={`999 is 9.99 ${pricedIn.toUpperCase()}.`}>
          <Input
            id="price-amount"
            type="number"
            min={0}
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
 * A tier the Stripe sync invented from an unrecognised Price: quota 0, unbuyable,
 * and something an operator has to finish. The one row on this screen that is a job
 * rather than a fact.
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
      return "That tier has no Stripe Price, so it cannot go on sale. Create one in Stripe tagged with its code.";
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
