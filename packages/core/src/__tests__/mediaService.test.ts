import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {
  BoardGraphService,
  InMemoryMediaStorageAdapter,
  InMemoryStorageAdapter,
  MediaService,
  ValidationError,
  detectImageMimeType,
  resolveMaxImageBytes,
} from '../index.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';
import { NodeMediaStorageAdapter } from '../media/NodeMediaStorageAdapter.js';

async function createSamplePng(width: number, height: number, r = 64, g = 128, b = 220): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function createSampleJpeg(width: number, height: number, r = 200, g = 90, b = 40): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe('Image validation helpers', () => {
  it('detects JPEG and PNG magic bytes and rejects non-image payloads', async () => {
    const png = await createSamplePng(16, 16);
    const jpg = await createSampleJpeg(16, 16);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const txt = new TextEncoder().encode('hello world');

    expect(detectImageMimeType(png)).toBe('image/png');
    expect(detectImageMimeType(jpg)).toBe('image/jpeg');
    expect(detectImageMimeType(svg)).toBeNull();
    expect(detectImageMimeType(txt)).toBeNull();
    expect(resolveMaxImageBytes(undefined)).toBe(15 * 1024 * 1024);
    expect(resolveMaxImageBytes('2048')).toBe(2048);
    expect(resolveMaxImageBytes('-5')).toBe(15 * 1024 * 1024);
  });
});

describe('SQLite v2 -> v3 Schema Migration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ariadeck-v3-mig-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates an existing v2 database to v3 without losing existing rows', async () => {
    const dbPath = join(tempDir, 'legacy-v2.db');
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE boards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        board_type TEXT NOT NULL DEFAULT 'flow',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by_device_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      );
      CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        card_type TEXT NOT NULL DEFAULT 'idea',
        status TEXT NOT NULL DEFAULT 'todo',
        tags_json TEXT NOT NULL DEFAULT '[]',
        pos_x REAL NOT NULL DEFAULT 0,
        pos_y REAL NOT NULL DEFAULT 0,
        timeline_order INTEGER,
        start_at TEXT,
        end_at TEXT,
        split_from_card_id TEXT,
        merged_from_card_ids_json TEXT,
        replaced_by_card_ids_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by_device_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      );
      CREATE TABLE edges (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        source_card_id TEXT NOT NULL,
        target_card_id TEXT NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'blocks',
        direction TEXT NOT NULL DEFAULT 'directed',
        label TEXT,
        style_variant TEXT NOT NULL DEFAULT 'solid',
        color TEXT,
        is_conflicted INTEGER NOT NULL DEFAULT 0,
        conflict_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by_device_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      );
      CREATE TABLE card_attachments (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        local_uri TEXT NOT NULL,
        remote_file_id TEXT,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        transcript TEXT,
        sync_status TEXT NOT NULL DEFAULT 'local_only',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by_device_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      );
      INSERT INTO boards VALUES ('b1', 'Legacy', '', 'flow', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'dev', 1, NULL);
      INSERT INTO cards VALUES ('c1', 'b1', 'Old Card', 'body', 'idea', 'todo', '[]', 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'dev', 1, NULL);
      INSERT INTO card_attachments VALUES ('a1', 'c1', 'b1', 'audio', 'audio/a1.m4a', NULL, 'audio/mp4', 100, 1000, 'hello', 'local_only', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'dev', 1, NULL);
    `);
    raw.close();

    const storage = new SqliteStorageAdapter(dbPath);
    await storage.initialize();
    try {
      const card = await storage.getCard('c1');
      expect(card?.displayMode).toBe('standard');
      const att = await storage.getAttachment('a1');
      expect(att?.sha256).toBeNull();
      expect(att?.caption).toBeNull();
      expect(att?.isCover).toBe(false);
      expect(att?.sortOrder).toBe(0);
    } finally {
      await storage.close();
    }
  });
});

describe('MediaService + NodeMediaStorageAdapter (CAS, sharp thumbnails, cover rules, GC)', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;
  let boardService: BoardGraphService;
  let mediaStorage: NodeMediaStorageAdapter;
  let mediaService: MediaService;
  let currentTime: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ariadeck-media-test-'));
    currentTime = '2026-11-01T10:00:00.000Z';
    storage = new SqliteStorageAdapter(join(tempDir, 'test.db'));
    await storage.initialize();
    boardService = new BoardGraphService(storage, {
      deviceId: 'test-device',
      now: () => currentTime,
    });
    mediaStorage = new NodeMediaStorageAdapter(join(tempDir, 'media'));
    mediaService = new MediaService(storage, boardService, mediaStorage, {
      deviceId: 'test-device',
      maxImageBytes: 2 * 1024 * 1024,
      now: () => currentTime,
    });
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects non-JPEG/PNG payloads, mismatched MIME types, and oversized files', async () => {
    const board = await boardService.createBoard({ title: 'Validation Board' });
    const card = await boardService.createCard({ boardId: board.id, title: 'Target' });

    const svgBytes = new TextEncoder().encode('<svg></svg>');
    await expect(
      mediaService.attachImageToCard({ cardId: card.id, bytes: svgBytes })
    ).rejects.toThrow(ValidationError);

    const txtBytes = new TextEncoder().encode('fake jpg contents');
    await expect(
      mediaService.attachImageToCard({
        cardId: card.id,
        bytes: txtBytes,
        expectedMimeType: 'image/jpeg',
      })
    ).rejects.toThrow(ValidationError);

    const pngBytes = await createSamplePng(32, 32);
    await expect(
      mediaService.attachImageToCard({
        cardId: card.id,
        bytes: pngBytes,
        expectedMimeType: 'image/jpeg',
      })
    ).rejects.toThrow(ValidationError);

    const tinyLimitService = new MediaService(storage, boardService, mediaStorage, {
      maxImageBytes: 16,
    });
    await expect(
      tinyLimitService.attachImageToCard({ cardId: card.id, bytes: pngBytes })
    ).rejects.toThrow(ValidationError);
  });

  it('generates <=480px WebP thumbnails without upscaling and records dimensions', async () => {
    const board = await boardService.createBoard({ title: 'Art Board' });
    const widePng = await createSamplePng(800, 400);
    const smallJpg = await createSampleJpeg(200, 120);

    const first = await mediaService.createImageCard({
      boardId: board.id,
      title: 'Wide Scene',
      bytes: widePng,
      caption: 'Harbor sunset illustration',
    });

    expect(first.card.displayMode).toBe('image_cover');
    expect(first.attachment.mimeType).toBe('image/png');
    expect(first.attachment.width).toBe(800);
    expect(first.attachment.height).toBe(400);
    expect(first.attachment.isCover).toBe(true);
    expect(first.attachment.caption).toBe('Harbor sunset illustration');

    const thumb1 = await mediaService.readAttachmentThumbnail(first.attachment.id);
    expect(thumb1.mimeType).toBe('image/webp');
    const thumb1Meta = await sharp(Buffer.from(thumb1.bytes)).metadata();
    expect(thumb1Meta.format).toBe('webp');
    expect(thumb1Meta.width).toBe(480);
    expect(thumb1Meta.height).toBe(240);

    const second = await mediaService.createImageCard({
      boardId: board.id,
      title: 'Small Portrait',
      bytes: smallJpg,
      displayMode: 'image_only',
    });
    expect(second.card.displayMode).toBe('image_only');
    expect(second.attachment.width).toBe(200);
    expect(second.attachment.height).toBe(120);

    const thumb2 = await mediaService.readAttachmentThumbnail(second.attachment.id);
    const thumb2Meta = await sharp(Buffer.from(thumb2.bytes)).metadata();
    expect(thumb2Meta.width).toBe(200);
    expect(thumb2Meta.height).toBe(120);

    // Search cards finds cards by image caption
    const found = await boardService.searchCards(board.id, 'harbor sunset');
    expect(found.map((c) => c.id)).toEqual([first.card.id]);
  });

  it('auto-switches displayMode, promotes cover on delete, and resets to standard when empty', async () => {
    const board = await boardService.createBoard({ title: 'Cover Transitions' });
    const card = await boardService.createCard({ boardId: board.id, title: 'Hero' });
    expect(card.displayMode).toBe('standard');

    const img1 = await createSamplePng(100, 100, 255, 0, 0);
    const img2 = await createSamplePng(100, 100, 0, 255, 0);
    const img3 = await createSamplePng(100, 100, 0, 0, 255);

    // First image auto-switches standard -> image_cover and becomes cover
    const res1 = await mediaService.attachImageToCard({ cardId: card.id, bytes: img1 });
    expect(res1.card.displayMode).toBe('image_cover');
    expect(res1.attachment.isCover).toBe(true);
    expect(res1.attachment.sortOrder).toBe(0);

    // Second image attached without taking cover
    const res2 = await mediaService.attachImageToCard({
      cardId: card.id,
      bytes: img2,
      setAsCover: false,
    });
    expect(res2.attachment.isCover).toBe(false);
    expect(res2.attachment.sortOrder).toBe(1);

    // Third image takes cover
    const res3 = await mediaService.attachImageToCard({
      cardId: card.id,
      bytes: img3,
      setAsCover: true,
    });
    expect(res3.attachment.isCover).toBe(true);

    // Reorder so res2 is first
    const reordered = await mediaService.reorderCardAttachments(card.id, [
      res2.attachment.id,
      res1.attachment.id,
      res3.attachment.id,
    ]);
    expect(reordered.map((a) => a.id)).toEqual([
      res2.attachment.id,
      res1.attachment.id,
      res3.attachment.id,
    ]);

    // Deleting cover (res3) auto-promotes lowest sortOrder remaining image (res2)
    await mediaService.removeAttachment(res3.attachment.id);
    const afterCoverDelete = await storage.listAttachmentsByCard(card.id, false);
    expect(afterCoverDelete.map((a) => [a.id, a.isCover])).toEqual([
      [res2.attachment.id, true],
      [res1.attachment.id, false],
    ]);

    // Explicitly switch cover to res1 and edit caption
    const promoted = await mediaService.setCoverImage(card.id, res1.attachment.id);
    expect(promoted.isCover).toBe(true);
    const captioned = await mediaService.updateAttachment(res1.attachment.id, {
      caption: 'Updated cover caption',
    });
    expect(captioned.caption).toBe('Updated cover caption');

    // Delete remaining images -> displayMode resets to standard
    await mediaService.removeAttachment(res1.attachment.id);
    await mediaService.removeAttachment(res2.attachment.id);
    const refreshedCard = await storage.getCard(card.id);
    expect(refreshedCard?.displayMode).toBe('standard');
  });

  it('deduplicates identical CAS files across cards and respects refcount + retention during GC', async () => {
    const board = await boardService.createBoard({ title: 'CAS GC Board' });
    const cardA = await boardService.createCard({ boardId: board.id, title: 'Card A' });
    const cardB = await boardService.createCard({ boardId: board.id, title: 'Card B' });

    const sharedPng = await createSamplePng(120, 90, 42, 160, 99);
    const attA = (await mediaService.attachImageToCard({ cardId: cardA.id, bytes: sharedPng }))
      .attachment;
    const attB = (await mediaService.attachImageToCard({ cardId: cardB.id, bytes: sharedPng }))
      .attachment;

    expect(attA.sha256).toBe(attB.sha256);
    expect(attA.localUri).toBe(attB.localUri);

    const originalsDir = join(tempDir, 'media', 'originals');
    const thumbsDir = join(tempDir, 'media', 'thumbs');
    expect(readdirSync(originalsDir)).toHaveLength(1);
    expect(readdirSync(thumbsDir)).toHaveLength(1);

    // Soft-delete only 1 of the 2 attachments and advance clock beyond retention
    await mediaService.removeAttachment(attA.id);
    currentTime = '2026-12-15T10:00:00.000Z';

    const gcWhileReferenced = await mediaService.runMediaGarbageCollection(30);
    expect(gcWhileReferenced.deletedHashes).toEqual([]);
    expect(readdirSync(originalsDir)).toHaveLength(1);

    // Now delete the second reference at 2026-12-15
    await mediaService.removeAttachment(attB.id);

    // Immediately running GC (within 30-day window) must retain files
    const gcTooEarly = await mediaService.runMediaGarbageCollection(30);
    expect(gcTooEarly.deletedHashes).toEqual([]);
    expect(readdirSync(originalsDir)).toHaveLength(1);

    // Advance clock 31 days past latest deletion -> GC removes original & thumb
    currentTime = '2027-01-16T10:00:00.000Z';
    const gcEligible = await mediaService.runMediaGarbageCollection(30);
    expect(gcEligible.deletedHashes).toEqual([attA.sha256!]);
    expect(gcEligible.deletedFilesCount).toBe(2);
    expect(readdirSync(originalsDir)).toHaveLength(0);
    expect(readdirSync(thumbsDir)).toHaveLength(0);
  });

  it('also works cleanly with InMemoryStorageAdapter + InMemoryMediaStorageAdapter', async () => {
    const memStorage = new InMemoryStorageAdapter();
    await memStorage.initialize();
    const memBoardSvc = new BoardGraphService(memStorage);
    const memMediaStore = new InMemoryMediaStorageAdapter();
    const memMediaSvc = new MediaService(memStorage, memBoardSvc, memMediaStore);

    const board = await memBoardSvc.createBoard({ title: 'Mem Board' });
    const png = await createSamplePng(64, 48);
    const { card, attachment } = await memMediaSvc.createImageCard({
      boardId: board.id,
      title: 'Mem Image',
      bytes: png,
    });
    expect(card.displayMode).toBe('image_cover');
    expect(attachment.width).toBe(64);
    expect(attachment.height).toBe(48);
    expect(memMediaStore.getOriginalCount()).toBe(1);
    expect(memMediaStore.getThumbnailCount()).toBe(1);
  });
});
