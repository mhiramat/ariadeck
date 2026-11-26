import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  DEFAULT_MAX_IMAGE_BYTES,
  ValidationError,
  type SupportedImageMimeType,
} from '@ariadeck/core';

export type McpImageSource =
  | { type: 'file_path'; path: string }
  | { type: 'base64'; data: string; mimeType: SupportedImageMimeType };

export interface ResolveImageSourceOptions {
  allowedMediaDirs?: string[];
  maxImageBytes?: number;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Resolves raw image bytes from either a Base64 payload or a local file path.
 * Local file_path sources are strictly opt-in: ARIADECK_ALLOWED_MEDIA_DIRS must
 * be configured and the realpath-resolved file must reside inside an allowed
 * directory.
 */
export async function resolveImageSourceBytes(
  source: McpImageSource,
  options: ResolveImageSourceOptions = {}
): Promise<{ bytes: Uint8Array; expectedMimeType?: SupportedImageMimeType }> {
  const maxBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  if (source.type === 'base64') {
    const cleaned = source.data.replace(/\s+/g, '');
    if (!cleaned) {
      throw new ValidationError('Base64 image data must not be empty.', 'ERR_EMPTY_IMAGE');
    }
    if (cleaned.startsWith('data:')) {
      throw new ValidationError(
        'Provide raw Base64 image data without a data URI prefix.',
        'ERR_INVALID_BASE64'
      );
    }
    if (cleaned.length % 4 !== 0 || !BASE64_PATTERN.test(cleaned)) {
      throw new ValidationError('Invalid Base64 image payload.', 'ERR_INVALID_BASE64');
    }

    const estimatedBytes = Math.floor((cleaned.length * 3) / 4);
    if (estimatedBytes > maxBytes + 3) {
      throw new ValidationError(
        `Image payload exceeds maximum allowed size (${maxBytes} bytes).`,
        'ERR_IMAGE_TOO_LARGE'
      );
    }

    const buf = Buffer.from(cleaned, 'base64');
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    if (bytes.byteLength > maxBytes) {
      throw new ValidationError(
        `Image payload (${bytes.byteLength} bytes) exceeds maximum allowed size (${maxBytes} bytes).`,
        'ERR_IMAGE_TOO_LARGE'
      );
    }
    return {
      bytes,
      expectedMimeType: source.mimeType,
    };
  }

  // Strict opt-in guard for local file_path sources
  const allowedDirs = (options.allowedMediaDirs ?? []).filter((d) => d.trim().length > 0);
  if (allowedDirs.length === 0) {
    throw new ValidationError(
      'Local file_path media input is disabled unless ARIADECK_ALLOWED_MEDIA_DIRS is configured. Use base64 source instead.',
      'ERR_MEDIA_PATH_NOT_ALLOWED'
    );
  }

  const trimmedPath = source.path.trim();
  if (!trimmedPath) {
    throw new ValidationError('Media file path must not be empty.', 'ERR_MEDIA_PATH_NOT_ALLOWED');
  }

  let resolvedFilePath: string;
  try {
    resolvedFilePath = await realpath(resolve(trimmedPath));
  } catch {
    throw new ValidationError(
      `Media file could not be accessed at path "${source.path}".`,
      'ERR_MEDIA_FILE_NOT_FOUND'
    );
  }

  let insideAllowedDir = false;
  for (const dir of allowedDirs) {
    try {
      const realDir = await realpath(resolve(dir));
      const rel = relative(realDir, resolvedFilePath);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
        insideAllowedDir = true;
        break;
      }
    } catch {
      // Skip non-existent allowed directory entries
    }
  }

  if (!insideAllowedDir) {
    throw new ValidationError(
      'Requested media file path is outside ARIADECK_ALLOWED_MEDIA_DIRS.',
      'ERR_MEDIA_PATH_NOT_ALLOWED'
    );
  }

  const fileStat = await stat(resolvedFilePath);
  if (!fileStat.isFile()) {
    throw new ValidationError(
      'Requested media path must point to a regular file.',
      'ERR_MEDIA_PATH_NOT_ALLOWED'
    );
  }
  if (fileStat.size > maxBytes) {
    throw new ValidationError(
      `Image file (${fileStat.size} bytes) exceeds maximum allowed size (${maxBytes} bytes).`,
      'ERR_IMAGE_TOO_LARGE'
    );
  }

  const buf = await readFile(resolvedFilePath);
  return {
    bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  };
}
