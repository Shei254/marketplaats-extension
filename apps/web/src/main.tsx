import { createRoot } from "react-dom/client";

import { Site } from "./Site";

/**
 * The entry point, and the only file here that touches the document.
 *
 * Everything above it is a function of the path and the year it is handed —
 * which is the same split the popup has, where `popup-entry.tsx` is the one file
 * that knows about Chrome.
 *
 * `location.pathname` is read once, at load. There is nothing to navigate between
 * yet: every address this site serves is arrived at from somewhere else — Stripe's
 * redirect, a link in the Web Store listing — and a router that intercepted clicks
 * would be intercepting none. T54 (#85) is what brings a second screen and the
 * first reason to have one.
 *
 * **Serving these paths is a deploy-time obligation** (T55, #86): one build, one
 * `index.html`, so `/success` has to be answered with it rather than with a 404.
 * `vite dev` and `vite preview` already do.
 */
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root to render into");

createRoot(root).render(<Site pathname={location.pathname} year={new Date().getFullYear()} />);
