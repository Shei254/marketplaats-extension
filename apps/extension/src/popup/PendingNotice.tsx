import type { JSX } from "react";
import type { FailureKind } from "../domain/failure";
import type { PendingRepost } from "../domain/types";

const WHY: Record<FailureKind, string> = {
    offline: "Er was geen internetverbinding.",
    timeout: "Marktplaats reageerde niet op tijd.",
    "tab-closed": "Het Marktplaats-tabblad werd gesloten tijdens het herplaatsen.",
    "logged-out": "Je bent uitgelogd bij Marktplaats.",
    server: "Marktplaats had een storing.",
    unknown: "",
};

/**
 * Create-first (ADR-0041) means two of these say the ad is online, because it
 * is: only a delete-first snapshot from before the update can be `deleted`.
 */
function headline(p: PendingRepost): string {
    if (p.replaced) return `“${p.title}” is herplaatst, maar de oude advertentie staat er ook nog. De extensie verwijdert hem zodra dat lukt.`;
    if (p.deleted) return `“${p.title}” is verwijderd en nog niet teruggeplaatst. Je gegevens zijn bewaard.`;
    if (p.needsUser) return `Niet zeker of “${p.title}” al opnieuw geplaatst is. Controleer je advertenties; je advertentie zelf staat nog online.`;
    return `Het herplaatsen van “${p.title}” is nog niet gelukt. Je advertentie staat gewoon online; de extensie probeert het opnieuw.`;
}

export function PendingNotice({ pending, onRetry }: {
    pending: PendingRepost[];
    onRetry: (listingId: string) => void;
}): JSX.Element | null {
    const stuck = pending.filter((p) => !p.running);
    if (stuck.length === 0) return null;
    return (
        <div className="mp-notice" role="alert">
            {stuck.map((p) => (
                <div key={p.listingId}>
                    <p>{headline(p)} {p.failure ? WHY[p.failure] : ""}</p>
                    {(!p.needsUser || p.replaced) && (
                        <button type="button" onClick={() => onRetry(p.listingId)}>
                            {p.deleted ? "Opnieuw plaatsen" : "Opnieuw proberen"}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}