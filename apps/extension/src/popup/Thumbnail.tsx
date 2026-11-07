import { useState, type JSX } from "react";

/**
 * The picture beside a row's title (see **Thumbnail** in `docs/glossary.md`), on an
 * ad's row and on a pending repost's alike.
 *
 * **One box holds whichever happens**, so a row keeps its shape. It is empty while
 * a picture loads, and draws the no-photo icon when there is none or the URL no
 * longer answers. That last one is expected rather than exceptional — a pending
 * repost's ad may already be deleted, and nobody has established how long
 * Marktplaats keeps serving its pictures.
 *
 * `alt=""` because the title is right beside it, and a screen reader saying the
 * same words twice per row is a list nobody can get through.
 */
export function Thumbnail({ url }: { url?: string }): JSX.Element {
  // The URL that failed rather than a flag, so a row handed another URL tries it.
  const [failed, setFailed] = useState<string | null>(null);
  const src = url ? absolute(url) : null;
  const showing = src !== null && src !== failed;
  return (
    <span className="popup-ad-thumbnail">
      {showing ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      ) : (
        <NoPhoto />
      )}
    </span>
  );
}

/**
 * A picture with a line through it, so "no photo" cannot be read as "still
 * loading". Drawn here and not in `@mprelist/ui`'s set, whose icons are held to
 * the design canvas and which has one surface's use for this. No words, because
 * none are legible at 40px.
 */
function NoPhoto(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 6.5v8.5a1.5 1.5 0 0 0 1.5 1.5h8.5" />
      <path d="M6.5 3.5H15A1.5 1.5 0 0 1 16.5 5v8.5" />
      <path d="M3.5 13.5 7 10l2.5 2.5" />
      <path d="M11.5 8.5a1.2 1.2 0 0 0 1.2 1.2" />
      <path d="M3 3l14 14" />
    </svg>
  );
}

/**
 * A scheme-relative URL resolves against the page asking, which here is
 * `chrome-extension://`, so it would fail and read as an ad with no picture.
 */
function absolute(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}
