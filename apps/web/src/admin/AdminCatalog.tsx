import type { AdminTier, TierEdit, UntaggedPrice } from "@mprelist/contracts";
import { Button, Note } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX } from "react";

import type { AdminApi, CatalogAnswer, EditAnswer, PricesAnswer } from "./admin-api";

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
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [tiers, untagged] = await Promise.all([api.tiers(), api.unadoptedPrices()]);
    if (tiers.status === "signed-out" || untagged.status === "signed-out") {
      onSignedOut();
      return;
    }
    setCatalog(tiers);
    setPrices(untagged);
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
    <>
      <section className="admin-section">
        <h2 className="admin-section-title">Tiers</h2>
        <p className="admin-section-lede">
          Every tier there is, including the drafts the Stripe sync creates and the free tier nobody
          buys. Amounts live in Stripe and are not editable here.
        </p>
        {note ? <Note tone={note.tone === "ok" ? "ok" : "error"}>{note.message}</Note> : null}
        <table className="admin-table">
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
                onMakeDefault={() => void makeDefault(tier)}
              />
            ))}
          </tbody>
        </table>
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
      </section>
      <UnadoptedPrices answer={prices} />
    </>
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
  onMakeDefault,
}: {
  tier: AdminTier;
  busy: boolean;
  onEdit: () => void;
  onMakeDefault: () => void;
}): JSX.Element {
  const draft = !tier.published && tier.relistQuotaPerPeriod === 0 && tier.stripePriceId !== null;
  return (
    <tr data-draft={draft}>
      <td className="admin-code">{tier.tier.code}</td>
      <td>{tier.tier.name}</td>
      <td className="admin-numeric">{tier.relistQuotaPerPeriod}</td>
      <td className="admin-price-id">{tier.stripePriceId ?? "—"}</td>
      <td>
        <span className={tier.published ? "admin-pill admin-pill--on" : "admin-pill"}>
          {tier.published ? "on sale" : draft ? "draft" : "not on sale"}
        </span>{" "}
        {tier.isDefault ? <span className="admin-pill admin-pill--default">default</span> : null}
      </td>
      <td>
        <div className="admin-row-actions">
          <Button shape="rect" tone="secondary" onClick={onEdit} disabled={busy}>
            Edit
          </Button>
          {tier.isDefault ? null : (
            <Button shape="rect" tone="secondary" onClick={onMakeDefault} disabled={busy}>
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
      <div className="admin-field">
        <label htmlFor="tier-name">Name — display text, and yours to rewrite</label>
        <input
          id="tier-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="admin-field">
        <label htmlFor="tier-quota">Relists per period — 0 on the default tier means no free tier</label>
        <input
          id="tier-quota"
          type="number"
          min={0}
          value={quota}
          onChange={(event) => setQuota(event.target.value)}
        />
      </div>
      <div className="admin-field">
        <label htmlFor="tier-features">Feature flags, as JSON</label>
        <textarea
          id="tier-features"
          value={features}
          onChange={(event) => setFeatures(event.target.value)}
        />
      </div>
      <div className="admin-check">
        <input
          id="tier-published"
          type="checkbox"
          checked={published}
          onChange={(event) => setPublished(event.target.checked)}
        />
        <label htmlFor="tier-published">On sale</label>
      </div>
      {tier.stripePriceId === null ? (
        <p className="admin-hint">
          This tier has no Stripe Price, so it cannot go on sale. Create one in Stripe tagged{" "}
          <code>metadata.tier_code = {tier.tier.code}</code> and the sync will fill it in.
        </p>
      ) : null}
      <p className="admin-hint">
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
    <section className="admin-section">
      <h2 className="admin-section-title">Stripe Prices with no tier</h2>
      <p className="admin-section-lede">
        Prices in Stripe carrying no <code>metadata.tier_code</code>. Not all of them are mistakes —
        one-offs and experiments live here too — but a plan you meant to create and cannot find will be
        in this list. Add the tag in Stripe and it becomes a tier.
      </p>
      {answer.status !== "ready" ? (
        <Note tone="warn">
          Stripe could not be asked, so this list is unknown rather than empty.
        </Note>
      ) : answer.prices.length === 0 ? (
        <p className="admin-empty">Every Price in Stripe names a tier.</p>
      ) : (
        <table className="admin-table">
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
      )}
    </section>
  );
}

function PriceRow({ price }: { price: UntaggedPrice }): JSX.Element {
  return (
    <tr>
      <td className="admin-price-id">{price.id}</td>
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
