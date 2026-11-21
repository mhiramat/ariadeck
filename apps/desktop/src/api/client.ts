import type {
  Board,
  BoardGraph,
  Card,
  CardStatus,
  CardType,
  ConflictRecord,
  ConflictResolutionAction,
  Edge,
  GraphEvent,
  MarkdownExportResult,
  RelationType,
  SplitCardResult,
  SplitSubCardInput,
  SyncBoardResult,
  TimelineSortResult,
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

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export interface AriadeckApiClient {
  checkHealth(): Promise<{ status: string; service: string; version: string }>;
  getAuthStatus(): Promise<AuthStatus>;
  login(token: string): Promise<AuthStatus>;
  logout(): Promise<AuthStatus>;
  listBoards(): Promise<Board[]>;
  createBoard(input: { title: string; description?: string }): Promise<Board>;
  updateBoard(boardId: string, patch: { title?: string; description?: string }): Promise<Board>;
  deleteBoard(boardId: string): Promise<void>;
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
      timelineOrder?: number | null;
      startAt?: string | null;
      endAt?: string | null;
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
  computeTimelineLayout(boardId: string): Promise<TimelineSortResult>;
  exportBoardMarkdown(boardId: string, includeTranscripts?: boolean): Promise<MarkdownExportResult>;
  listConflicts(boardId: string): Promise<{ conflicts: ConflictRecord[]; syncConfigured: boolean }>;
  resolveConflict(
    boardId: string,
    conflictId: string,
    action: ConflictResolutionAction
  ): Promise<ConflictRecord>;
  syncBoard(boardId: string): Promise<SyncBoardResult>;
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
      credentials: 'include',
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
    getAuthStatus: () => request<AuthStatus>('/api/auth/status'),
    login: (token) =>
      request<AuthStatus>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    logout: () =>
      request<AuthStatus>('/api/auth/logout', {
        method: 'POST',
      }),
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
    updateBoard: async (boardId, patch) => {
      const data = await request<{ board: Board }>(`/api/boards/${boardId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      return data.board;
    },
    deleteBoard: async (boardId) => {
      await request<void>(`/api/boards/${boardId}`, { method: 'DELETE' });
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
    computeTimelineLayout: (boardId) =>
      request<TimelineSortResult>(`/api/boards/${boardId}/timeline/compute`, {
        method: 'POST',
      }),
    exportBoardMarkdown: (boardId, includeTranscripts = true) =>
      request<MarkdownExportResult>(
        `/api/boards/${boardId}/export/markdown?includeTranscripts=${String(includeTranscripts)}`
      ),
    listConflicts: (boardId) =>
      request<{ conflicts: ConflictRecord[]; syncConfigured: boolean }>(
        `/api/boards/${boardId}/conflicts`
      ),
    resolveConflict: async (boardId, conflictId, action) => {
      const data = await request<{ conflict: ConflictRecord }>(
        `/api/boards/${boardId}/conflicts/${conflictId}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify(action),
        }
      );
      return data.conflict;
    },
    syncBoard: (boardId) =>
      request<SyncBoardResult>(`/api/boards/${boardId}/sync`, {
        method: 'POST',
      }),
    subscribeEvents: ({ onConnected, onEvent, onError }) => {
      if (typeof EventSource === 'undefined') {
        return () => undefined;
      }
      const source = new EventSource(`${baseUrl}/api/events`, {
        withCredentials: true,
      });
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
