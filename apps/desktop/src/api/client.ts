import type {
  Board,
  BoardGraph,
  Card,
  CardStatus,
  CardType,
  Edge,
  GraphEvent,
  RelationType,
  SplitCardResult,
  SplitSubCardInput,
} from '@ariadeck/core';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface AriadeckApiClient {
  checkHealth(): Promise<{ status: string; service: string; version: string }>;
  listBoards(): Promise<Board[]>;
  createBoard(input: { title: string; description?: string }): Promise<Board>;
  getBoardGraph(boardId: string): Promise<BoardGraph>;
  createCard(input: {
    boardId: string;
    title: string;
    content?: string;
    cardType?: CardType;
    status?: CardStatus;
    tags?: string[];
    posX?: number;
    posY?: number;
  }): Promise<Card>;
  updateCard(
    cardId: string,
    patch: {
      title?: string;
      content?: string;
      cardType?: CardType;
      status?: CardStatus;
      tags?: string[];
      posX?: number;
      posY?: number;
    }
  ): Promise<Card>;
  deleteCard(cardId: string): Promise<void>;
  connectCards(input: {
    boardId: string;
    sourceCardId: string;
    targetCardId: string;
    relationType?: RelationType;
    label?: string;
  }): Promise<Edge>;
  disconnectCards(edgeId: string): Promise<void>;
  splitCard(
    cardId: string,
    input: { subCards: SplitSubCardInput[]; linkMode: 'sequential' | 'parallel' }
  ): Promise<SplitCardResult>;
  subscribeEvents(handlers: {
    onConnected?: () => void;
    onEvent: (event: GraphEvent) => void;
    onError?: () => void;
  }): () => void;
}

const DESKTOP_DEVICE_ID = 'ariadeck-desktop-web';

export function createAriadeckApiClient(baseUrl = ''): AriadeckApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-ariadeck-device-id': DESKTOP_DEVICE_ID,
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      let code = 'HTTP_ERROR';
      let message = `Request failed with status ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body.error?.code) code = body.error.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Ignore JSON parsing failure for non-JSON error responses.
      }
      throw new ApiError(res.status, code, message);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  return {
    checkHealth: () => request('/api/health'),
    listBoards: async () => {
      const data = await request<{ boards: Board[] }>('/api/boards');
      return data.boards;
    },
    createBoard: async (input) => {
      const data = await request<{ board: Board }>('/api/boards', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return data.board;
    },
    getBoardGraph: (boardId) => request<BoardGraph>(`/api/boards/${boardId}/graph`),
    createCard: async (input) => {
      const data = await request<{ card: Card }>('/api/cards', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return data.card;
    },
    updateCard: async (cardId, patch) => {
      const data = await request<{ card: Card }>(`/api/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      return data.card;
    },
    deleteCard: async (cardId) => {
      await request<void>(`/api/cards/${cardId}`, { method: 'DELETE' });
    },
    connectCards: async (input) => {
      const data = await request<{ edge: Edge }>('/api/edges', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return data.edge;
    },
    disconnectCards: async (edgeId) => {
      await request<void>(`/api/edges/${edgeId}`, { method: 'DELETE' });
    },
    splitCard: (cardId, input) =>
      request<SplitCardResult>(`/api/cards/${cardId}/split`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    subscribeEvents: ({ onConnected, onEvent, onError }) => {
      if (typeof EventSource === 'undefined') {
        return () => undefined;
      }
      const source = new EventSource(`${baseUrl}/api/events`);
      source.addEventListener('connected', () => {
        onConnected?.();
      });
      source.addEventListener('graph', (evt) => {
        try {
          const parsed = JSON.parse((evt as MessageEvent<string>).data) as GraphEvent;
          onEvent(parsed);
        } catch {
          // Ignore malformed event payloads.
        }
      });
      source.onerror = () => {
        onError?.();
      };
      return () => {
        source.close();
      };
    },
  };
}
