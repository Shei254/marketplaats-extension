import { useState, type JSX } from "react";

/**
 * The picture beside a row's title (see **Thumbnail** in `docs/glossary.md`), on an
 * ad's row and on a pending repost's alike.
 *
 * **The placeholder is the box itself** and the picture is laid over it, so one
 * size holds whichever happens: no photos, still loading, or a URL that no longer
 * answers. That last one is expected rather than exceptional — a pending repost's
 * ad may already be deleted, and nobody has established how long Marktplaats keeps
 * serving its pictures.
 *
 * `alt=""` because the title is right beside it, and a screen reader saying the
 * same words twice per row is a list nobody can get through.
 */
export function Thumbnail({ url }: { url?: string }): JSX.Element {
  // The URL that failed rather than a flag, so a row handed another URL tries it.
  const [failed, setFailed] = useState<string | null>(null);
  const src = url ? absolute(url) : null;
  return (
    <span className="popup-ad-thumbnail">
      {src && src !== failed && (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      )}
    </span>
  );
}

/**
 * A scheme-relative URL resolves against the page asking, which here is
 * `chrome-extension://`, so it would fail and read as an ad with no picture.
 */
function absolute(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}
