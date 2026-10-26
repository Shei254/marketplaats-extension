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

function headline(p: PendingRepost): string {
    if (p.needsUser) return `“${p.title}” kan niet automatisch worden teruggeplaatst. Controleer of de advertentie al online staat.`;
    if (p.deleted) return `“${p.title}” is verwijderd en nog niet teruggeplaatst. Je gegevens zijn bewaard.`;
    return `Het herplaatsen van “${p.title}” werd onderbroken. De advertentie staat mogelijk nog online.`;
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
                    {!p.needsUser && (
                        <button type="button" onClick={() => onRetry(p.listingId)}>
                            {p.deleted ? "Opnieuw plaatsen" : "Opnieuw proberen"}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}