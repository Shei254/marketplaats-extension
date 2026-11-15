import type { JSX } from "react";
import type { FailureKind } from "../domain/failure";
import type { PendingRepost } from "../domain/types";
import { useTranslation } from "../i18n/react";
import { t } from "../i18n/words";

/** Why it stopped, where that is known; an unknown reason adds no sentence. */
function why(failure: FailureKind): string {
    return failure === "unknown" ? "" : t(`notice.why.${failure}`);
}

/**
 * Create-first (ADR-0041) means two of these say the ad is online, because it
 * is: only a delete-first snapshot from before the update can be `deleted`.
 */
function headline(p: PendingRepost): string {
    if (p.replaced) return t("notice.replaced", { title: p.title });
    if (p.deleted) return t("notice.deleted", { title: p.title });
    if (p.needsUser) return t("notice.needsYou", { title: p.title });
    return t("notice.notYet", { title: p.title });
}

export function PendingNotice({ pending, onRetry }: {
    pending: PendingRepost[];
    onRetry: (listingId: string) => void;
}): JSX.Element | null {
    const { t } = useTranslation();
    const stuck = pending.filter((p) => !p.running);
    if (stuck.length === 0) return null;
    return (
        <div className="mp-notice" role="alert">
            {stuck.map((p) => (
                <div key={p.listingId}>
                    <p>{headline(p)} {p.failure ? why(p.failure) : ""}</p>
                    {(!p.needsUser || p.replaced) && (
                        <button type="button" onClick={() => onRetry(p.listingId)}>
                            {p.deleted ? t("notice.placeAgain") : t("common.tryAgain")}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}