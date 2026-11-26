import { NotFoundError, ValidationError } from '../errors.js';
import {
  computeSha256Hex,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_THUMBNAIL_MAX_EDGE_PX,
  validateImageBytes,
} from '../media/imageValidation.js';
import type { MediaStorageAdapter } from '../media/MediaStorageAdapter.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type {
  AttachImageInput,
  Card,
  CardAttachment,
  CardDisplayMode,
  CreateImageCardInput,
  ImageAttachmentResult,
  MediaGarbageCollectionResult,
  MutationContext,
  UpdateAttachmentInput,
} from '../types/models.js';
import type { BoardGraphService } from './BoardGraphService.js';

export interface MediaServiceOptions {
  deviceId?: string;
  maxImageBytes?: number;
  thumbnailMaxEdgePx?: number;
  now?: () => string;
  generateId?: () => string;
}

const VALID_DISPLAY_MODES = new Set<CardDisplayMode>(['standard', 'image_cover', 'image_only']);

function defaultGenerateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function normalizeDisplayMode(mode?: CardDisplayMode): CardDisplayMode {
  if (mode && VALID_DISPLAY_MODES.has(mode)) {
    return mode;
  }
  return 'standard';
}

function validateOptionalDisplayMode(mode?: CardDisplayMode): void {
  if (mode !== undefined && !VALID_DISPLAY_MODES.has(mode)) {
    throw new ValidationError(
      `Invalid displayMode "${String(mode)}". Expected "standard", "image_cover", or "image_only".`
    );
  }
}

/**
 * Coordinates content-addressed JPEG/PNG image storage, thumbnail generation,
 * cover/displayMode state transitions, and reference-counted garbage collection.
 */
export class MediaService {
  private readonly storage: StorageAdapter;
  private readonly boardService: BoardGraphService;
  private readonly mediaStorage: MediaStorageAdapter;
  private readonly defaultDeviceId: string;
  private readonly maxImageBytes: number;
  private readonly thumbnailMaxEdgePx: number;
  private readonly now: () => string;
  private readonly generateId: () => string;

  constructor(
    storage: StorageAdapter,
    boardService: BoardGraphService,
    mediaStorage: MediaStorageAdapter,
    options: MediaServiceOptions = {}
  ) {
    this.storage = storage;
    this.boardService = boardService;
    this.mediaStorage = mediaStorage;
    this.defaultDeviceId = options.deviceId ?? 'ariadeck-core-local';
    this.maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.thumbnailMaxEdgePx = options.thumbnailMaxEdgePx ?? DEFAULT_THUMBNAIL_MAX_EDGE_PX;
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? defaultGenerateId;
  }

  private resolveDeviceId(ctx?: MutationContext): string {
    return ctx?.deviceId ?? this.defaultDeviceId;
  }

  getMaxImageBytes(): number {
    return this.maxImageBytes;
  }

  /**
   * Validates, hashes, stores, and attaches a JPEG/PNG image to an existing card.
   * Automatically switches a standard card to image_cover on its first image when
   * displayMode is not explicitly provided.
   */
  async attachImageToCard(
    params: AttachImageInput,
    ctx?: MutationContext
  ): Promise<ImageAttachmentResult> {
    validateOptionalDisplayMode(params.displayMode);

    const card = await this.storage.getCard(params.cardId, false);
    if (!card) {
      throw new NotFoundError('Card', params.cardId);
    }

    const { mimeType, ext } = validateImageBytes(params.bytes, {
      maxBytes: this.maxImageBytes,
      expectedMimeType: params.expectedMimeType,
    });
    const sha256 = await computeSha256Hex(params.bytes);

    let localUri: string;
    if (await this.mediaStorage.existsOriginal(sha256, ext)) {
      localUri = `originals/${sha256}.${ext}`;
    } else {
      localUri = await this.mediaStorage.writeOriginal(sha256, ext, params.bytes);
    }

    const thumb = await this.mediaStorage.generateThumbnail(
      params.bytes,
      mimeType,
      sha256,
      this.thumbnailMaxEdgePx
    );

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const trimmedCaption =
      params.caption === undefined || params.caption === null
        ? null
        : params.caption.trim() || null;

    let updatedCard = card;
    let createdAttachment!: CardAttachment;

    await this.storage.runInTransaction(async () => {
      const existingAttachments = await this.storage.listAttachmentsByCard(card.id, false);
      const existingImages = existingAttachments.filter((a) => a.kind === 'image');
      const isFirstImage = existingImages.length === 0;
      const shouldSetCover = isFirstImage ? true : (params.setAsCover ?? true);

      const nextSortOrder =
        existingAttachments.length === 0
          ? 0
          : Math.max(...existingAttachments.map((a) => a.sortOrder ?? 0)) + 1;

      if (shouldSetCover) {
        for (const sibling of existingImages) {
          if (sibling.isCover) {
            const cleared: CardAttachment = {
              ...sibling,
              isCover: false,
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: sibling.version + 1,
            };
            await this.storage.saveAttachment(cleared);
            await this.storage.appendOutbox({
              entityType: 'attachment',
              entityId: cleared.id,
              boardId: cleared.boardId,
              operation: 'update',
              payloadJson: JSON.stringify(cleared),
              createdAt: timestamp,
              syncedAt: null,
            });
          }
        }
      }

      createdAttachment = {
        id: this.generateId(),
        cardId: card.id,
        boardId: card.boardId,
        kind: 'image',
        localUri,
        remoteFileId: null,
        mimeType,
        fileSize: params.bytes.byteLength,
        sha256,
        width: thumb.width,
        height: thumb.height,
        thumbnailUri: thumb.thumbnailUri,
        caption: trimmedCaption,
        isCover: shouldSetCover,
        sortOrder: nextSortOrder,
        durationMs: null,
        transcript: null,
        syncStatus: 'local_only',
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByDeviceId: deviceId,
        version: 1,
        deletedAt: null,
      };

      await this.storage.saveAttachment(createdAttachment);
      await this.storage.appendOutbox({
        entityType: 'attachment',
        entityId: createdAttachment.id,
        boardId: createdAttachment.boardId,
        operation: 'create',
        payloadJson: JSON.stringify(createdAttachment),
        createdAt: timestamp,
        syncedAt: null,
      });

      const currentMode = normalizeDisplayMode(card.displayMode);
      const nextMode: CardDisplayMode =
        params.displayMode !== undefined
          ? params.displayMode
          : isFirstImage && currentMode === 'standard'
            ? 'image_cover'
            : currentMode;

      if (nextMode !== currentMode || card.displayMode === undefined) {
        updatedCard = {
          ...card,
          displayMode: nextMode,
          updatedAt: timestamp,
          updatedByDeviceId: deviceId,
          version: card.version + 1,
        };
        await this.storage.saveCard(updatedCard);
        await this.storage.appendOutbox({
          entityType: 'card',
          entityId: updatedCard.id,
          boardId: updatedCard.boardId,
          operation: 'update',
          payloadJson: JSON.stringify(updatedCard),
          createdAt: timestamp,
          syncedAt: null,
        });
      }
    });

    this.boardService.eventBus.emit({
      type: 'card:updated',
      boardId: card.boardId,
      entityIds: [card.id],
      deviceId,
      timestamp,
    });

    return {
      card: updatedCard,
      attachment: createdAttachment,
    };
  }

  /**
   * Atomically creates a new card (defaulting to displayMode "image_cover") and
   * attaches the validated JPEG/PNG image as its cover.
   */
  async createImageCard(
    params: CreateImageCardInput,
    ctx?: MutationContext
  ): Promise<ImageAttachmentResult> {
    const title = params.title.trim();
    if (!title) {
      throw new ValidationError('Card title must not be empty.');
    }
    const displayMode: CardDisplayMode = params.displayMode ?? 'image_cover';
    validateOptionalDisplayMode(displayMode);

    await this.boardService.getBoard(params.boardId);

    const { mimeType, ext } = validateImageBytes(params.bytes, {
      maxBytes: this.maxImageBytes,
      expectedMimeType: params.expectedMimeType,
    });
    const sha256 = await computeSha256Hex(params.bytes);

    let localUri: string;
    if (await this.mediaStorage.existsOriginal(sha256, ext)) {
      localUri = `originals/${sha256}.${ext}`;
    } else {
      localUri = await this.mediaStorage.writeOriginal(sha256, ext, params.bytes);
    }

    const thumb = await this.mediaStorage.generateThumbnail(
      params.bytes,
      mimeType,
      sha256,
      this.thumbnailMaxEdgePx
    );

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const trimmedCaption =
      params.caption === undefined || params.caption === null
        ? null
        : params.caption.trim() || null;

    let posX = params.posX;
    let posY = params.posY;
    if (posX === undefined || posY === undefined) {
      const existingCards = await this.storage.listCardsByBoard(params.boardId, false);
      const col = existingCards.length % 4;
      const row = Math.floor(existingCards.length / 4);
      posX = posX ?? 80 + col * 280;
      posY = posY ?? 80 + row * 160;
    }

    const card: Card = {
      id: this.generateId(),
      boardId: params.boardId,
      title,
      content: params.content ?? '',
      cardType: params.cardType ?? 'idea',
      displayMode,
      status: params.status ?? 'todo',
      tags: params.tags ? [...params.tags] : [],
      posX,
      posY,
      timelineOrder: null,
      startAt: null,
      endAt: null,
      splitFromCardId: null,
      mergedFromCardIds: null,
      replacedByCardIds: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    const attachment: CardAttachment = {
      id: this.generateId(),
      cardId: card.id,
      boardId: card.boardId,
      kind: 'image',
      localUri,
      remoteFileId: null,
      mimeType,
      fileSize: params.bytes.byteLength,
      sha256,
      width: thumb.width,
      height: thumb.height,
      thumbnailUri: thumb.thumbnailUri,
      caption: trimmedCaption,
      isCover: true,
      sortOrder: 0,
      durationMs: null,
      transcript: null,
      syncStatus: 'local_only',
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: 1,
      deletedAt: null,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveCard(card);
      await this.storage.appendOutbox({
        entityType: 'card',
        entityId: card.id,
        boardId: card.boardId,
        operation: 'create',
        payloadJson: JSON.stringify(card),
        createdAt: timestamp,
        syncedAt: null,
      });
      await this.storage.saveAttachment(attachment);
      await this.storage.appendOutbox({
        entityType: 'attachment',
        entityId: attachment.id,
        boardId: attachment.boardId,
        operation: 'create',
        payloadJson: JSON.stringify(attachment),
        createdAt: timestamp,
        syncedAt: null,
      });
    });

    this.boardService.eventBus.emit({
      type: 'card:created',
      boardId: card.boardId,
      entityIds: [card.id],
      deviceId,
      timestamp,
    });

    return { card, attachment };
  }

  /**
   * Marks a specific active image attachment as the cover image of its card.
   */
  async setCoverImage(
    cardId: string,
    attachmentId: string,
    ctx?: MutationContext
  ): Promise<CardAttachment> {
    const card = await this.storage.getCard(cardId, false);
    if (!card) {
      throw new NotFoundError('Card', cardId);
    }
    const target = await this.storage.getAttachment(attachmentId, false);
    if (!target || target.cardId !== cardId) {
      throw new NotFoundError('Attachment', attachmentId);
    }
    if (target.kind !== 'image') {
      throw new ValidationError('Only image attachments can be set as the card cover.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    let updatedTarget: CardAttachment = target;

    await this.storage.runInTransaction(async () => {
      const siblings = await this.storage.listAttachmentsByCard(cardId, false);
      for (const sibling of siblings) {
        if (sibling.kind !== 'image') continue;
        if (sibling.id === attachmentId) {
          if (!sibling.isCover) {
            updatedTarget = {
              ...sibling,
              isCover: true,
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: sibling.version + 1,
            };
            await this.storage.saveAttachment(updatedTarget);
            await this.storage.appendOutbox({
              entityType: 'attachment',
              entityId: updatedTarget.id,
              boardId: updatedTarget.boardId,
              operation: 'update',
              payloadJson: JSON.stringify(updatedTarget),
              createdAt: timestamp,
              syncedAt: null,
            });
          }
        } else if (sibling.isCover) {
          const cleared: CardAttachment = {
            ...sibling,
            isCover: false,
            updatedAt: timestamp,
            updatedByDeviceId: deviceId,
            version: sibling.version + 1,
          };
          await this.storage.saveAttachment(cleared);
          await this.storage.appendOutbox({
            entityType: 'attachment',
            entityId: cleared.id,
            boardId: cleared.boardId,
            operation: 'update',
            payloadJson: JSON.stringify(cleared),
            createdAt: timestamp,
            syncedAt: null,
          });
        }
      }
    });

    this.boardService.eventBus.emit({
      type: 'card:updated',
      boardId: card.boardId,
      entityIds: [card.id],
      deviceId,
      timestamp,
    });

    return updatedTarget;
  }

  /**
   * Updates editable metadata (caption, transcript, isCover, sortOrder) on an
   * active attachment.
   */
  async updateAttachment(
    attachmentId: string,
    patch: UpdateAttachmentInput,
    ctx?: MutationContext
  ): Promise<CardAttachment> {
    const existing = await this.storage.getAttachment(attachmentId, false);
    if (!existing) {
      throw new NotFoundError('Attachment', attachmentId);
    }

    if (patch.isCover === true && existing.kind !== 'image') {
      throw new ValidationError('Only image attachments can be set as the card cover.');
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const nextCaption =
      patch.caption === undefined
        ? (existing.caption ?? null)
        : patch.caption === null
          ? null
          : patch.caption.trim() || null;

    let updated: CardAttachment = {
      ...existing,
      caption: nextCaption,
      transcript: patch.transcript !== undefined ? patch.transcript : existing.transcript,
      isCover: patch.isCover !== undefined ? patch.isCover : (existing.isCover ?? false),
      sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : (existing.sortOrder ?? 0),
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
    };

    await this.storage.runInTransaction(async () => {
      if (patch.isCover === true) {
        const siblings = await this.storage.listAttachmentsByCard(existing.cardId, false);
        for (const sibling of siblings) {
          if (sibling.id !== existing.id && sibling.kind === 'image' && sibling.isCover) {
            const cleared: CardAttachment = {
              ...sibling,
              isCover: false,
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: sibling.version + 1,
            };
            await this.storage.saveAttachment(cleared);
            await this.storage.appendOutbox({
              entityType: 'attachment',
              entityId: cleared.id,
              boardId: cleared.boardId,
              operation: 'update',
              payloadJson: JSON.stringify(cleared),
              createdAt: timestamp,
              syncedAt: null,
            });
          }
        }
      }

      await this.storage.saveAttachment(updated);
      await this.storage.appendOutbox({
        entityType: 'attachment',
        entityId: updated.id,
        boardId: updated.boardId,
        operation: 'update',
        payloadJson: JSON.stringify(updated),
        createdAt: timestamp,
        syncedAt: null,
      });
    });

    this.boardService.eventBus.emit({
      type: 'card:updated',
      boardId: existing.boardId,
      entityIds: [existing.cardId],
      deviceId,
      timestamp,
    });

    return updated;
  }

  /**
   * Reorders active attachments on a card according to orderedAttachmentIds.
   */
  async reorderCardAttachments(
    cardId: string,
    orderedAttachmentIds: string[],
    ctx?: MutationContext
  ): Promise<CardAttachment[]> {
    const card = await this.storage.getCard(cardId, false);
    if (!card) {
      throw new NotFoundError('Card', cardId);
    }

    const active = await this.storage.listAttachmentsByCard(cardId, false);
    const byId = new Map(active.map((a) => [a.id, a]));
    const seen = new Set<string>();
    const ordered: CardAttachment[] = [];

    for (const id of orderedAttachmentIds) {
      if (seen.has(id)) continue;
      const att = byId.get(id);
      if (!att) {
        throw new NotFoundError('Attachment', id);
      }
      seen.add(id);
      ordered.push(att);
    }
    for (const att of active) {
      if (!seen.has(att.id)) {
        ordered.push(att);
      }
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);
    const result: CardAttachment[] = [];

    await this.storage.runInTransaction(async () => {
      for (let idx = 0; idx < ordered.length; idx++) {
        const current = ordered[idx]!;
        if ((current.sortOrder ?? 0) !== idx) {
          const updated: CardAttachment = {
            ...current,
            sortOrder: idx,
            updatedAt: timestamp,
            updatedByDeviceId: deviceId,
            version: current.version + 1,
          };
          await this.storage.saveAttachment(updated);
          await this.storage.appendOutbox({
            entityType: 'attachment',
            entityId: updated.id,
            boardId: updated.boardId,
            operation: 'update',
            payloadJson: JSON.stringify(updated),
            createdAt: timestamp,
            syncedAt: null,
          });
          result.push(updated);
        } else {
          result.push(current);
        }
      }
    });

    this.boardService.eventBus.emit({
      type: 'card:updated',
      boardId: card.boardId,
      entityIds: [card.id],
      deviceId,
      timestamp,
    });

    return result;
  }

  /**
   * Soft-deletes an attachment. If it was the cover image, promotes the next
   * active image by sortOrder; if no active images remain, resets card
   * displayMode to "standard".
   */
  async removeAttachment(attachmentId: string, ctx?: MutationContext): Promise<void> {
    const existing = await this.storage.getAttachment(attachmentId, false);
    if (!existing) {
      throw new NotFoundError('Attachment', attachmentId);
    }

    const timestamp = this.now();
    const deviceId = this.resolveDeviceId(ctx);

    const deleted: CardAttachment = {
      ...existing,
      isCover: false,
      updatedAt: timestamp,
      updatedByDeviceId: deviceId,
      version: existing.version + 1,
      deletedAt: timestamp,
    };

    await this.storage.runInTransaction(async () => {
      await this.storage.saveAttachment(deleted);
      await this.storage.appendOutbox({
        entityType: 'attachment',
        entityId: deleted.id,
        boardId: deleted.boardId,
        operation: 'delete',
        payloadJson: JSON.stringify(deleted),
        createdAt: timestamp,
        syncedAt: null,
      });

      if (existing.kind === 'image') {
        const remainingImages = (
          await this.storage.listAttachmentsByCard(existing.cardId, false)
        ).filter((a) => a.kind === 'image');

        if (remainingImages.length === 0) {
          const card = await this.storage.getCard(existing.cardId, false);
          if (card && normalizeDisplayMode(card.displayMode) !== 'standard') {
            const resetCard: Card = {
              ...card,
              displayMode: 'standard',
              updatedAt: timestamp,
              updatedByDeviceId: deviceId,
              version: card.version + 1,
            };
            await this.storage.saveCard(resetCard);
            await this.storage.appendOutbox({
              entityType: 'card',
              entityId: resetCard.id,
              boardId: resetCard.boardId,
              operation: 'update',
              payloadJson: JSON.stringify(resetCard),
              createdAt: timestamp,
              syncedAt: null,
            });
          }
        } else if (existing.isCover && !remainingImages.some((a) => a.isCover)) {
          const promoted: CardAttachment = {
            ...remainingImages[0]!,
            isCover: true,
            updatedAt: timestamp,
            updatedByDeviceId: deviceId,
            version: remainingImages[0]!.version + 1,
          };
          await this.storage.saveAttachment(promoted);
          await this.storage.appendOutbox({
            entityType: 'attachment',
            entityId: promoted.id,
            boardId: promoted.boardId,
            operation: 'update',
            payloadJson: JSON.stringify(promoted),
            createdAt: timestamp,
            syncedAt: null,
          });
        }
      }
    });

    this.boardService.eventBus.emit({
      type: 'card:updated',
      boardId: existing.boardId,
      entityIds: [existing.cardId],
      deviceId,
      timestamp,
    });
  }

  /**
   * Reference-counted garbage collection: deletes local originals and thumbnails
   * for SHA-256 hashes that have zero active references and whose most recent
   * soft-deletion timestamp is older than `retentionDays`.
   */
  async runMediaGarbageCollection(retentionDays = 30): Promise<MediaGarbageCollectionResult> {
    if (!Number.isFinite(retentionDays) || retentionDays < 0) {
      throw new ValidationError('retentionDays must be a non-negative number.');
    }

    const nowMs = Date.parse(this.now());
    const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const allAttachments = await this.storage.listAllAttachments(true);
    const byHash = new Map<
      string,
      {
        activeCount: number;
        maxDeletedAtMs: number;
        localUris: Set<string>;
        thumbnailUris: Set<string>;
      }
    >();

    for (const att of allAttachments) {
      const hash = att.sha256;
      if (!hash) continue;
      let entry = byHash.get(hash);
      if (!entry) {
        entry = {
          activeCount: 0,
          maxDeletedAtMs: -Infinity,
          localUris: new Set(),
          thumbnailUris: new Set(),
        };
        byHash.set(hash, entry);
      }
      if (att.localUri) entry.localUris.add(att.localUri);
      if (att.thumbnailUri) entry.thumbnailUris.add(att.thumbnailUri);

      if (att.deletedAt === null) {
        entry.activeCount += 1;
      } else {
        const deletedMs = Date.parse(att.deletedAt);
        if (Number.isFinite(deletedMs) && deletedMs > entry.maxDeletedAtMs) {
          entry.maxDeletedAtMs = deletedMs;
        }
      }
    }

    const deletedHashes: string[] = [];
    let deletedFilesCount = 0;

    for (const [hash, stats] of byHash.entries()) {
      if (stats.activeCount === 0 && stats.maxDeletedAtMs < cutoffMs) {
        for (const uri of stats.localUris) {
          await this.mediaStorage.deleteOriginal(uri);
          deletedFilesCount += 1;
        }
        for (const thumbUri of stats.thumbnailUris) {
          await this.mediaStorage.deleteThumbnail(thumbUri);
          deletedFilesCount += 1;
        }
        deletedHashes.push(hash);
      }
    }

    return {
      retentionDays,
      cutoffIso,
      deletedHashes,
      deletedFilesCount,
    };
  }

  /**
   * Retrieves active attachment metadata and its original binary payload.
   */
  async readAttachmentOriginal(
    attachmentId: string
  ): Promise<{ attachment: CardAttachment; bytes: Uint8Array }> {
    const attachment = await this.storage.getAttachment(attachmentId, false);
    if (!attachment) {
      throw new NotFoundError('Attachment', attachmentId);
    }
    const bytes = await this.mediaStorage.readOriginal(attachment.localUri);
    if (!bytes) {
      throw new NotFoundError('Media binary', attachmentId);
    }
    return { attachment, bytes };
  }

  /**
   * Retrieves active attachment metadata and its WebP thumbnail payload, falling
   * back to the original bytes if no separate thumbnail exists.
   */
  async readAttachmentThumbnail(
    attachmentId: string
  ): Promise<{ attachment: CardAttachment; bytes: Uint8Array; mimeType: string }> {
    const attachment = await this.storage.getAttachment(attachmentId, false);
    if (!attachment) {
      throw new NotFoundError('Attachment', attachmentId);
    }
    if (attachment.thumbnailUri) {
      const thumbBytes = await this.mediaStorage.readThumbnail(attachment.thumbnailUri);
      if (thumbBytes) {
        return { attachment, bytes: thumbBytes, mimeType: 'image/webp' };
      }
    }
    const origBytes = await this.mediaStorage.readOriginal(attachment.localUri);
    if (!origBytes) {
      throw new NotFoundError('Media binary', attachmentId);
    }
    return { attachment, bytes: origBytes, mimeType: attachment.mimeType };
  }
}
