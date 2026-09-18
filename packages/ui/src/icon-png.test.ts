import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { decodePng, encodePng, iconSet, resizeImage, type RasterImage } from "./icon-png.mjs";

/**
 * The raster form of the brand mark (T48, #78), and the one place PNG bytes are
 * read or written in this repository.
 *
 * It is here rather than in a third package for the reason ADR-0011's T66
 * amendment gives for `money.ts` living in `packages/contracts`: it is one
 * concept — the mark, which this package already draws as `Icon name="logo"` —
 * derived for two consumers, the extension build and `apps/web`'s. A copy each
 * is the pair that drifts.
 *
 * **Why the mechanics are written out rather than installed.** A decoder that
 * accepts only what the committed master actually is — 8-bit, non-interlaced,
 * RGB or RGBA — is a few dozen lines and refuses everything else *by name*,
 * which is what a build wants when somebody drops a 16-bit export from a design
 * tool into `brand/`. The alternative is a dependency that accepts it silently
 * and a build whose output nobody looks at until the Web Store does.
 */

/** A tiny image built pixel by pixel, so a test's expectation is arithmetic rather than a fixture. */
function image(width: number, height: number, pixel: (x: number, y: number) => number[]): RasterImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
}

function pixelAt(img: RasterImage, x: number, y: number): number[] {
  return [...img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
}

describe("PNG round trip", () => {
  it("decodes back to the pixels it encoded", () => {
    const source = image(3, 2, (x, y) => [x * 40, y * 80, 255 - x * 30, 255 - y * 10]);

    const decoded = decodePng(encodePng(source));

    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect([...decoded.pixels]).toEqual([...source.pixels]);
  });

  it("survives a width that is not a whole number of bytes of filter history", () => {
    // Every filter but None reads the pixel one to the left, so a row that is not
    // a neat multiple of anything is where an off-by-one in the unfiltering shows.
    const source = image(7, 5, (x, y) => [(x * 37) % 256, (y * 53) % 256, (x * y) % 256, 255]);

    expect([...decodePng(encodePng(source)).pixels]).toEqual([...source.pixels]);
  });

  it("emits a file that begins with the PNG signature and ends with IEND", () => {
    const bytes = encodePng(image(1, 1, () => [1, 2, 3, 4]));

    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Buffer.from(bytes.subarray(bytes.length - 8)).toString("latin1")).toContain("IEND");
  });
});

describe("what the decoder refuses, and what it says", () => {
  it("refuses a file that is not a PNG at all", () => {
    expect(() => decodePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toThrow(/not a PNG/i);
  });

  it("names the bit depth it found rather than reading the file wrong", () => {
    const bytes = encodePng(image(1, 1, () => [0, 0, 0, 255]));
    bytes[24] = 16; // IHDR's bit depth: 8 bytes of signature, 8 of chunk header, 8 of dimensions.

    expect(() => decodePng(bytes)).toThrow(/16-bit/);
  });

  it("names the colour type it found, which is how a palette export announces itself", () => {
    const bytes = encodePng(image(1, 1, () => [0, 0, 0, 255]));
    bytes[25] = 3; // Indexed-colour.

    expect(() => decodePng(bytes)).toThrow(/colour type 3/);
  });

  it("refuses an interlaced file rather than emitting a seventh of it", () => {
    const bytes = encodePng(image(1, 1, () => [0, 0, 0, 255]));
    bytes[28] = 1; // Adam7.

    expect(() => decodePng(bytes)).toThrow(/interlaced/);
  });

  it("reads an RGB file as opaque, since a master without an alpha channel is not transparent", () => {
    // colourType 2 is what an export "without transparency" produces, and it is
    // the one format besides RGBA that a master plausibly arrives in.
    const rgb = rgbPng(2, 1, [
      [10, 20, 30],
      [40, 50, 60],
    ]);

    const decoded = decodePng(rgb);

    expect(pixelAt(decoded, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(decoded, 1, 0)).toEqual([40, 50, 60, 255]);
  });
});

describe("downscaling", () => {
  it("averages the whole area a pixel covers, not the one sample at its corner", () => {
    // Four quadrants of one flat colour each: a sampler that picked a corner
    // would answer one of them, and the average of the four is none of them.
    const source = image(2, 2, (x, y) => (x === 0 && y === 0 ? [200, 0, 0, 255]
      : x === 1 && y === 0 ? [0, 200, 0, 255]
        : x === 0 && y === 1 ? [0, 0, 200, 255]
          : [200, 200, 200, 255]));

    expect(pixelAt(resizeImage(source, 1, 1), 0, 0)).toEqual([100, 100, 100, 255]);
  });

  it("weights the edge pixels a fraction of an output pixel covers", () => {
    // 3 → 2 is the ratio nothing divides: each output pixel is 1.5 input pixels
    // wide, so the middle one is split half and half. A whole-pixel box filter
    // would drop a column, which at icon sizes is a limb of the mark.
    const source = image(3, 1, (x) => [x === 0 ? 0 : x === 1 ? 100 : 200, 0, 0, 255]);

    const resized = resizeImage(source, 2, 1);

    // Left output covers all of x=0 and half of x=1: (0 + 100 * 0.5) / 1.5 ≈ 33.
    expect(pixelAt(resized, 0, 0)[0]).toBe(33);
    // Right covers half of x=1 and all of x=2: (100 * 0.5 + 200) / 1.5 ≈ 167.
    expect(pixelAt(resized, 1, 0)[0]).toBe(167);
  });

  it("averages colour weighted by alpha, so a transparent pixel does not darken its neighbour", () => {
    // Transparent *black* beside opaque white. Averaging the channels as they sit
    // answers mid-grey at half alpha — the halo every naive resizer draws around
    // a mark with soft edges. Weighted by coverage, the colour is still white.
    const source = image(2, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [255, 255, 255, 255]));

    expect(pixelAt(resizeImage(source, 1, 1), 0, 0)).toEqual([255, 255, 255, 128]);
  });

  it("answers a fully transparent area without inventing a colour for it", () => {
    const source = image(2, 1, () => [0, 0, 0, 0]);

    expect(pixelAt(resizeImage(source, 1, 1), 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("keeps an image it is asked to leave alone byte-identical", () => {
    const source = image(4, 4, (x, y) => [x * 9, y * 9, 0, 255]);

    expect([...resizeImage(source, 4, 4).pixels]).toEqual([...source.pixels]);
  });

  it("refuses to enlarge, because an icon set is derived from a master and not the other way round", () => {
    expect(() => resizeImage(image(8, 8, () => [0, 0, 0, 255]), 16, 16)).toThrow(/8×8.*16×16/);
  });
});

describe("iconSet", () => {
  it("answers a square PNG at every size asked for", () => {
    const master = encodePng(image(64, 64, (x, y) => [x * 4, y * 4, 0, 255]));

    const set = iconSet(master, [16, 48]);

    expect([...set.keys()]).toEqual([16, 48]);
    for (const [size, bytes] of set) {
      const decoded = decodePng(bytes);
      expect([decoded.width, decoded.height]).toEqual([size, size]);
    }
  });

  it("refuses a master that is not square, since every size it is asked for is", () => {
    // Cropping would be a decision about which part of somebody's artwork to
    // keep, and squashing puts the mark off its own geometry. Neither is this
    // module's to make.
    const master = encodePng(image(64, 32, () => [0, 0, 0, 255]));

    expect(() => iconSet(master, [16])).toThrow(/64×32/);
  });

  it("refuses before drawing anything, so a bad master cannot half-emit a set", () => {
    expect(() => iconSet(encodePng(image(64, 32, () => [0, 0, 0, 255])), [])).toThrow(/64×32/);
  });
});

describe("the committed master", () => {
  it("is a square PNG this pipeline can read, which is the claim the build rests on", async () => {
    const master = await readFile(new URL("../../../brand/icon.png", import.meta.url));

    const decoded = decodePng(master);

    expect(decoded.width).toBe(decoded.height);
    // Big enough that every size the two surfaces ask for is a downscale.
    expect(decoded.width).toBeGreaterThanOrEqual(512);
  });
});

/**
 * A three-channel PNG, hand-built because `encodePng` only writes RGBA — the
 * decoder has to read a format this repository never emits, and a fixture it
 * cannot produce itself is the only honest way to say so.
 *
 * The chunk framing and the CRC below are a second implementation of the
 * module's own, **and are meant to be**: a fixture assembled by the encoder
 * under test would agree with a broken encoder, and the round trip above would
 * then prove that two copies of one mistake match. They are ten lines, and they
 * are the only place in this repository that is true of.
 */
function rgbPng(width: number, height: number, rows: number[][]): Uint8Array {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = rows[y * width + x] ?? [0, 0, 0];
      raw.set(pixel, y * (1 + width * 3) + 1 + x * 3);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // Truecolour, no alpha.

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
