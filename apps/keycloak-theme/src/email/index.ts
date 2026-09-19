import type { ThemeType } from "../theme";
import { dutchMessages } from "./copy";
import { STYLES } from "./styles";

/**
 * The mail: Keycloak's own flow, framed by us and worded by us.
 *
 * `parent=base` for the same reason the login type uses it — `base` carries the
 * mails and styles none of them, so there is nothing to undo. It is not
 * `keycloak`, the default, which is itself `parent=base` plus one description
 * string and adds nothing.
 *
 * **This type has no resources and no icons, and that is not an omission.** A
 * theme's `resources/` are served over HTTP to a browser; an email template is
 * rendered once into a message and handed to an SMTP server, and Keycloak gives
 * it no `url` to build a link with. So there is no stylesheet to serve and no
 * mark to fetch: the styling is inline (`styles.ts`) and the mark is the
 * wordmark (`html/template.ftl`). The `ThemeType` shape fits anyway, which is
 * the registry doing its job rather than this type bending it.
 *
 * What it does have, and the login type does not, is **messages** — because with
 * no `kc…Class` hooks in `base/email` there is nothing to point at the design
 * system, and the only thing left to own is the words (ADR-0035).
 */
export const email: ThemeType = {
  /**
   * `theme.properties`: the parent, the brand's four values, and this surface's
   * styling as named declarations the shell reads.
   *
   * No `locales` of its own. `base/email` declares the list it ships bundles
   * for, `nl` among them, and a type that re-declared one would be a second
   * place to be wrong about which languages exist.
   */
  properties: (brand) => ({
    parent: "base",
    ...brand,
    ...STYLES,
  }),
  /**
   * One bundle, in the one locale both realms support.
   *
   * Keycloak merges a theme's messages over its parent's, so every key not named
   * here — every other mail, and every string inside the ones that are — is
   * still Keycloak's own Dutch. What this overrides is the two mails a customer
   * can be sent, in both their HTML and plain-text forms.
   */
  messages: (brand) => ({ nl: dutchMessages(brand.brandName) }),
  resources: {},
  icons: {},
};
