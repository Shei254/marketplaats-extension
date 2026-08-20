import { createRoot } from "react-dom/client";

import { Popup } from "./Popup";
import { workerPort } from "./worker-port";

/**
 * The popup's entry point, and the only file in it that touches Chrome or the
 * DOM. Everything above it is a function of what the worker answered.
 *
 * Named for what it is rather than for what it emits — `scripts/build.mjs` maps
 * it to `popup.js`, the way `service-worker.ts` becomes `background.js`. It also
 * cannot be `popup.tsx` beside `Popup.tsx`: two files whose names differ only in
 * case are one file on a case-insensitive checkout, and TypeScript refuses the
 * pair rather than letting the difference be a machine's.
 */
const root = document.getElementById("root");
if (!root) throw new Error("popup.html has no #root to render into");

createRoot(root).render(<Popup worker={workerPort()} />);
