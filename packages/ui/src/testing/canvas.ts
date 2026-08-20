import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Readers for the design canvas, so the tests can hold this package to
 * `docs/design/` itself rather than to a second copy of it that agrees with any
 * mistake made in the same direction.
 *
 * Reading a source outside the workspace is the same arrangement the API suite
 * has with `infra/docker-compose.yml`, and the reason CI carries no path filters
 * (see the root README): a filter that did not know about this would go green
 * having looked at nothing.
 */
const CANVAS_DIR = fileURLToPath(new URL("../../../../docs/design/", import.meta.url));

export function canvasFile(name: string): string {
  return readFileSync(join(CANVAS_DIR, name), "utf8");
}

export function canvasArtboards(): string[] {
  return readdirSync(CANVAS_DIR)
    .filter((name) => name.endsWith(".dc.html"))
    .map((name) => canvasFile(name));
}

/**
 * The custom properties the token sheet declares for one theme. `.t` is the light
 * block and `.t.dark` the dark one — the canvas's own way of carrying both.
 */
export function canvasTokens(theme: "light" | "dark"): Record<string, string> {
  const sheet = canvasFile("Tokens.dc.html");
  const pattern = theme === "dark" ? /\.t\.dark\s*\{([^}]*)\}/ : /\.t\s*\{([^}]*)\}/;
  const block = pattern.exec(sheet);
  if (!block?.[1]) throw new Error(`no ${theme} token block in Tokens.dc.html`);

  const tokens: Record<string, string> = {};
  for (const declaration of block[1].split(";")) {
    const [, name, value] = /^\s*--([\w-]+)\s*:\s*(.+?)\s*$/s.exec(declaration) ?? [];
    if (name && value) tokens[name] = value;
  }
  return tokens;
}

export type CanvasIcon = { strokeWidth: string; shapes: string[] };

/** Every `<svg>` drawn anywhere on the canvas, reduced to what an icon actually is. */
export function canvasIcons(): CanvasIcon[] {
  return canvasArtboards()
    .flatMap((artboard) => [...artboard.matchAll(/<svg\b([^>]*)>(.*?)<\/svg>/gs)])
    .map(([, attributes = "", body = ""]) => ({
      strokeWidth: /stroke-width="([^"]*)"/.exec(attributes)?.[1] ?? "",
      shapes: shapesIn(body),
    }));
}

/**
 * The geometry of an SVG body, attribute order and formatting thrown away, so a
 * shape drawn here can be compared with the same shape drawn on the canvas.
 */
export function shapesIn(markup: string): string[] {
  return [...markup.matchAll(/<(path|rect|circle)\b([^>]*?)\/?>/g)].map(([, tag, attributes = ""]) => {
    const pairs = [...attributes.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)]
      .map(([, name, value]) => `${name}=${value}`)
      .sort();
    return `${tag} ${pairs.join(" ")}`;
  });
}
