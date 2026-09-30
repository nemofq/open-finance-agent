/**
 * Width and height from the file's own header, so the chat can lay an image out before it has
 * loaded and the model's tile cost can be reasoned about. Every reader is a guess at a format we
 * only partly parse, so a failure is silence rather than a thrown error: the dimensions are a
 * convenience, and refusing an image the provider would have accepted is the worse outcome.
 */
export function sniffDimensions(bytes: Buffer, mimeType: string): { width?: number; height?: number } {
  try {
    const size =
      mimeType === "image/png"
        ? pngSize(bytes)
        : mimeType === "image/gif"
          ? gifSize(bytes)
          : mimeType === "image/jpeg"
            ? jpegSize(bytes)
            : mimeType === "image/webp"
              ? webpSize(bytes)
              : undefined;
    if (!size || size.width <= 0 || size.height <= 0) return {};
    return size;
  } catch {
    return {};
  }
}

interface Size {
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR is required to be the first chunk, so the dimensions sit at a fixed offset. */
function pngSize(bytes: Buffer): Size | undefined {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifSize(bytes: Buffer): Size | undefined {
  const header = bytes.length >= 10 ? bytes.toString("ascii", 0, 6) : "";
  if (header !== "GIF87a" && header !== "GIF89a") return undefined;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

/**
 * JPEG carries its size in a start-of-frame segment that any number of other segments may precede,
 * so the markers are walked until one turns up. `0xC4`, `0xC8` and `0xCC` share the range without
 * being frames, and `0xD0`–`0xD9` carry no length to skip by.
 */
function jpegSize(bytes: Buffer): Size | undefined {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // fill bytes between segments
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2; // standalone markers: no length field to skip by
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

/** The three WebP flavours keep their size in three different places in the first chunk. */
function webpSize(bytes: Buffer): Size | undefined {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return undefined;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    // Lossy: a three-byte sync code follows the frame tag, then two 14-bit dimensions.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    // Lossless: one signature byte, then width-1 and height-1 as 14 bits each, little-endian.
    if (bytes[20] !== 0x2f) return undefined;
    const packed = bytes.readUInt32LE(21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // Extended: the canvas size as two 24-bit values, each stored one less than it is.
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return undefined;
}
