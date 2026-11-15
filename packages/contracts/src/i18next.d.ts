import "i18next";

import type { nl } from "./words/nl";

/**
 * Keys typed from the Dutch catalog, for this package checked on its own. An app
 * declares its own catalogs beside `plans` in its own program, which never
 * includes this file.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "plans";
    resources: { plans: typeof nl };
  }
}
