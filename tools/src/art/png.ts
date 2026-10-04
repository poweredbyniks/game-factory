import { deflateSync } from "node:zlib";

/** Marker written into generated placeholder art, so release checks can tell it from final art. */
export const PLACEHOLDER_MARK = "gf-placeholder";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encodes straight-alpha RGBA pixels as an 8-bit PNG. `opaque` drops the alpha channel, which the
 * App Store requires for app icons. `text` adds tEXt chunks.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array, opts: { opaque?: boolean; text?: Record<string, string> } = {}): Buffer {
  const channels = opts.opaque ? 3 : 4;
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * stride + 1 + x * channels;
      raw[dst] = rgba[src]!;
      raw[dst + 1] = rgba[src + 1]!;
      raw[dst + 2] = rgba[src + 2]!;
      if (channels === 4) raw[dst + 3] = rgba[src + 3]!;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = opts.opaque ? 2 : 6; // truecolor or truecolor with alpha
  const text = Object.entries(opts.text ?? {}).map(([k, v]) => chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1")));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...text,
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export type PngInfo = { width: number; height: number; alpha: boolean; placeholder: boolean };

/** Reads size and alpha from a PNG header; null when the bytes are not a PNG. */
export function pngInfo(bytes: Buffer): PngInfo | null {
  if (bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const colorType = bytes[25]!;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    alpha: colorType === 4 || colorType === 6 || bytes.includes("tRNS"),
    placeholder: bytes.includes(PLACEHOLDER_MARK),
  };
}
