import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BoardConversionError,
  BoardGraphService,
  BoardSyncEngine,
  CyclicDependencyError,
  InMemoryRemoteSyncAdapter,
  InMemoryStorageAdapter,
  ValidationError,
  canonicalizeEdgeEndpoints,
} from '../index.js';
import type { BoardSyncSnapshot } from '../sync/RemoteSyncAdapter.js';
import { SqliteStorageAdapter } from '../storage/SqliteStorageAdapter.js';

describe('Phase 2: Flow/Flat boards, jump_back edges, timeline warnings, and v1->v2 migration', () => {
  it('migrates a legacy Phase 1 SQLite database to schema v2 idempotently', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ariadeck-p2-mig-'));
    const dbPath = join(tempDir, 'legacy.db');
    try {
      // Seed a Phase 1 SQLite database without board_type, direction, style_variant, or color
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE boards (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
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
          label TEXT,
          is_conflicted INTEGER NOT NULL DEFAULT 0,
          conflict_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by_device_id TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TEXT
        );
        INSERT INTO boards VALUES ('b1', 'Legacy Board', 'Desc', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'dev1', 1, NULL);
        INSERT INTO cards VALUES ('c1', 'b1', 'A', '', 'task', 'todo', '[]', 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'dev1', 1, NULL);
        INSERT INTO cards VALUES ('c2', 'b1', 'B', '', 'task', 'todo', '[]', 100, 0, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'dev1', 1, NULL);
        INSERT INTO edges VALUES ('e1', 'b1', 'c1', 'c2', 'blocks', 'prereq', 0, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'dev1', 1, NULL);
      `);
      legacy.close();

      const adapter = new SqliteStorageAdapter(dbPath);
      await adapter.initialize();
      // Calling initialize() again (or reopening) must be completely idempotent
      await adapter.close();
      await adapter.initialize();

      const service = new BoardGraphService(adapter);
      const board = await service.getBoard('b1');
      expect(board.boardType).toBe('flow');

      const graph = await service.getBoardGraph('b1');
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]?.direction).toBe('directed');
      expect(graph.edges[0]?.styleVariant).toBe('solid');
      expect(graph.edges[0]?.label).toBe('prereq');

      // Can now add a jump_back edge returning from c2 -> c1 on the migrated DB
      const loopEdge = await service.connectCards('b1', 'c2', 'c1', 'jump_back', {
        label: 'Retry',
      });
      expect(loopEdge.relationType).toBe('jump_back');
      expect(loopEdge.styleVariant).toBe('dashed');

      await adapter.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows jump_back loops on flow boards, rejects temporal cycles, and emits forward warnings', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    const service = new BoardGraphService(storage);

    const board = await service.createBoard({ title: 'Chapter 3', boardType: 'flow' });
    const a = await service.createCard({ boardId: board.id, title: 'Enter Vault' });
    const b = await service.createCard({ boardId: board.id, title: 'Pick Lock' });
    const c = await service.createCard({ boardId: board.id, title: 'Trap Triggered' });

    await service.connectCards(board.id, a.id, b.id, 'causes');
    await service.connectCards(board.id, b.id, c.id, 'causes');

    // Backward temporal edge C -blocks-> A must be rejected with ERR_TEMPORAL_CYCLE_DETECTED
    await expect(service.connectCards(board.id, c.id, a.id, 'blocks')).rejects.toThrow(
      CyclicDependencyError
    );

    // Symmetric or custom edges are rejected on flow boards
    await expect(
      service.connectCards(board.id, a.id, c.id, 'relates_to', { direction: 'undirected' })
    ).rejects.toThrow(ValidationError);

    // Jump-back edge C -> A and self-loop C -> C are allowed
    const backLoop = await service.connectCards(board.id, c.id, a.id, 'jump_back', {
      label: 'Reset vault',
    });
    const selfLoop = await service.connectCards(board.id, c.id, c.id, 'jump_back', {
      label: 'Retry trap',
    });
    expect(backLoop.styleVariant).toBe('dashed');
    expect(selfLoop.sourceCardId).toBe(c.id);
    expect(selfLoop.targetCardId).toBe(c.id);

    const timeline = await service.computeTimelineLayout(board.id);
    expect(timeline.hasTemporalCycle).toBe(false);
    expect(timeline.jumpBackEdges).toHaveLength(2);
    expect(timeline.warnings).toHaveLength(0);

    // Adding a forward-pointing jump_back A -> C emits JUMP_BACK_POINTS_FORWARD warning
    await service.connectCards(board.id, a.id, c.id, 'jump_back', { label: 'Misdirected' });
    const timelineWithWarn = await service.computeTimelineLayout(board.id);
    expect(timelineWithWarn.warnings).toHaveLength(1);
    expect(timelineWithWarn.warnings[0]?.code).toBe('JUMP_BACK_POINTS_FORWARD');
  });

  it('supports cycles, symmetric canonicalization, and split/merge on flat boards', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    const service = new BoardGraphService(storage);

    const board = await service.createBoard({
      title: 'Character Relationship Map',
      boardType: 'flat',
    });
    const a = await service.createCard({ boardId: board.id, title: 'Alice' });
    const b = await service.createCard({ boardId: board.id, title: 'Bob' });
    const c = await service.createCard({ boardId: board.id, title: 'Carol' });

    // Cycles are explicitly allowed on flat boards
    await service.connectCards(board.id, a.id, b.id, 'causes', { label: 'mentors' });
    await service.connectCards(board.id, b.id, c.id, 'causes', { label: 'recruits' });
    await service.connectCards(board.id, c.id, a.id, 'causes', { label: 'inspires' });

    // Symmetric edges canonicalize endpoints so (A, B) and (B, A) deduplicate
    const expected = canonicalizeEdgeEndpoints(a.id, b.id, 'bidirectional');
    const rival1 = await service.connectCards(board.id, b.id, a.id, 'custom', {
      direction: 'bidirectional',
      label: 'Rivalry',
      color: '#f43f5e',
    });
    const rival2 = await service.connectCards(board.id, a.id, b.id, 'custom', {
      direction: 'bidirectional',
      label: 'Rivalry',
    });
    expect(rival1.id).toBe(rival2.id);
    expect(rival1.sourceCardId).toBe(expected.sourceCardId);
    expect(rival1.targetCardId).toBe(expected.targetCardId);

    // Undirected edge works; jump_back is rejected on flat boards
    const bond = await service.connectCards(board.id, b.id, c.id, 'relates_to', {
      direction: 'undirected',
      styleVariant: 'dotted',
      label: 'Siblings',
    });
    expect(bond.direction).toBe('undirected');
    await expect(service.connectCards(board.id, c.id, a.id, 'jump_back')).rejects.toThrow(
      ValidationError
    );

    // Timeline computation is rejected on flat boards
    await expect(service.computeTimelineLayout(board.id)).rejects.toThrow(ValidationError);

    // Split on flat board defaults to 'broadcast' (no forced sequential chain)
    const splitRes = await service.splitCard({
      targetCardId: c.id,
      subCards: [
        { title: 'Carol (Past)', content: '' },
        { title: 'Carol (Present)', content: '' },
      ],
    });
    expect(splitRes.createdCards).toHaveLength(2);
    const hasChildChain = splitRes.createdEdges.some(
      (e) =>
        e.sourceCardId === splitRes.createdCards[0]!.id &&
        e.targetCardId === splitRes.createdCards[1]!.id
    );
    expect(hasChildChain).toBe(false);
  });

  it('analyzes and converts between flat and flow boards safely', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    const service = new BoardGraphService(storage);

    const board = await service.createBoard({ title: 'Network', boardType: 'flat' });
    const a = await service.createCard({ boardId: board.id, title: 'A' });
    const b = await service.createCard({ boardId: board.id, title: 'B' });

    await service.connectCards(board.id, a.id, b.id, 'blocks');
    await service.connectCards(board.id, b.id, a.id, 'blocks');
    await service.connectCards(board.id, a.id, b.id, 'custom', {
      direction: 'undirected',
      label: 'Shared module',
    });

    const analysis = await service.analyzeBoardTypeConversion(board.id, 'flow');
    expect(analysis.canConvertCleanly).toBe(false);
    expect(analysis.symmetricEdgeIds).toHaveLength(1);
    expect(analysis.customRelationEdgeIds).toHaveLength(1);
    expect(analysis.cycleEdgeIds).toHaveLength(1);

    // strategy='abort' throws BoardConversionError
    await expect(service.convertBoardType(board.id, 'flow', 'abort')).rejects.toThrow(
      BoardConversionError
    );

    // strategy='demote_incompatible' succeeds and makes timeline computation valid
    const converted = await service.convertBoardType(board.id, 'flow', 'demote_incompatible');
    expect(converted.board.boardType).toBe('flow');

    const graphAfter = await service.getBoardGraph(board.id);
    expect(graphAfter.edges.some((e) => e.relationType === 'jump_back')).toBe(true);
    expect(graphAfter.edges.every((e) => e.direction === 'directed')).toBe(true);
    expect(graphAfter.edges.some((e) => e.relationType === 'custom')).toBe(false);

    const timeline = await service.computeTimelineLayout(board.id);
    expect(timeline.hasTemporalCycle).toBe(false);

    // Converting flow -> flat converts jump_back edges to dashed relates_to
    const backToFlat = await service.convertBoardType(board.id, 'flat');
    expect(backToFlat.board.boardType).toBe('flat');
    const flatGraph = await service.getBoardGraph(board.id);
    expect(flatGraph.edges.some((e) => e.relationType === 'jump_back')).toBe(false);
    expect(
      flatGraph.edges.some(
        (e) => e.relationType === 'relates_to' && e.styleVariant === 'dashed'
      )
    ).toBe(true);
  });

  it('deduplicates canonical symmetric edges and skips cycle conflicts on flat boards during sync', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    const service = new BoardGraphService(storage, { deviceId: 'dev-local' });

    const board = await service.createBoard({ title: 'Flat Sync', boardType: 'flat' });
    const a = await service.createCard({ boardId: board.id, title: 'Node A' });
    const b = await service.createCard({ boardId: board.id, title: 'Node B' });

    await service.connectCards(board.id, a.id, b.id, 'blocks');
    await service.connectCards(board.id, b.id, a.id, 'blocks');
    await service.connectCards(board.id, a.id, b.id, 'relates_to', {
      direction: 'undirected',
      label: 'Peer',
    });

    const localGraph = await service.getBoardGraph(board.id);
    const remoteSnapshot: BoardSyncSnapshot = {
      schemaVersion: 1,
      board: localGraph.board,
      cards: localGraph.cards,
      edges: [
        {
          id: 'remote-dup-sym',
          boardId: board.id,
          sourceCardId: b.id,
          targetCardId: a.id,
          relationType: 'relates_to',
          direction: 'undirected',
          label: 'Peer',
          styleVariant: 'solid',
          color: null,
          isConflicted: false,
          conflictReason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          updatedByDeviceId: 'dev-remote',
          version: 1,
          deletedAt: null,
        },
      ],
      attachments: [],
      exportedAt: '2026-01-01T00:00:00.000Z',
      deviceId: 'dev-remote',
    };

    const remoteAdapter = new InMemoryRemoteSyncAdapter();
    await remoteAdapter.uploadBoardSnapshot(remoteSnapshot);

    const syncEngine = new BoardSyncEngine(storage, remoteAdapter, { deviceId: 'dev-local' });
    const result = await syncEngine.syncBoard(board.id);
    expect(result.flaggedCyclicEdgeIds).toHaveLength(0);

    const syncedGraph = await service.getBoardGraph(board.id);
    const undirectedEdges = syncedGraph.edges.filter((e) => e.direction === 'undirected');
    expect(undirectedEdges).toHaveLength(1);
  });
});
