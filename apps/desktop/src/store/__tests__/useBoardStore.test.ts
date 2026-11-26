import { describe, it, expect, vi } from 'vitest';
import type { Board, BoardGraph, Card, Edge, GraphEvent } from '@ariadeck/core';
import type { AriadeckApiClient } from '../../api/client.ts';
import { createBoardStore } from '../useBoardStore.ts';

const NOW = '2026-01-01T00:00:00.000Z';

function makeBoard(id = 'board-1'): Board {
  return {
    id,
    title: 'Test Board',
    description: '',
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

function makeCard(id: string, title: string): Card {
  return {
    id,
    boardId: 'board-1',
    title,
    content: '',
    cardType: 'idea',
    status: 'todo',
    tags: [],
    posX: 100,
    posY: 100,
    timelineOrder: null,
    startAt: null,
    endAt: null,
    splitFromCardId: null,
    mergedFromCardIds: null,
    replacedByCardIds: null,
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

describe('useBoardStore', () => {
  it('initializes by loading boards and active board graph', async () => {
    const board = makeBoard();
    const graph: BoardGraph = {
      board,
      cards: [makeCard('c1', 'First Card')],
      edges: [],
      attachments: [],
    };

    const api = {
      listBoards: vi.fn().mockResolvedValue([board]),
      getBoardGraph: vi.fn().mockResolvedValue(graph),
    } as unknown as AriadeckApiClient;

    const store = createBoardStore(api);
    await store.getState().initialize();

    expect(store.getState().activeBoardId).toBe('board-1');
    expect(store.getState().graph?.cards).toHaveLength(1);
    expect(store.getState().connectionStatus).toBe('connected');
  });

  it('pushes an error toast when connectCards fails with a cycle error', async () => {
    const board = makeBoard();
    const graph: BoardGraph = {
      board,
      cards: [makeCard('c1', 'A'), makeCard('c2', 'B')],
      edges: [] as Edge[],
      attachments: [],
    };

    const api = {
      listBoards: vi.fn().mockResolvedValue([board]),
      getBoardGraph: vi.fn().mockResolvedValue(graph),
      connectCards: vi
        .fn()
        .mockRejectedValue(new Error('creating this dependency would introduce a cycle')),
    } as unknown as AriadeckApiClient;

    const store = createBoardStore(api);
    await store.getState().initialize();
    await store.getState().connectCards('c2', 'c1', 'blocks');

    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0]?.kind).toBe('error');
    expect(store.getState().toasts[0]?.message).toContain('cycle');
  });

  it('refreshes graph and displays an info toast when an MCP event arrives over SSE', async () => {
    const board = makeBoard();
    const graph: BoardGraph = { board, cards: [], edges: [], attachments: [] };
    let capturedOnEvent: ((event: GraphEvent) => void) | undefined;

    const api = {
      listBoards: vi.fn().mockResolvedValue([board]),
      getBoardGraph: vi.fn().mockResolvedValue(graph),
      subscribeEvents: vi.fn().mockImplementation((handlers: { onEvent: (e: GraphEvent) => void }) => {
        capturedOnEvent = handlers.onEvent;
        return vi.fn();
      }),
    } as unknown as AriadeckApiClient;

    const store = createBoardStore(api);
    await store.getState().initialize();
    const unsubscribe = store.getState().startEventStream();

    capturedOnEvent?.({
      type: 'card:split',
      boardId: 'board-1',
      entityIds: ['c1', 'c2'],
      deviceId: 'ariadeck-mcp-server',
      timestamp: NOW,
    });

    expect(store.getState().toasts.some((t) => t.kind === 'info' && t.message.includes('card:split'))).toBe(true);
    unsubscribe();
  });

  it('auto-authenticates using #token= URL fragment and strips it from location hash', async () => {
    const board = makeBoard();
    const graph: BoardGraph = { board, cards: [], edges: [], attachments: [] };

    window.history.replaceState(null, '', '/#token=fragment-secret-token');

    const api = {
      getAuthStatus: vi.fn().mockResolvedValue({ authRequired: true, authenticated: false }),
      login: vi.fn().mockResolvedValue({ authRequired: true, authenticated: true }),
      listBoards: vi.fn().mockResolvedValue([board]),
      getBoardGraph: vi.fn().mockResolvedValue(graph),
    } as unknown as AriadeckApiClient;

    const store = createBoardStore(api);
    await store.getState().initialize();

    expect(api.login).toHaveBeenCalledWith('fragment-secret-token');
    expect(window.location.hash).toBe('');
    expect(store.getState().authenticated).toBe(true);
    expect(store.getState().activeBoardId).toBe('board-1');
  });

  it('does not let a stale in-flight refresh overwrite a newly imported board graph', async () => {
    const emptyBoard = makeBoard('board-empty');
    const emptyGraph: BoardGraph = { board: emptyBoard, cards: [], edges: [], attachments: [] };

    const importedBoard = makeBoard('board-imported');
    importedBoard.title = 'Imported Roadmap';
    const importedGraph: BoardGraph = {
      board: importedBoard,
      cards: [makeCard('c1', 'Imported Task 1'), makeCard('c2', 'Imported Task 2')],
      edges: [],
      attachments: [],
    };

    let resolveStaleRefresh!: (g: BoardGraph) => void;
    const staleRefreshPromise = new Promise<BoardGraph>((resolve) => {
      resolveStaleRefresh = resolve;
    });

    let getGraphCalls = 0;
    const api = {
      listBoards: vi.fn().mockResolvedValue([emptyBoard, importedBoard]),
      getBoardGraph: vi.fn().mockImplementation((id: string) => {
        getGraphCalls += 1;
        if (id === 'board-empty' && getGraphCalls === 1) {
          return Promise.resolve(emptyGraph);
        }
        if (id === 'board-empty') {
          return staleRefreshPromise;
        }
        return Promise.resolve(importedGraph);
      }),
      importBoardJson: vi.fn().mockResolvedValue(importedGraph),
    } as unknown as AriadeckApiClient;

    const store = createBoardStore(api);
    await store.getState().initialize();
    expect(store.getState().activeBoardId).toBe('board-empty');

    // Simulate an SSE-triggered refreshActiveBoard for board-empty starting right before importJson
    const inFlightRefresh = store.getState().refreshActiveBoard();
    await store.getState().importJson('{"format":"ariadeck-board"}');

    // Now the stale refresh for board-empty resolves AFTER importJson completed
    resolveStaleRefresh(emptyGraph);
    await inFlightRefresh;

    // The newly imported board and its cards must remain active and intact
    expect(store.getState().activeBoardId).toBe('board-imported');
    expect(store.getState().graph?.board.id).toBe('board-imported');
    expect(store.getState().graph?.cards).toHaveLength(2);
  });

  it('falls back to another board when the active board is deleted externally', async () => {
    const board1 = makeBoard('board-1');
    const board2 = makeBoard('board-2');
    board2.title = 'Fallback Board';
    const graph1: BoardGraph = {
      board: board1,
      cards: [makeCard('c1', 'Card on Board 1')],
      edges: [],
      attachments: [],
    };
    const graph2: BoardGraph = {
      board: board2,
      cards: [],
      edges: [],
      attachments: [],
    };

    let board1Deleted = false;
    let capturedOnEvent: ((event: GraphEvent) => void) | undefined;

    const api = {
      listBoards: vi.fn().mockImplementation(() =>
        Promise.resolve(board1Deleted ? [board2] : [board1, board2])
      ),
      getBoardGraph: vi.fn().mockImplementation((id: string) => {
        if (id === 'board-1') return Promise.resolve(graph1);
        return Promise.resolve(graph2);
      }),
      subscribeEvents: vi
        .fn()
        .mockImplementation((handlers: { onEvent: (e: GraphEvent) => void }) => {
          capturedOnEvent = handlers.onEvent;
          return vi.fn();
        }),
    } as unknown as AriadeckApiClient;

    const store = createBoardStore(api);
    await store.getState().initialize();
    store.getState().selectCard('c1');
    store.getState().openLightbox('c1', 'att-1');
    const unsubscribe = store.getState().startEventStream();

    board1Deleted = true;
    capturedOnEvent?.({
      type: 'board:deleted',
      boardId: 'board-1',
      entityIds: ['board-1'],
      deviceId: 'ariadeck-mcp-server',
      timestamp: NOW,
    });

    await vi.waitFor(() => {
      expect(store.getState().activeBoardId).toBe('board-2');
    });
    expect(store.getState().graph?.board.id).toBe('board-2');
    expect(store.getState().selectedCardId).toBeNull();
    expect(store.getState().lightboxState).toBeNull();
    unsubscribe();
  });

  it('refreshes the active board when SSE reconnects after a disconnect', async () => {
    const board = makeBoard('board-1');
    const initialGraph: BoardGraph = { board, cards: [], edges: [], attachments: [] };
    const updatedGraph: BoardGraph = {
      board,
      cards: [makeCard('c-new', 'Added while offline')],
      edges: [],
      attachments: [],
    };

    let currentGraph = initialGraph;
    let handlersRef:
      | { onConnected?: () => void; onError?: () => void; onEvent: (e: GraphEvent) => void }
      | undefined;

    const api = {
      listBoards: vi.fn().mockResolvedValue([board]),
      getBoardGraph: vi.fn().mockImplementation(() => Promise.resolve(currentGraph)),
      subscribeEvents: vi.fn().mockImplementation((handlers) => {
        handlersRef = handlers;
        return vi.fn();
      }),
    } as unknown as AriadeckApiClient;

    const store = createBoardStore(api);
    expect(store.getState().authChecked).toBe(false);
    await store.getState().initialize();
    expect(store.getState().authChecked).toBe(true);

    const unsubscribe = store.getState().startEventStream();
    handlersRef?.onError?.();
    expect(store.getState().connectionStatus).toBe('disconnected');

    currentGraph = updatedGraph;
    handlersRef?.onConnected?.();

    await vi.waitFor(() => {
      expect(store.getState().graph?.cards).toHaveLength(1);
    });
    expect(store.getState().connectionStatus).toBe('connected');
    unsubscribe();
  });
});
