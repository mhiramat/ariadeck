import { describe, it, expect, vi } from 'vitest';
import { BoardGraphService } from '../service/BoardGraphService.js';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { InMemoryRemoteSyncAdapter } from '../sync/RemoteSyncAdapter.js';
import { GoogleDriveSyncAdapter } from '../sync/GoogleDriveSyncAdapter.js';
import { BoardSyncEngine } from '../sync/BoardSyncEngine.js';

async function createDevicePair() {
  const remote = new InMemoryRemoteSyncAdapter();

  const storageA = new InMemoryStorageAdapter();
  const storageB = new InMemoryStorageAdapter();
  await storageA.initialize();
  await storageB.initialize();

  let clockA = '2026-06-01T10:00:00.000Z';
  let clockB = '2026-06-01T10:00:00.000Z';

  const serviceA = new BoardGraphService(storageA, {
    deviceId: 'ariadeck-desktop-a',
    now: () => clockA,
  });
  const serviceB = new BoardGraphService(storageB, {
    deviceId: 'ariadeck-android-b',
    now: () => clockB,
  });

  const syncA = new BoardSyncEngine(storageA, remote, {
    deviceId: 'ariadeck-desktop-a',
    eventBus: serviceA.eventBus,
    now: () => clockA,
  });
  const syncB = new BoardSyncEngine(storageB, remote, {
    deviceId: 'ariadeck-android-b',
    eventBus: serviceB.eventBus,
    now: () => clockB,
  });

  return {
    remote,
    storageA,
    storageB,
    serviceA,
    serviceB,
    syncA,
    syncB,
    setClockA: (t: string) => {
      clockA = t;
    },
    setClockB: (t: string) => {
      clockB = t;
    },
  };
}

describe('BoardSyncEngine (5 Core Conflict Resolution Rules)', () => {
  it('Rule 1: applies LWW and logs content_collision when both devices edit card text offline', async () => {
    const env = await createDevicePair();
    const board = await env.serviceA.createBoard({ title: 'Shared Board' });
    const card = await env.serviceA.createCard({
      boardId: board.id,
      title: 'Initial Title',
      content: 'Initial body',
    });

    // Initial sync so both devices start from the same baseline
    await env.syncA.syncBoard(board.id);
    await env.syncB.syncBoard(board.id);

    // Offline concurrent edits
    env.setClockA('2026-06-01T11:00:00.000Z');
    await env.serviceA.updateCard(card.id, { content: 'Desktop draft' });

    env.setClockB('2026-06-01T11:05:00.000Z');
    await env.serviceB.updateCard(card.id, { content: 'Android draft (newer)' });

    // Device B syncs first, then Device A syncs
    await env.syncB.syncBoard(board.id);
    const resultA = await env.syncA.syncBoard(board.id);

    expect(resultA.newConflicts).toHaveLength(1);
    expect(resultA.newConflicts[0]?.conflictType).toBe('content_collision');

    // LWW winner is Device B (newer timestamp)
    const graphA = await env.serviceA.getBoardGraph(board.id);
    expect(graphA.cards[0]?.content).toBe('Android draft (newer)');

    // User resolves conflict with custom merge
    await env.syncA.resolveConflict(board.id, resultA.newConflicts[0]!.id, {
      strategy: 'custom_merge',
      title: 'Merged Title',
      content: 'Desktop draft + Android draft',
    });

    expect(await env.syncA.listConflicts(board.id)).toHaveLength(0);
    const resolvedGraph = await env.serviceA.getBoardGraph(board.id);
    expect(resolvedGraph.cards[0]?.content).toBe('Desktop draft + Android draft');
  });

  it('Rule 2: re-routes remote edges via split lineage and logs deleted_target_edit', async () => {
    const env = await createDevicePair();
    const board = await env.serviceA.createBoard({ title: 'Lineage Sync' });
    const upstream = await env.serviceA.createCard({ boardId: board.id, title: 'Upstream' });
    const target = await env.serviceA.createCard({ boardId: board.id, title: 'Big Card' });

    await env.syncA.syncBoard(board.id);
    await env.syncB.syncBoard(board.id);

    // Device A splits target into [Sub 1 -> Sub 2]
    env.setClockA('2026-06-01T12:00:00.000Z');
    const splitResult = await env.serviceA.splitCard({
      targetCardId: target.id,
      linkMode: 'sequential',
      subCards: [
        { title: 'Sub 1', content: 'First' },
        { title: 'Sub 2', content: 'Second' },
      ],
    });
    await env.syncA.syncBoard(board.id);

    // Device B offline adds an edge Upstream -> target AND edits target's content
    env.setClockB('2026-06-01T12:02:00.000Z');
    await env.serviceB.connectCards(board.id, upstream.id, target.id, 'blocks');
    await env.serviceB.updateCard(target.id, { content: 'Important offline note' });

    const resultB = await env.syncB.syncBoard(board.id);

    // Incoming edge to split parent must re-route to Sub 1 (replacedByCardIds[0])
    expect(resultB.reroutedEdgeIds).toHaveLength(1);
    expect(resultB.newConflicts.some((c) => c.conflictType === 'deleted_target_edit')).toBe(true);

    const graphB = await env.serviceB.getBoardGraph(board.id);
    const sub1Id = splitResult.createdCards[0]!.id;
    expect(
      graphB.edges.some((e) => e.sourceCardId === upstream.id && e.targetCardId === sub1Id)
    ).toBe(true);
  });

  it('Rule 3: detects post-merge DAG cycles and flags the newer edge as cyclic_edge', async () => {
    const env = await createDevicePair();
    const board = await env.serviceA.createBoard({ title: 'Cycle Sync' });
    const x = await env.serviceA.createCard({ boardId: board.id, title: 'Card X' });
    const y = await env.serviceA.createCard({ boardId: board.id, title: 'Card Y' });

    await env.syncA.syncBoard(board.id);
    await env.syncB.syncBoard(board.id);

    // Offline Device A connects X -> Y at 12:00; Device B connects Y -> X at 12:05
    env.setClockA('2026-06-01T12:00:00.000Z');
    await env.serviceA.connectCards(board.id, x.id, y.id, 'blocks');
    await env.syncA.syncBoard(board.id);

    env.setClockB('2026-06-01T12:05:00.000Z');
    const edgeYX = await env.serviceB.connectCards(board.id, y.id, x.id, 'blocks');
    const resultB = await env.syncB.syncBoard(board.id);

    expect(resultB.flaggedCyclicEdgeIds).toEqual([edgeYX.id]);
    expect(resultB.newConflicts).toHaveLength(1);
    expect(resultB.newConflicts[0]?.conflictType).toBe('cyclic_edge');

    const graphB = await env.serviceB.getBoardGraph(board.id);
    const conflictedEdge = graphB.edges.find((e) => e.id === edgeYX.id);
    expect(conflictedEdge?.isConflicted).toBe(true);
    expect(conflictedEdge?.conflictReason).toBe('cyclic_dependency');

    // Resolve by deleting the conflicted edge
    await env.syncB.resolveConflict(board.id, resultB.newConflicts[0]!.id, {
      strategy: 'delete_edge',
    });
    const resolvedGraph = await env.serviceB.getBoardGraph(board.id);
    expect(resolvedGraph.edges.some((e) => e.id === edgeYX.id)).toBe(false);
  });

  it('Rule 4 & Rule 5: cleans up edges to deleted cards and syncs attachment transcripts immediately', async () => {
    const env = await createDevicePair();
    const board = await env.serviceA.createBoard({ title: 'Tombstone & Media' });
    const c1 = await env.serviceA.createCard({ boardId: board.id, title: 'Keep Me' });
    const c2 = await env.serviceA.createCard({ boardId: board.id, title: 'Delete Me' });

    await env.storageA.saveAttachment({
      id: 'att-1',
      cardId: c1.id,
      boardId: board.id,
      kind: 'audio',
      localUri: 'media/memo.m4a',
      remoteFileId: null,
      mimeType: 'audio/mp4',
      fileSize: 4096,
      durationMs: 3000,
      transcript: 'Voice memo synced before binary upload',
      syncStatus: 'local_only',
      createdAt: c1.createdAt,
      updatedAt: c1.updatedAt,
      updatedByDeviceId: 'ariadeck-desktop-a',
      version: 1,
      deletedAt: null,
    });

    await env.syncA.syncBoard(board.id);
    await env.syncB.syncBoard(board.id);

    // Verify transcript synced immediately even though syncStatus is local_only
    const graphB1 = await env.serviceB.getBoardGraph(board.id);
    expect(graphB1.attachments).toHaveLength(1);
    expect(graphB1.attachments[0]?.transcript).toBe('Voice memo synced before binary upload');

    // Device A deletes c2; Device B offline connects c1 -> c2
    env.setClockA('2026-06-01T13:00:00.000Z');
    await env.serviceA.deleteCard(c2.id);
    await env.syncA.syncBoard(board.id);

    env.setClockB('2026-06-01T13:01:00.000Z');
    await env.serviceB.connectCards(board.id, c1.id, c2.id, 'blocks');
    await env.syncB.syncBoard(board.id);

    // Edge referencing deleted c2 must be soft-deleted
    const graphB2 = await env.serviceB.getBoardGraph(board.id);
    expect(graphB2.cards.map((c) => c.id)).toEqual([c1.id]);
    expect(graphB2.edges).toHaveLength(0);
  });
});

describe('GoogleDriveSyncAdapter', () => {
  it('ensures Ariadeck/boards folder layout and uploads/fetches snapshots via Drive REST v3', async () => {
    const files = new Map<string, string>();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/drive/v3/files?q=')) {
        if (url.includes('board_b1.json') && files.has('file-b1')) {
          return new Response(
            JSON.stringify({ files: [{ id: 'file-b1', name: 'board_b1.json' }] }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
        const body = String(init?.body ?? '');
        const jsonPart = body.split('\r\n\r\n')[2]?.split('\r\n--')[0] ?? '{}';
        files.set('file-b1', jsonPart);
        return new Response(JSON.stringify({ id: 'file-b1' }), { status: 200 });
      }
      if (url.includes('/drive/v3/files/file-b1?alt=media')) {
        return new Response(files.get('file-b1') ?? '{}', { status: 200 });
      }
      return new Response(JSON.stringify({ id: `folder-${Math.random()}` }), { status: 200 });
    });

    const adapter = new GoogleDriveSyncAdapter({
      getAccessToken: async () => 'mock-oauth-token',
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const snapshot = {
      schemaVersion: 1 as const,
      board: {
        id: 'b1',
        title: 'Drive Board',
        description: '',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        updatedByDeviceId: 'ariadeck-test',
        version: 1,
        deletedAt: null,
      },
      cards: [],
      edges: [],
      attachments: [],
      exportedAt: '2026-06-01T00:00:00.000Z',
      deviceId: 'ariadeck-test',
    };

    await adapter.uploadBoardSnapshot(snapshot);
    const fetched = await adapter.fetchBoardSnapshot('b1');
    expect(fetched?.board.title).toBe('Drive Board');
  });
});
