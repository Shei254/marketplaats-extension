import { Icon, IconButton } from "@mprelist/ui";
import type { JSX } from "react";

/**
 * The box above the ad list (T31, #40).
 *
 * **The design canvas draws no search box**, which makes this the third
 * deliberate departure from it on this surface and the same shape as the first
 * two (`screens.tsx`): the canvas draws four ads in a 360px window, and an
 * account with sixty is the one this is for. It is drawn out of the canvas's own
 * parts all the same — its line, its muted caption, its `close` glyph — so
 * nothing new is invented for it.
 *
 * **Not focused on open.** The popup's first action is Repost, on a row that is
 * already there; a field that swallowed the first keystroke would put a search
 * between a user and the button they opened this for.
 *
 * The clear button appears only when there is something to clear, and it is a
 * button rather than `type="search"`'s own affordance — that one is Chrome's,
 * varies with the platform, and cannot be labelled for a screen reader.
 */
export function SearchBox({
  value,
  onType,
  onClear,
}: {
  value: string;
  onType: (raw: string) => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="popup-search">
      <input
        type="text"
        className="popup-search-input"
        // The label is what a screen reader reads; the placeholder is what
        // everybody else does, and a placeholder alone is not a label.
        aria-label="Search your ads"
        placeholder="Search your ads"
        value={value}
        onChange={(event) => onType(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {value.length > 0 ? (
        <IconButton label="Clear search" className="popup-search-clear" onClick={onClear}>
          <Icon name="close" />
        </IconButton>
      ) : null}
    </div>
  );
}
