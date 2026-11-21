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
});
