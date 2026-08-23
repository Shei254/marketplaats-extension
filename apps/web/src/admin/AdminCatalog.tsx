import type {
  AdminTier,
  NewPlan,
  NewPrice,
  TierEdit,
  UntaggedPrice,
} from "@mprelist/contracts";
import { Badge, Button, Card, Note } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX } from "react";

import type {
  AdminApi,
  CatalogAnswer,
  CreateAnswer,
  CurrencyAnswer,
  EditAnswer,
  PricesAnswer,
} from "./admin-api";

/**
 * The tier catalog, and the Stripe Prices nobody tagged (T54, #85).
 *
 * **A table rather than cards**, which is the one deliberate departure from
 * everything else in this repository: the plan cards are a screen somebody is
 * being sold something on, and this is a screen somebody compares eight numbers
 * across five rows on. There is no artboard for it — the canvas draws the popup
 * and the public pages — so it is built out of the same tokens rather than out of
 * a design nobody made.
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
}: {
  api: AdminApi;
  /** The token this tab holds has expired — there is no refresh, so this is a redirect. */
  onSignedOut: () => void;
}): JSX.Element {
  const [catalog, setCatalog] = useState<CatalogAnswer | null>(null);
  const [prices, setPrices] = useState<PricesAnswer | null>(null);
  const [currency, setCurrency] = useState<CurrencyAnswer | null>(null);
  const [creating, setCreating] = useState(false);
  /** Which tier is having a rhythm added or repriced, if any (T62, #128). */
  const [pricing, setPricing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
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
        setEditing(null);
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
        setCreating(false);
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
        setPricing(null);
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

  if (!catalog || !prices) return <p className="admin-empty">Loading the catalog…</p>;
  if (catalog.status === "forbidden" || prices.status === "forbidden") {
    // Reachable only if the role went away between the token being minted and this
    // call — the screen above already checks it. Said rather than rendered empty.
    return <Note tone="error">This account no longer has the ADMIN role.</Note>;
  }
  if (catalog.status !== "ready") {
    return (
      <div className="admin-empty">
        <Note tone="warn">The catalog could not be loaded.</Note>
        <Button shape="rect" tone="secondary" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="admin-sections">
      <Card
        title="Tiers"
        lede="Every tier there is, including the drafts the Stripe sync creates and the free tier nobody buys. Amounts live in Stripe and are not editable here."
        // The section's own action, opposite its title: it makes a new row rather
        // than doing anything to the ones below, which is what a header control is.
        actions={
          <Button
            shape="rect"
            tone={creating ? "secondary" : "primary"}
            onClick={() => setCreating(!creating)}
            disabled={busy}
          >
            {creating ? "Cancel" : "New plan"}
          </Button>
        }
        flush
      >
        {note ? (
          <div className="admin-card-pad admin-card-pad--top">
            <Note tone={note.tone === "ok" ? "ok" : "error"}>{note.message}</Note>
          </div>
        ) : null}
        {/* The table scrolls inside the card rather than pushing the page sideways:
            five columns and three row actions do not fit a narrow window, and a
            page that scrolls horizontally loses its own header. */}
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
                onEdit={() => setEditing(tier.tier.code === editing ? null : tier.tier.code)}
                onAddPrice={() => setPricing(tier.tier.code === pricing ? null : tier.tier.code)}
                onMakeDefault={() => void makeDefault(tier)}
              />
            ))}
          </tbody>
        </table>
        </div>
        <div className="admin-card-pad">
        {creating ? (
          <NewPlanForm
            currency={currency}
            busy={busy}
            onCancel={() => setCreating(false)}
            onCreate={(plan) => void createPlan(plan)}
          />
        ) : null}
        {pricing ? (
          <NewPriceForm
            key={pricing}
            code={pricing}
            sellsAt={(catalog.tiers.find((tier) => tier.tier.code === pricing)?.prices ?? []).map(
              (price) => price.interval,
            )}
            currency={currency}
            busy={busy}
            onCancel={() => setPricing(null)}
            onAdd={(price) => void addPrice(pricing, price)}
          />
        ) : null}
        {editing ? (
          <TierForm
            // Remounted per tier: the form holds the row's values as its own state,
            // so a shared instance would open the next tier showing the last one's.
            key={editing}
            tier={catalog.tiers.find((tier) => tier.tier.code === editing) ?? null}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(edit) => void save(editing, edit)}
          />
        ) : null}
        </div>
      </Card>
      <UnadoptedPrices answer={prices} />
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
  onEdit,
  onAddPrice,
  onMakeDefault,
}: {
  tier: AdminTier;
  busy: boolean;
  onEdit: () => void;
  onAddPrice: () => void;
  onMakeDefault: () => void;
}): JSX.Element {
  const draft = !tier.published && tier.relistQuotaPerPeriod === 0 && tier.prices.length > 0;
  return (
    <tr data-draft={draft}>
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
          <Button shape="rect" tone="ghost" onClick={onEdit} disabled={busy}>
            Edit
          </Button>
          <Button shape="rect" tone="ghost" onClick={onAddPrice} disabled={busy}>
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
  tier: AdminTier | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (edit: TierEdit) => void;
}): JSX.Element | null {
  const [name, setName] = useState(tier?.tier.name ?? "");
  const [quota, setQuota] = useState(String(tier?.relistQuotaPerPeriod ?? 0));
  const [features, setFeatures] = useState(JSON.stringify(tier?.features ?? {}, null, 2));
  const [published, setPublished] = useState(tier?.published ?? false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!tier) return null;

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
    <div className="admin-form">
      <p className="admin-form-title">Editing {tier.tier.name}</p>
      <div className="admin-form-grid">
      <div className="mp-field">
        <label className="mp-label" htmlFor="tier-name">Name</label>
        <input
          id="tier-name"
          type="text"
          className="mp-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <span className="mp-hint">Display text, and yours to rewrite.</span>
      </div>
      <div className="mp-field">
        <label className="mp-label" htmlFor="tier-quota">Relists per period</label>
        <input
          id="tier-quota"
          type="number"
          className="mp-input"
          min={0}
          value={quota}
          onChange={(event) => setQuota(event.target.value)}
        />
        <span className="mp-hint">0 on the default tier is how “there is no free tier” is said.</span>
      </div>
      </div>
      <div className="mp-field">
        <label className="mp-label" htmlFor="tier-features">Feature flags, as JSON</label>
        <textarea
          className="mp-textarea"
          id="tier-features"
          value={features}
          onChange={(event) => setFeatures(event.target.value)}
        />
      </div>
      <div className="mp-check-row">
        <input
          id="tier-published"
          type="checkbox"
          className="mp-check"
          checked={published}
          onChange={(event) => setPublished(event.target.checked)}
        />
        <label htmlFor="tier-published">On sale</label>
      </div>
      {tier.prices.length === 0 ? (
        <p className="mp-hint">
          This tier has no Stripe Price, so it cannot go on sale. Add one below, or create it in Stripe
          tagged <code>metadata.tier_code = {tier.tier.code}</code> — either way the same sync adopts it.
        </p>
      ) : null}
      <p className="mp-hint">
        Lowering the quota under existing subscribers is allowed: what is left of their period is this
        number minus what they have spent, and never less than zero.
      </p>
      {problem ? <Note tone="error">{problem}</Note> : null}
      <div className="admin-form-actions">
        <Button shape="rect" tone={busy ? "busy" : "primary"} onClick={submit}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button shape="rect" tone="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
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
 * is set, and the hint says as much: Stripe Prices are immutable, so changing it
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
      <div className="admin-form">
        <Note tone="warn">
          Stripe could not say what this account settles in, so a plan cannot be priced here right now.
          Creating one in the Stripe dashboard, tagged with its tier code, still works.
        </Note>
        <div className="admin-form-actions">
          <Button shape="rect" tone="secondary" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
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
    <div className="admin-form">
      <p className="admin-form-title">A new plan, created in Stripe and adopted here</p>
      <div className="admin-form-grid">
      <div className="mp-field">
        <label className="mp-label" htmlFor="plan-code">Tier code</label>
        <input id="plan-code" type="text" className="mp-input" value={tierCode} onChange={(e) => setTierCode(e.target.value)} />
        <span className="mp-hint">The stable handle, and the tag on the Stripe Price.</span>
      </div>
      <div className="mp-field">
        <label className="mp-label" htmlFor="plan-name">Name</label>
        <input id="plan-name" type="text" className="mp-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="mp-field">
        <label className="mp-label" htmlFor="plan-amount">Amount, in cents</label>
        <input id="plan-amount" type="number" className="mp-input" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="mp-hint">999 is 9.99 {pricedIn.toUpperCase()}.</span>
      </div>
      <div className="mp-field">
        <label className="mp-label" htmlFor="plan-interval">Billed every</label>
        <select id="plan-interval" className="mp-select" value={interval} onChange={(e) => setInterval(e.target.value)}>
          <option value="month">month</option>
          <option value="year">year</option>
        </select>
      </div>
      <div className="mp-field">
        <label className="mp-label" htmlFor="plan-quota">Relists per period</label>
        <input id="plan-quota" type="number" className="mp-input" min={0} value={quota} onChange={(e) => setQuota(e.target.value)} />
      </div>
      </div>
      {/* Shown, not chosen (T63, #129). Every tier is priced in what this Stripe
          account settles in — a plan screen is a comparison, and two currencies on
          it is not one a buyer can make. */}
      <p className="mp-hint">
        Priced in <b>{pricedIn.toUpperCase()}</b>, like every tier — that is what this Stripe account
        settles in, and one catalog in two currencies is a plan screen nobody can compare.
      </p>
      <p className="mp-hint">
        The amount is written once. Stripe Prices cannot be edited — changing it later means creating a
        new Price in Stripe tagged <code>metadata.tier_code = {tierCode || "…"}</code>, which repoints this
        tier. Everybody already subscribed keeps the amount they signed up at.
      </p>
      <p className="mp-hint">
        It is created <b>not on sale</b>. Check what Stripe made, then put it on sale from the row above.
      </p>
      {problem ? <Note tone="error">{problem}</Note> : null}
      <div className="admin-form-actions">
        <Button shape="rect" tone={busy ? "busy" : "primary"} onClick={submit}>
          {busy ? "Creating…" : "Create in Stripe"}
        </Button>
        <Button shape="rect" tone="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
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
  code,
  sellsAt,
  currency,
  busy,
  onCancel,
  onAdd,
}: {
  code: string;
  sellsAt: string[];
  currency: CurrencyAnswer | null;
  busy: boolean;
  onCancel: () => void;
  onAdd: (price: NewPrice) => void;
}): JSX.Element {
  const pricedIn = currency?.status === "ready" ? currency.currency : null;
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(sellsAt.includes("month") ? "year" : "month");
  const [problem, setProblem] = useState<string | null>(null);

  if (!pricedIn) {
    return (
      <div className="admin-form">
        <Note tone="warn">
          Stripe could not say what this account settles in, so a price cannot be added here right now.
        </Note>
        <div className="admin-form-actions">
          <Button shape="rect" tone="secondary" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
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
    <div className="admin-form">
      <p className="mp-hint">
        A price for <b>{code}</b>. Adding a rhythm it does not sell at yet puts the two side by side on
        one plan card; picking one it already sells at creates a replacement Price — which is the only
        way to reprice, because Stripe Prices cannot be edited.
      </p>
      <div className="mp-field">
        <label className="mp-label" htmlFor="price-interval">Billed every</label>
        <select id="price-interval" value={interval} onChange={(e) => setInterval(e.target.value)}>
          <option value="month">month{sellsAt.includes("month") ? " — already sold, replaces it" : ""}</option>
          <option value="year">year{sellsAt.includes("year") ? " — already sold, replaces it" : ""}</option>
        </select>
      </div>
      <div className="mp-field">
        <label className="mp-label" htmlFor="price-amount">Amount, in cents</label>
        <input id="price-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {replacing ? (
        <p className="mp-hint">
          <b>Everybody already subscribed keeps the price they signed up at.</b> That is what Stripe&apos;s
          immutability means, and no screen can change it — they move when they cancel and buy again.
        </p>
      ) : null}
      {problem ? <Note tone="error">{problem}</Note> : null}
      <div className="admin-form-actions">
        <Button shape="rect" tone={busy ? "busy" : "primary"} onClick={submit}>
          {busy ? "Creating…" : replacing ? "Replace in Stripe" : "Add in Stripe"}
        </Button>
        <Button shape="rect" tone="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
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

/**
 * The Stripe Prices carrying no `tier_code` — the list that makes a forgotten tag
 * visible rather than silent (ADR-0019).
 *
 * **It lists and does nothing.** There is no adopt button, because Stripe accounts
 * hold Prices for one-offs, coupons and experiments, and only the operator can
 * tell an experiment from a mistake. Adopting is done in Stripe, by adding the
 * tag, which fires `price.updated` and goes through the sync that already exists.
 */
function UnadoptedPrices({ answer }: { answer: PricesAnswer }): JSX.Element {
  return (
    <Card
      title="Stripe Prices with no tier"
      lede={
        <>
          Prices in Stripe carrying no <code className="mp-code">metadata.tier_code</code>. Not all of
          them are mistakes — one-offs and experiments live here too — but a plan you meant to create
          and cannot find will be in this list. Add the tag in Stripe and it becomes a tier.
        </>
      }
      flush
    >
      {answer.status !== "ready" ? (
        <div className="admin-card-pad admin-card-pad--top">
          <Note tone="warn">Stripe could not be asked, so this list is unknown rather than empty.</Note>
        </div>
      ) : answer.prices.length === 0 ? (
        <p className="admin-empty">Every Price in Stripe names a tier.</p>
      ) : (
        <div className="admin-table-scroll">
        <table className="mp-table admin-table">
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
              <PriceRow key={price.id} price={price} />
            ))}
          </tbody>
        </table>
        </div>
      )}
    </Card>
  );
}

function PriceRow({ price }: { price: UntaggedPrice }): JSX.Element {
  return (
    <tr>
      <td><code className="mp-code">{price.id}</code></td>
      <td>{price.nickname ?? "—"}</td>
      <td className="admin-numeric">
        {(price.amount / 100).toFixed(2)} {price.currency.toUpperCase()}
      </td>
      {/* A one-off is the commonest thing in this list that is not a mistake. */}
      <td>{price.interval ?? "one-off"}</td>
    </tr>
  );
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
