import { setI18n, useTranslation } from "react-i18next";

import { words } from "./words";

// Handed over here rather than through a provider: the **Page button** is one
// tree drawn into a dozen shadow roots, and every component reaches its words by
// importing this module.
setI18n(words);

export { useTranslation };
