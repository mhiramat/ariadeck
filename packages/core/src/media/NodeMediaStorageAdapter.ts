import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { ValidationError } from '../errors.js';
import type { SupportedImageMimeType } from '../types/models.js';
import {
  DEFAULT_THUMBNAIL_MAX_EDGE_PX,
  isValidSha256Hex,
  parseImageDimensionsFromBytes,
} from './imageValidation.js';
import type { GeneratedThumbnailResult, MediaStorageAdapter } from './MediaStorageAdapter.js';

const IS_POSIX = process.platform !== 'win32';

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
  if (IS_POSIX) {
    await chmod(dirPath, 0o700).catch(() => undefined);
  }
}

async function writePrivateFile(filePath: string, bytes: Uint8Array): Promise<void> {
  await ensurePrivateDir(dirname(filePath));
  await writeFile(filePath, bytes, { mode: 0o600 });
  if (IS_POSIX) {
    await chmod(filePath, 0o600).catch(() => undefined);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Node.js Content-Addressed Storage (CAS) implementation of MediaStorageAdapter
 * storing immutable originals under `<rootDir>/originals/{sha256}.{ext}` and
 * sharp-generated WebP thumbnails under `<rootDir>/thumbs/{sha256}.webp`.
 */
export class NodeMediaStorageAdapter implements MediaStorageAdapter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    if (!rootDir.trim()) {
      throw new ValidationError('Media root directory must not be empty.');
    }
    this.rootDir = resolve(rootDir);
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private resolveSafePath(localUri: string): string {
    const normalized = localUri.replace(/^\/+/, '');
    if (!normalized || isAbsolute(localUri)) {
      throw new ValidationError(`Invalid CAS media URI: "${localUri}".`);
    }
    const candidate = resolve(this.rootDir, normalized);
    const rel = relative(this.rootDir, candidate);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new ValidationError(`Media URI escapes CAS root directory: "${localUri}".`);
    }
    return candidate;
  }

  private assertSha256(sha256: string): void {
    if (!isValidSha256Hex(sha256)) {
      throw new ValidationError(`Invalid SHA-256 media hash: "${sha256}".`);
    }
  }

  async writeOriginal(sha256: string, ext: 'jpg' | 'png', bytes: Uint8Array): Promise<string> {
    this.assertSha256(sha256);
    const uri = `originals/${sha256}.${ext}`;
    const fullPath = this.resolveSafePath(uri);
    if (!(await fileExists(fullPath))) {
      await writePrivateFile(fullPath, bytes);
    }
    return uri;
  }

  async readOriginal(localUri: string): Promise<Uint8Array | null> {
    const fullPath = this.resolveSafePath(localUri);
    try {
      const buf = await readFile(fullPath);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  }

  async existsOriginal(sha256: string, ext: 'jpg' | 'png'): Promise<boolean> {
    this.assertSha256(sha256);
    const fullPath = this.resolveSafePath(`originals/${sha256}.${ext}`);
    return fileExists(fullPath);
  }

  async deleteOriginal(localUri: string): Promise<void> {
    const fullPath = this.resolveSafePath(localUri);
    await rm(fullPath, { force: true });
  }

  async generateThumbnail(
    originalBytes: Uint8Array,
    mimeType: SupportedImageMimeType,
    sha256: string,
    maxEdgePx = DEFAULT_THUMBNAIL_MAX_EDGE_PX
  ): Promise<GeneratedThumbnailResult> {
    this.assertSha256(sha256);
    const thumbnailUri = `thumbs/${sha256}.webp`;
    const thumbPath = this.resolveSafePath(thumbnailUri);

    const image = sharp(originalBytes, { failOn: 'none' });
    const metadata = await image.metadata();
    const fallbackDims = parseImageDimensionsFromBytes(originalBytes, mimeType);

    // Account for EXIF orientations 5-8 which swap width and height when rotated.
    const rawWidth = metadata.width ?? fallbackDims?.width ?? 1;
    const rawHeight = metadata.height ?? fallbackDims?.height ?? 1;
    const swapped =
      metadata.orientation !== undefined &&
      metadata.orientation >= 5 &&
      metadata.orientation <= 8;
    const width = swapped ? rawHeight : rawWidth;
    const height = swapped ? rawWidth : rawHeight;

    if (!(await fileExists(thumbPath))) {
      const thumbBuffer = await sharp(originalBytes, { failOn: 'none' })
        .rotate()
        .resize({
          width: maxEdgePx,
          height: maxEdgePx,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
      await writePrivateFile(
        thumbPath,
        new Uint8Array(thumbBuffer.buffer, thumbBuffer.byteOffset, thumbBuffer.byteLength)
      );
    }

    return {
      thumbnailUri,
      width,
      height,
    };
  }

  async readThumbnail(thumbnailUri: string): Promise<Uint8Array | null> {
    const fullPath = this.resolveSafePath(thumbnailUri);
    try {
      const buf = await readFile(fullPath);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  }

  async deleteThumbnail(thumbnailUri: string): Promise<void> {
    const fullPath = this.resolveSafePath(thumbnailUri);
    await rm(fullPath, { force: true });
  }

  async resolveRenderUrl(localUri: string): Promise<string> {
    const fullPath = this.resolveSafePath(localUri);
    return pathToFileURL(fullPath).href;
  }
}
