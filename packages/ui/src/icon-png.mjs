import { deflateSync, inflateSync } from "node:zlib";

/**
 * The brand mark as raster (T48, #78): one committed master, resized to the
 * sizes each surface has to declare.
 *
 * **Why this exists at all.** Chrome takes the toolbar and Web Store icons as
 * PNG and nothing else, so the mark this package draws as `Icon name="logo"`
 * cannot serve there — and the two surfaces need the same artwork at every size
 * each of them declares. Committing those would be a file per size per surface,
 * drifting the first time somebody redraws the mark and nothing saying so.
 *
 * **Why the mechanics are written out rather than installed.** What this has to
 * read is one file this repository commits: 8-bit, non-interlaced, RGB or RGBA.
 * A decoder for exactly that is short, and it refuses everything else *by name*
 * — which is what the build wants the day a 16-bit export from a design tool
 * lands in `brand/`. A dependency would take it and answer something.
 *
 * Nothing here verifies a chunk's CRC. The input is a file in this repository
 * rather than one arriving over a wire, and a corrupted one fails at the
 * inflate a few lines later; a CRC check would only move which line says so.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Bytes per pixel, by PNG colour type. Only these two are read; the rest are refused by name. */
const CHANNELS = { 2: 3, 6: 4 };

const COLOUR_TYPES = {
  0: "greyscale",
  2: "truecolour",
  3: "indexed-colour",
  4: "greyscale with alpha",
  6: "truecolour with alpha",
};

/**
 * @typedef {object} RasterImage
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} pixels RGBA, row-major, 8 bits a channel, alpha not premultiplied.
 */

/**
 * @param {Uint8Array} bytes
 * @returns {RasterImage}
 */
export function decodePng(bytes) {
  for (const [index, byte] of SIGNATURE.entries()) {
    if (bytes[index] !== byte) throw new Error("not a PNG: the file does not start with a PNG signature");
  }

  let header;
  /** @type {Uint8Array[]} */
  const data = [];

  for (let at = 8; at + 8 <= bytes.length;) {
    const length = readUint32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length; // length, type, body, CRC.

    if (type === "IHDR") header = readHeader(body);
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    // Every other chunk is ancillary to what an icon needs — colour profiles,
    // text, timestamps — and is skipped rather than refused, because a master
    // exported by a design tool carries several and none of them changes a pixel.
  }

  if (!header) throw new Error("not a PNG: no IHDR chunk");
  if (data.length === 0) throw new Error("not a PNG: no image data");

  return unfilter(header, inflateSync(Buffer.concat(data)));
}

/** @param {Uint8Array} body */
function readHeader(body) {
  const width = readUint32(body, 0);
  const height = readUint32(body, 4);
  const depth = body[8];
  const colourType = body[9];
  const interlace = body[12];

  // Each of these says what it found, because the fix differs: a bit depth is
  // an export setting, a colour type is usually "optimise/quantise" left on,
  // and interlacing is a checkbox — and a build that only said "unsupported"
  // would leave whoever dropped the file in to guess which.
  if (depth !== 8) throw new Error(`unsupported PNG: ${depth}-bit samples, and only 8-bit are read`);
  if (!(colourType in CHANNELS)) {
    const name = COLOUR_TYPES[/** @type {keyof COLOUR_TYPES} */ (colourType)] ?? "unknown";
    throw new Error(
      `unsupported PNG: colour type ${colourType} (${name}); export it as RGB or RGBA`,
    );
  }
  if (interlace !== 0) throw new Error("unsupported PNG: interlaced (Adam7); export it non-interlaced");

  return { width, height, channels: CHANNELS[/** @type {2 | 6} */ (colourType)] };
}

/**
 * Undoes the per-row filters and widens to RGBA.
 *
 * The filters are the whole of PNG's compression story worth knowing here: each
 * row names one of five predictors, and every one of them reads the row above
 * and the pixel to the left *after* those have themselves been unfiltered. So
 * this walks forwards and in place, and cannot be done a row at a time out of
 * order.
 *
 * @param {{ width: number, height: number, channels: number }} header
 * @param {Buffer} raw
 * @returns {RasterImage}
 */
function unfilter({ width, height, channels }, raw) {
  const stride = width * channels;
  const expected = height * (stride + 1);
  if (raw.length < expected) {
    throw new Error(`truncated PNG: ${raw.length} bytes of image data, ${expected} expected`);
  }

  const lines = new Uint8Array(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;

    for (let index = 0; index < stride; index += 1) {
      const value = raw[from + index];
      const left = index >= channels ? lines[to + index - channels] : 0;
      const above = y > 0 ? lines[to - stride + index] : 0;
      const aboveLeft = y > 0 && index >= channels ? lines[to - stride + index - channels] : 0;

      lines[to + index] = (value + predictor(filter, left, above, aboveLeft)) & 0xff;
    }
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    pixels[pixel * 4] = lines[pixel * channels];
    pixels[pixel * 4 + 1] = lines[pixel * channels + 1];
    pixels[pixel * 4 + 2] = lines[pixel * channels + 2];
    // A master without an alpha channel is opaque, not transparent — the one
    // place this widening makes a claim rather than moving bytes.
    pixels[pixel * 4 + 3] = channels === 4 ? lines[pixel * channels + 3] : 255;
  }

  return { width, height, pixels };
}

/**
 * @param {number} filter
 * @param {number} left @param {number} above @param {number} aboveLeft
 */
function predictor(filter, left, above, aboveLeft) {
  switch (filter) {
    case 0: return 0;
    case 1: return left;
    case 2: return above;
    case 3: return (left + above) >> 1;
    case 4: return paeth(left, above, aboveLeft);
    default: throw new Error(`unsupported PNG: row filter ${filter}`);
  }
}

/** PNG's own predictor: whichever neighbour the gradient through them points nearest to. */
function paeth(left, above, aboveLeft) {
  const estimate = left + above - aboveLeft;
  const dLeft = Math.abs(estimate - left);
  const dAbove = Math.abs(estimate - above);
  const dAboveLeft = Math.abs(estimate - aboveLeft);
  if (dLeft <= dAbove && dLeft <= dAboveLeft) return left;
  return dAbove <= dAboveLeft ? above : aboveLeft;
}

/**
 * Area-averages down to `width` × `height`.
 *
 * **Every output pixel is the average of everything under it**, edges included
 * at the fraction they are covered. A sampler that read one input pixel per
 * output pixel is what turns a 2000px master into a 16px icon made of whichever
 * 1/125th of the artwork happened to sit under a corner: at that ratio a stroke
 * either survives whole or vanishes.
 *
 * **Colour is weighted by alpha.** Averaging the channels as they sit lets a
 * transparent pixel's colour — usually black — into the result at full strength
 * and draws the dark halo every naive resizer puts around a soft edge. So the
 * average is taken premultiplied and divided back out, which is the same rule
 * `resizeImage`'s callers would otherwise have to know.
 *
 * @param {RasterImage} image @param {number} width @param {number} height
 * @returns {RasterImage}
 */
export function resizeImage(image, width, height) {
  if (width > image.width || height > image.height) {
    throw new Error(
      `cannot enlarge ${image.width}×${image.height} to ${width}×${height}: `
        + "an icon set is derived from a master, so the master is the largest size in it",
    );
  }
  if (width === image.width && height === image.height) return image;

  const pixels = new Uint8Array(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0, green = 0, blue = 0, alpha = 0, covered = 0;

      for (let sourceY = Math.floor(y * scaleY); sourceY < Math.ceil((y + 1) * scaleY); sourceY += 1) {
        const heightHere = overlap(sourceY, y * scaleY, (y + 1) * scaleY);

        for (let sourceX = Math.floor(x * scaleX); sourceX < Math.ceil((x + 1) * scaleX); sourceX += 1) {
          const area = heightHere * overlap(sourceX, x * scaleX, (x + 1) * scaleX);
          const at = (sourceY * image.width + sourceX) * 4;
          const weight = area * image.pixels[at + 3];

          red += image.pixels[at] * weight;
          green += image.pixels[at + 1] * weight;
          blue += image.pixels[at + 2] * weight;
          alpha += image.pixels[at + 3] * area;
          covered += area;
        }
      }

      const at = (y * width + x) * 4;
      // `alpha` is the premultiplied weight the colours were summed against, so
      // dividing by it is what takes them back out of it. A fully transparent
      // area has no colour to answer with, and inventing one would put that
      // colour back into the next resize of this image.
      if (alpha > 0) {
        pixels[at] = Math.round(red / alpha);
        pixels[at + 1] = Math.round(green / alpha);
        pixels[at + 2] = Math.round(blue / alpha);
      }
      pixels[at + 3] = Math.round(alpha / covered);
    }
  }

  return { width, height, pixels };
}

/** How much of the input pixel starting at `index` lies inside `[from, to)`. */
function overlap(index, from, to) {
  return Math.min(index + 1, to) - Math.max(index, from);
}

/**
 * @param {RasterImage} image
 * @returns {Uint8Array} the image as an 8-bit RGBA PNG.
 */
export function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    // Filter 0 (None) on every row. The rows this writes are 16 to 180 pixels of
    // a gradient, where a predictor buys kilobytes at most — and what it costs is
    // the one part of the format a reader of this file would have to hold in
    // their head to check the output.
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bit depth.
  header[9] = 6; // Truecolour with alpha.

  return new Uint8Array(
    Buffer.concat([
      Buffer.from(SIGNATURE),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/**
 * The icon at each size asked for, from the committed master's bytes.
 *
 * **A set rather than one size at a time**, because decoding is what this costs:
 * the master is 2000×2000, and asking for four sizes one call at a time spent
 * two seconds of every extension build inflating the same file four times.
 *
 * @param {Uint8Array} master @param {Iterable<number>} sizes
 * @returns {Map<number, Uint8Array>} each size asked for, in the order asked.
 */
export function iconSet(master, sizes) {
  const image = decodePng(master);
  if (image.width !== image.height) {
    // Cropping picks which part of somebody's artwork to keep and squashing puts
    // the mark off its own geometry. Both are decisions about the design, and
    // neither is a build's to make silently.
    throw new Error(
      `the icon master is ${image.width}×${image.height} and every size asked of it is square`,
    );
  }

  return new Map([...sizes].map((size) => [size, encodePng(resizeImage(image, size, size))]));
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_unused, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

/** @param {Buffer} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {Uint8Array} bytes @param {number} at */
function readUint32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}
