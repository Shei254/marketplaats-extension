import { ApiRequestError, NotAuthenticatedError } from "./marktplaats-client";

export type FailureKind = "offline" | "timeout" | "tab-closed" | "logged-out" | "server" | "unknown";

export function failureKind(error: unknown): FailureKind {
    if (error instanceof NotAuthenticatedError) return "logged-out";
    if (error instanceof ApiRequestError) return error.status >= 500 ? "server" : "unknown";
    if (!(error instanceof Error)) return "unknown";
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
    if (error.name === "NetworkError") return "offline";
    if (/message port closed|Receiving end does not exist|Extension context invalidated/.test(error.message)) return "tab-closed";
    return "unknown";
}