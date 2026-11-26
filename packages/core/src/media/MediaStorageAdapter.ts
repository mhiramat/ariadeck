import type { SupportedImageMimeType } from '../types/models.js';
import {
  DEFAULT_THUMBNAIL_MAX_EDGE_PX,
  parseImageDimensionsFromBytes,
} from './imageValidation.js';

export interface GeneratedThumbnailResult {
  thumbnailUri: string;
  width: number;
  height: number;
}

/**
 * Platform-injected Content-Addressed Storage (CAS) adapter for image binaries
 * and locally generated thumbnails.
 */
export interface MediaStorageAdapter {
  writeOriginal(sha256: string, ext: 'jpg' | 'png', bytes: Uint8Array): Promise<string>;
  readOriginal(localUri: string): Promise<Uint8Array | null>;
  existsOriginal(sha256: string, ext: 'jpg' | 'png'): Promise<boolean>;
  deleteOriginal(localUri: string): Promise<void>;
  generateThumbnail(
    originalBytes: Uint8Array,
    mimeType: SupportedImageMimeType,
    sha256: string,
    maxEdgePx?: number
  ): Promise<GeneratedThumbnailResult>;
  readThumbnail(thumbnailUri: string): Promise<Uint8Array | null>;
  deleteThumbnail(thumbnailUri: string): Promise<void>;
  resolveRenderUrl(localUri: string): Promise<string>;
}

/**
 * In-memory MediaStorageAdapter for deterministic unit tests and browser-only
 * environments without filesystem access.
 */
export class InMemoryMediaStorageAdapter implements MediaStorageAdapter {
  private readonly originals = new Map<string, Uint8Array>();
  private readonly thumbnails = new Map<string, Uint8Array>();
  private readonly dimensions = new Map<string, { width: number; height: number }>();

  getOriginalCount(): number {
    return this.originals.size;
  }

  getThumbnailCount(): number {
    return this.thumbnails.size;
  }

  async writeOriginal(sha256: string, ext: 'jpg' | 'png', bytes: Uint8Array): Promise<string> {
    const uri = `originals/${sha256}.${ext}`;
    if (!this.originals.has(uri)) {
      this.originals.set(uri, new Uint8Array(bytes));
    }
    return uri;
  }

  async readOriginal(localUri: string): Promise<Uint8Array | null> {
    const data = this.originals.get(localUri);
    return data ? new Uint8Array(data) : null;
  }

  async existsOriginal(sha256: string, ext: 'jpg' | 'png'): Promise<boolean> {
    return this.originals.has(`originals/${sha256}.${ext}`);
  }

  async deleteOriginal(localUri: string): Promise<void> {
    this.originals.delete(localUri);
  }

  async generateThumbnail(
    originalBytes: Uint8Array,
    mimeType: SupportedImageMimeType,
    sha256: string,
    _maxEdgePx = DEFAULT_THUMBNAIL_MAX_EDGE_PX
  ): Promise<GeneratedThumbnailResult> {
    const thumbnailUri = `thumbs/${sha256}.webp`;
    if (!this.thumbnails.has(thumbnailUri)) {
      this.thumbnails.set(thumbnailUri, new Uint8Array(originalBytes));
    }
    let dims = this.dimensions.get(sha256);
    if (!dims) {
      dims = parseImageDimensionsFromBytes(originalBytes, mimeType) ?? { width: 1, height: 1 };
      this.dimensions.set(sha256, dims);
    }
    return {
      thumbnailUri,
      width: dims.width,
      height: dims.height,
    };
  }

  async readThumbnail(thumbnailUri: string): Promise<Uint8Array | null> {
    const data = this.thumbnails.get(thumbnailUri);
    return data ? new Uint8Array(data) : null;
  }

  async deleteThumbnail(thumbnailUri: string): Promise<void> {
    this.thumbnails.delete(thumbnailUri);
  }

  async resolveRenderUrl(localUri: string): Promise<string> {
    return `memory://${localUri}`;
  }
}
