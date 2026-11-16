import { setI18n, Trans, useTranslation } from "react-i18next";

import { words } from "./words";

// Handed over here rather than through a provider, so that a page rendered on
// its own — which is how every test renders one — has its words by importing this.
setI18n(words);

export { Trans, useTranslation };
