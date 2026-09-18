/**
 * Types for `icon-png.mjs`. Hand-written for the reason
 * `apps/extension/scripts/brand.d.mts` gives for its own: the module is `.mjs`
 * because `scripts/build.mjs` runs it under bare `node`, and `allowJs` would
 * pull it into this package's strict checking as source rather than as a
 * declared boundary.
 */

/** An image in memory: RGBA, row-major, 8 bits a channel, alpha **not** premultiplied. */
export interface RasterImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * Reads an 8-bit, non-interlaced PNG — RGB or RGBA — and widens it to RGBA.
 * Throws by name on anything else, because what is wrong differs by case.
 */
export declare function decodePng(bytes: Uint8Array): RasterImage;

/** Writes an 8-bit RGBA PNG, every row unfiltered. */
export declare function encodePng(image: RasterImage): Uint8Array;

/**
 * Area-averages down to `width` × `height`, weighting colour by alpha. Throws
 * rather than enlarging: an icon set is derived from a master.
 */
export declare function resizeImage(image: RasterImage, width: number, height: number): RasterImage;

/**
 * The icon at each size asked for, from the master's bytes, decoding it once.
 * Throws if the master is not square.
 */
export declare function iconSet(master: Uint8Array, sizes: Iterable<number>): Map<number, Uint8Array>;
