import type { JSX } from "react";

import { uiCss } from "../styles";

/**
 * The stylesheet, as an element. Render it once at the top of a surface — the
 * popup's root, an `apps/web` page, the shadow root of an injected control.
 *
 * `dangerouslySetInnerHTML` is the honest way to write a `<style>` in React: as
 * children the CSS would be escaped as text on re-render paths. The content is
 * this package's own generated string, never anything a user or a page supplied.
 */
export function UiStyles(): JSX.Element {
  return <style dangerouslySetInnerHTML={{ __html: uiCss }} />;
}
