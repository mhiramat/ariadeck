import { ValidationError } from '../errors.js';
import type { SupportedImageMimeType } from '../types/models.js';

export const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const DEFAULT_THUMBNAIL_MAX_EDGE_PX = 480;

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * Parses ARIADECK_MAX_IMAGE_BYTES into a positive integer byte limit, falling
 * back to DEFAULT_MAX_IMAGE_BYTES (15 MiB).
 */
export function resolveMaxImageBytes(raw?: string): number {
  if (!raw || !raw.trim()) {
    return DEFAULT_MAX_IMAGE_BYTES;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_IMAGE_BYTES;
  }
  return parsed;
}

/**
 * Inspects file header magic bytes to determine whether the payload is a
 * supported JPEG or PNG image.
 */
export function detectImageMimeType(bytes: Uint8Array): SupportedImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

/**
 * Maps a supported image MIME type to its canonical CAS file extension.
 */
export function imageMimeToExtension(mimeType: SupportedImageMimeType): 'jpg' | 'png' {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

export interface ValidateImageBytesOptions {
  maxBytes?: number;
  expectedMimeType?: SupportedImageMimeType;
}

/**
 * Validates an image buffer against size limits, magic-byte headers, and an
 * optional expected MIME type.
 */
export function validateImageBytes(
  bytes: Uint8Array,
  options: ValidateImageBytesOptions = {}
): { mimeType: SupportedImageMimeType; ext: 'jpg' | 'png' } {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (bytes.byteLength === 0) {
    throw new ValidationError('Image payload must not be empty.', 'ERR_EMPTY_IMAGE');
  }
  if (bytes.byteLength > maxBytes) {
    throw new ValidationError(
      `Image payload (${bytes.byteLength} bytes) exceeds maximum allowed size (${maxBytes} bytes).`,
      'ERR_IMAGE_TOO_LARGE'
    );
  }

  const detected = detectImageMimeType(bytes);
  if (!detected) {
    throw new ValidationError(
      'Unsupported image format. Only JPEG and PNG payloads are allowed.',
      'ERR_UNSUPPORTED_IMAGE_FORMAT'
    );
  }

  if (options.expectedMimeType && options.expectedMimeType !== detected) {
    throw new ValidationError(
      `Image header (${detected}) does not match declared MIME type (${options.expectedMimeType}).`,
      'ERR_IMAGE_MIME_MISMATCH'
    );
  }

  return {
    mimeType: detected,
    ext: imageMimeToExtension(detected),
  };
}

/**
 * Computes a lowercase hex SHA-256 content digest using Web Crypto (works in
 * both Node.js >= 20 and modern browsers).
 */
export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Returns true if the given string is a valid 64-character lowercase hex SHA-256 digest.
 */
export function isValidSha256Hex(value: string): boolean {
  return SHA256_HEX_REGEX.test(value);
}

/**
 * Lightweight pure-TypeScript header parser that extracts pixel dimensions from
 * PNG (IHDR) or JPEG (SOF0..SOF3) headers when no native image library is used.
 */
export function parseImageDimensionsFromBytes(
  bytes: Uint8Array,
  mimeType: SupportedImageMimeType
): { width: number; height: number } | null {
  if (mimeType === 'image/png') {
    if (bytes.length < 24) return null;
    // IHDR chunk starts at byte 8 (4 len + 4 'IHDR' + 4 width + 4 height)
    if (
      bytes[12] !== 0x49 ||
      bytes[13] !== 0x48 ||
      bytes[14] !== 0x44 ||
      bytes[15] !== 0x52
    ) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG SOF marker scan
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) break;
    const marker = bytes[offset]!;
    offset += 1;

    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) break;
    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 7 < bytes.length) {
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }

  return null;
}
