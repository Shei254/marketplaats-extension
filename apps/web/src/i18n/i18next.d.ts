import "i18next";

import type { planWordsNl } from "@mprelist/contracts";

import type { nl } from "./nl";

/** Keys typed from the Dutch catalogs, so a misspelled one does not compile (ADR-0043). */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof nl; plans: typeof planWordsNl };
  }
}
