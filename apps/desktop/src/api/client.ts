import type {
  Board,
  BoardConversionAnalysis,
  BoardConversionStrategy,
  BoardGraph,
  BoardType,
  Card,
  CardAttachment,
  CardDisplayMode,
  CardStatus,
  CardType,
  ConflictRecord,
  ConflictResolutionAction,
  Edge,
  EdgeDirection,
  EdgeStyleVariant,
  GraphEvent,
  ImageAttachmentResult,
  JsonExportResult,
  MarkdownExportResult,
  RelationType,
  SplitCardResult,
  SplitEdgeInheritance,
  SplitSubCardInput,
  SyncBoardResult,
  TimelineSortResult,
} from '@ariadeck/core';

export function buildMediaThumbUrl(attachmentId: string, baseUrl = ''): string {
  return `${baseUrl}/api/media/attachments/${encodeURIComponent(attachmentId)}/thumb`;
}

export function buildMediaOriginalUrl(attachmentId: string, baseUrl = ''): string {
  return `${baseUrl}/api/media/attachments/${encodeURIComponent(attachmentId)}/original`;
}

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
  createBoard(input: { title: string; description?: string; boardType?: BoardType }): Promise<Board>;
  updateBoard(boardId: string, patch: { title?: string; description?: string }): Promise<Board>;
  convertBoardType(
    boardId: string,
    input: { targetType: BoardType; dryRun?: boolean; strategy?: BoardConversionStrategy }
  ): Promise<{ board?: Board; analysis: BoardConversionAnalysis }>;
  deleteBoard(boardId: string): Promise<void>;
  getBoardGraph(boardId: string): Promise<BoardGraph>;
  createCard(input: {
    boardId: string;
    title: string;
    content?: string;
    cardType?: CardType;
    displayMode?: CardDisplayMode;
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
      displayMode?: CardDisplayMode;
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
  attachImageToCard(
    cardId: string,
    file: Blob,
    options?: {
      caption?: string;
      setAsCover?: boolean;
      displayMode?: CardDisplayMode;
    }
  ): Promise<ImageAttachmentResult>;
  createImageCard(input: {
    boardId: string;
    title: string;
    file: Blob;
    content?: string;
    caption?: string;
    cardType?: CardType;
    displayMode?: CardDisplayMode;
    posX?: number;
    posY?: number;
  }): Promise<ImageAttachmentResult>;
  updateAttachment(
    attachmentId: string,
    patch: {
      caption?: string | null;
      isCover?: boolean;
      sortOrder?: number;
    }
  ): Promise<CardAttachment>;
  reorderCardAttachments(cardId: string, attachmentIds: string[]): Promise<CardAttachment[]>;
  removeAttachment(attachmentId: string): Promise<void>;
  connectCards(input: {
    boardId: string;
    sourceCardId: string;
    targetCardId: string;
    relationType?: RelationType;
    direction?: EdgeDirection;
    label?: string;
    styleVariant?: EdgeStyleVariant;
    color?: string | null;
  }): Promise<Edge>;
  updateEdge(
    edgeId: string,
    patch: {
      relationType?: RelationType;
      direction?: EdgeDirection;
      label?: string | null;
      styleVariant?: EdgeStyleVariant;
      color?: string | null;
    }
  ): Promise<Edge>;
  disconnectCards(edgeId: string): Promise<void>;
  splitCard(
    cardId: string,
    input: {
      subCards: SplitSubCardInput[];
      linkMode?: 'sequential' | 'parallel';
      edgeInheritance?: SplitEdgeInheritance;
    }
  ): Promise<SplitCardResult>;
  computeTimelineLayout(boardId: string): Promise<TimelineSortResult>;
  exportBoardMarkdown(boardId: string, includeTranscripts?: boolean): Promise<MarkdownExportResult>;
  exportBoardJson(boardId: string): Promise<JsonExportResult>;
  importBoardJson(json: string, titleOverride?: string): Promise<BoardGraph>;
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
    convertBoardType: (boardId, input) =>
      request<{ board?: Board; analysis: BoardConversionAnalysis }>(
        `/api/boards/${boardId}/convert-type`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        }
      ),
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
    attachImageToCard: async (cardId, file, options = {}) => {
      const params = new URLSearchParams();
      if (options.caption !== undefined) params.set('caption', options.caption);
      if (options.setAsCover !== undefined) params.set('setAsCover', String(options.setAsCover));
      if (options.displayMode !== undefined) params.set('displayMode', options.displayMode);
      const qs = params.toString();
      const contentType =
        file.type === 'image/jpeg' || file.type === 'image/png'
          ? file.type
          : 'application/octet-stream';
      return request<ImageAttachmentResult>(
        `/api/cards/${encodeURIComponent(cardId)}/attachments/image${qs ? `?${qs}` : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: file,
        }
      );
    },
    createImageCard: async (input) => {
      const params = new URLSearchParams({
        boardId: input.boardId,
        title: input.title,
      });
      if (input.content !== undefined) params.set('content', input.content);
      if (input.caption !== undefined) params.set('caption', input.caption);
      if (input.cardType !== undefined) params.set('cardType', input.cardType);
      if (input.displayMode !== undefined) params.set('displayMode', input.displayMode);
      if (input.posX !== undefined) params.set('posX', String(Math.round(input.posX)));
      if (input.posY !== undefined) params.set('posY', String(Math.round(input.posY)));
      const contentType =
        input.file.type === 'image/jpeg' || input.file.type === 'image/png'
          ? input.file.type
          : 'application/octet-stream';
      return request<ImageAttachmentResult>(`/api/cards/image?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: input.file,
      });
    },
    updateAttachment: async (attachmentId, patch) => {
      const data = await request<{ attachment: CardAttachment }>(
        `/api/attachments/${encodeURIComponent(attachmentId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }
      );
      return data.attachment;
    },
    reorderCardAttachments: async (cardId, attachmentIds) => {
      const data = await request<{ attachments: CardAttachment[] }>(
        `/api/cards/${encodeURIComponent(cardId)}/attachments/reorder`,
        {
          method: 'PUT',
          body: JSON.stringify({ attachmentIds }),
        }
      );
      return data.attachments;
    },
    removeAttachment: async (attachmentId) => {
      await request<void>(`/api/attachments/${encodeURIComponent(attachmentId)}`, {
        method: 'DELETE',
      });
    },
    connectCards: async (input) => {
      const data = await request<{ edge: Edge }>('/api/edges', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return data.edge;
    },
    updateEdge: async (edgeId, patch) => {
      const data = await request<{ edge: Edge }>(`/api/edges/${edgeId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
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
    exportBoardJson: (boardId) =>
      request<JsonExportResult>(`/api/boards/${boardId}/export/json`),
    importBoardJson: async (json, titleOverride) => {
      const data = await request<{ graph: BoardGraph }>('/api/boards/import', {
        method: 'POST',
        body: JSON.stringify({
          json,
          ...(titleOverride !== undefined ? { titleOverride } : {}),
        }),
      });
      return data.graph;
    },
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
