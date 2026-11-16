import { privacy } from "./privacy";
import { site } from "./site";
import { terms } from "./terms";

/** The site's Dutch catalog — the source, and the one the keys are typed from (ADR-0043). */
export const nl = { ...site, privacy, terms };
