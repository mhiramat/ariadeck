import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardGraphService } from '../service/BoardGraphService.js';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { CyclicDependencyError, ValidationError } from '../errors.js';
import {
  BOARD_JSON_FORMAT,
  BOARD_JSON_SCHEMA_VERSION,
  parseAndValidateBoardJson,
} from '../export/jsonExportImport.js';

describe.each([
  { name: 'InMemoryStorageAdapter', create: () => new InMemoryStorageAdapter() },
  { name: 'SqliteStorageAdapter', create: () => new SqliteStorageAdapter(':memory:') },
])('JSON Board Export & Import ($name)', ({ create }) => {
  let storage: StorageAdapter;
  let service: BoardGraphService;

  beforeEach(async () => {
    storage = create();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('round-trips a board via JSON export and import with fresh UUID remapping', async () => {
    const board = await service.createBoard({
      title: 'Momotaro Plot',
      description: 'Classic folklore structure',
    });
    const c1 = await service.createCard({
      boardId: board.id,
      title: 'Opening',
      content: '## Act 1\nPeach floats down the river.',
      cardType: 'plot_event',
      tags: ['act1'],
      posX: 80,
      posY: 80,
    });
    const c2 = await service.createCard({
      boardId: board.id,
      title: 'Climax',
      content: 'Battle on Onigashima.',
      cardType: 'plot_event',
      status: 'in_progress',
      posX: 420,
      posY: -120,
    });
    await service.connectCards(board.id, c1.id, c2.id, 'causes', 'leads to');
    await service.addAttachment({
      boardId: board.id,
      cardId: c1.id,
      kind: 'audio',
      localUri: 'media/note.m4a',
      mimeType: 'audio/mp4',
      fileSize: 512,
      durationMs: 2500,
      transcript: 'Foreshadow kibi dango.',
    });

    const exported = await service.exportBoardToJson(board.id);
    expect(exported.filename).toBe('ariadeck-momotaro-plot.json');
    expect(exported.payload.format).toBe(BOARD_JSON_FORMAT);
    expect(exported.payload.schemaVersion).toBe(BOARD_JSON_SCHEMA_VERSION);

    const imported = await service.importBoardFromJson(exported.json);

    // Must create a brand-new board with remapped UUIDs (no collision with original)
    expect(imported.board.id).not.toBe(board.id);
    expect(imported.board.title).toBe('Momotaro Plot');
    expect(imported.cards).toHaveLength(2);
    expect(imported.cards.every((c) => c.id !== c1.id && c.id !== c2.id)).toBe(true);

    const importedOpening = imported.cards.find((c) => c.title === 'Opening')!;
    const importedClimax = imported.cards.find((c) => c.title === 'Climax')!;
    expect(importedClimax.posX).toBe(420);
    expect(importedClimax.posY).toBe(-120);
    expect(importedOpening.tags).toEqual(['act1']);

    expect(imported.edges).toHaveLength(1);
    expect(imported.edges[0]?.sourceCardId).toBe(importedOpening.id);
    expect(imported.edges[0]?.targetCardId).toBe(importedClimax.id);
    expect(imported.edges[0]?.label).toBe('leads to');

    expect(imported.attachments).toHaveLength(1);
    expect(imported.attachments[0]?.cardId).toBe(importedOpening.id);
    expect(imported.attachments[0]?.transcript).toBe('Foreshadow kibi dango.');

    // Original board and imported board both exist cleanly
    expect(await service.listBoards()).toHaveLength(2);
  });

  it('rejects malformed JSON, wrong schemaVersion, dangling edge IDs, and cyclic DAGs', async () => {
    expect(() => parseAndValidateBoardJson('{ bad json')).toThrow(ValidationError);

    expect(() =>
      parseAndValidateBoardJson({
        format: 'wrong-format',
        schemaVersion: 99,
        board: { title: '' },
        cards: [],
        edges: [],
      })
    ).toThrow(ValidationError);

    expect(() =>
      parseAndValidateBoardJson({
        format: BOARD_JSON_FORMAT,
        schemaVersion: BOARD_JSON_SCHEMA_VERSION,
        board: { title: 'Dangling Edge' },
        cards: [{ id: 'a', title: 'Card A' }],
        edges: [{ sourceCardId: 'a', targetCardId: 'missing', relationType: 'blocks' }],
      })
    ).toThrow(/unknown card "missing"/);

    await expect(
      service.importBoardFromJson({
        format: BOARD_JSON_FORMAT,
        schemaVersion: BOARD_JSON_SCHEMA_VERSION,
        board: { title: 'Cyclic Board' },
        cards: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
        ],
        edges: [
          { sourceCardId: 'a', targetCardId: 'b', relationType: 'blocks' },
          { sourceCardId: 'b', targetCardId: 'a', relationType: 'causes' },
        ],
      })
    ).rejects.toThrow(CyclicDependencyError);

    // Failed import must not persist any partial board
    expect(await service.listBoards()).toHaveLength(0);
  });
});
