/**
 * The words the two shells say themselves — the footer's link to the terms —
 * by locale, as a message each `template.ftl` asks for with `msg()` (T96,
 * ADR-0043). A word written into a shell would be Dutch on the English page,
 * since the shell is one file for both.
 *
 * Both types carry them, since a login type's bundles and an email type's are
 * separate files Keycloak never merges across. The key is prefixed so it can
 * never shadow one of Keycloak's own.
 */
export const SHELL_WORDS: Record<"nl" | "en", Record<string, string>> = {
  nl: { mprelistTerms: "Voorwaarden" },
  en: { mprelistTerms: "Terms" },
};
