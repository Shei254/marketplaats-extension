import type { CatalogOf } from "@mprelist/contracts";

import type { nl } from "../nl";
import { privacy } from "./privacy";
import { site } from "./site";
import { terms } from "./terms";

/** The site's English catalog, held to the Dutch one's keys (ADR-0043). */
export const en = { ...site, privacy, terms } satisfies CatalogOf<typeof nl>;
