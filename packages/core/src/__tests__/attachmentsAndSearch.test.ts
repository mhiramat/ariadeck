import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardGraphService } from '../service/BoardGraphService.js';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';

describe.each([
  { name: 'InMemoryStorageAdapter', create: () => new InMemoryStorageAdapter() },
  { name: 'SqliteStorageAdapter', create: () => new SqliteStorageAdapter(':memory:') },
])('Attachments & Transcript-Aware Search ($name)', ({ create }) => {
  let storage: StorageAdapter;
  let service: BoardGraphService;

  beforeEach(async () => {
    storage = create();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-android-test' });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('adds, updates transcript, searches by transcript, and soft-deletes attachments', async () => {
    const board = await service.createBoard({ title: 'Field Notes' });
    const card1 = await service.createCard({
      boardId: board.id,
      title: 'Location Scout',
      content: 'Visit the harbor.',
    });
    const card2 = await service.createCard({
      boardId: board.id,
      title: 'Character Bio',
      content: 'Detective background.',
    });

    const audio = await service.addAttachment({
      boardId: board.id,
      cardId: card1.id,
      kind: 'audio',
      localUri: 'media/memo-1.m4a',
      mimeType: 'audio/mp4',
      fileSize: 8192,
      durationMs: 6500,
      transcript: 'Foghorn echoes across the pier at dusk.',
    });

    expect(audio.version).toBe(1);
    expect(audio.syncStatus).toBe('local_only');

    // Search matching attachment transcript must return card1
    const matches = await service.searchCards(board.id, 'foghorn');
    expect(matches.map((c) => c.id)).toEqual([card1.id]);

    // Update transcript
    const updated = await service.updateAttachmentTranscript(
      audio.id,
      'Lighthouse beacon flashes twice.'
    );
    expect(updated.version).toBe(2);
    expect((await service.searchCards(board.id, 'lighthouse')).map((c) => c.id)).toEqual([
      card1.id,
    ]);
    expect(await service.searchCards(board.id, 'detective')).toEqual([card2]);

    // Soft-delete attachment
    await service.deleteAttachment(audio.id);
    const graph = await service.getBoardGraph(board.id);
    expect(graph.attachments).toHaveLength(0);
    expect(await service.searchCards(board.id, 'lighthouse')).toEqual([]);
  });
});
