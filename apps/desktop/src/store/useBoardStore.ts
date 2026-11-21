import { create } from 'zustand';
import type {
  Board,
  BoardGraph,
  Card,
  CardStatus,
  CardType,
  ConflictRecord,
  ConflictResolutionAction,
  GraphEvent,
  JsonExportResult,
  MarkdownExportResult,
  RelationType,
  SplitSubCardInput,
} from '@ariadeck/core';
import { createAriadeckApiClient, type AriadeckApiClient } from '../api/client.ts';

export type DesktopViewMode = 'graph' | 'timeline';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ToastNotification {
  id: string;
  kind: 'info' | 'error' | 'success';
  message: string;
}

export interface BoardStoreState {
  boards: Board[];
  activeBoardId: string | null;
  graph: BoardGraph | null;
  selectedCardId: string | null;
  boardListOpen: boolean;
  conflictModalOpen: boolean;
  conflicts: ConflictRecord[];
  syncConfigured: boolean;
  syncing: boolean;
  authRequired: boolean;
  authenticated: boolean;
  authError: string | null;
  viewMode: DesktopViewMode;
  connectionStatus: ConnectionStatus;
  loading: boolean;
  toasts: ToastNotification[];

  initialize: () => Promise<void>;
  login: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  selectBoard: (boardId: string) => Promise<void>;
  createBoard: (title: string, description?: string) => Promise<Board | null>;
  updateBoard: (
    boardId: string,
    patch: { title?: string; description?: string }
  ) => Promise<Board | null>;
  deleteBoard: (boardId: string) => Promise<void>;
  refreshActiveBoard: () => Promise<void>;

  toggleBoardList: () => void;
  setBoardListOpen: (open: boolean) => void;
  selectCard: (cardId: string | null) => void;
  setViewMode: (mode: DesktopViewMode) => void;

  createCard: (input: {
    title: string;
    content?: string;
    cardType?: CardType;
    posX?: number;
    posY?: number;
  }) => Promise<Card | null>;
  updateCard: (
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
  ) => Promise<void>;
  deleteCard: (cardId: string) => Promise<void>;
  connectCards: (
    sourceCardId: string,
    targetCardId: string,
    relationType?: RelationType
  ) => Promise<void>;
  disconnectCards: (edgeId: string) => Promise<void>;
  splitCard: (
    cardId: string,
    subCards: SplitSubCardInput[],
    linkMode: 'sequential' | 'parallel'
  ) => Promise<void>;
  computeTimelineLayout: () => Promise<void>;
  moveCardToTimelineStep: (cardId: string, step: number) => Promise<void>;
  setConflictModalOpen: (open: boolean) => void;
  triggerSync: () => Promise<void>;
  resolveConflict: (conflictId: string, action: ConflictResolutionAction) => Promise<void>;
  exportMarkdown: () => Promise<MarkdownExportResult | null>;
  exportJson: () => Promise<JsonExportResult | null>;
  importJson: (jsonText: string) => Promise<BoardGraph | null>;

  startEventStream: () => () => void;
  pushToast: (kind: ToastNotification['kind'], message: string) => void;
  dismissToast: (id: string) => void;
}

export function createBoardStore(api: AriadeckApiClient = createAriadeckApiClient()) {
  let toastSeq = 1;

  return create<BoardStoreState>((set, get) => ({
    boards: [],
    activeBoardId: null,
    graph: null,
    selectedCardId: null,
    boardListOpen: false,
    conflictModalOpen: false,
    conflicts: [],
    syncConfigured: false,
    syncing: false,
    authRequired: false,
    authenticated: true,
    authError: null,
    viewMode: 'graph',
    connectionStatus: 'connecting',
    loading: false,
    toasts: [],

    pushToast: (kind, message) => {
      const id = `toast-${toastSeq++}`;
      set((state) => ({
        toasts: [...state.toasts.slice(-4), { id, kind, message }],
      }));
    },

    dismissToast: (id) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    },

    initialize: async () => {
      set({ loading: true, authError: null });
      try {
        if (typeof api.getAuthStatus === 'function') {
          const authStatus = await api.getAuthStatus();
          set({
            authRequired: authStatus.authRequired,
            authenticated: authStatus.authenticated,
          });
          if (authStatus.authRequired && !authStatus.authenticated) {
            set({ loading: false, connectionStatus: 'disconnected' });
            return;
          }
        }

        let boards = await api.listBoards();
        if (boards.length === 0) {
          const defaultBoard = await api.createBoard({
            title: 'My First Board',
            description: 'Double-click the canvas to add cards and connect dependencies.',
          });
          boards = [defaultBoard];
        }
        const firstBoardId = boards[0]!.id;
        const graph = await api.getBoardGraph(firstBoardId);
        let conflicts: ConflictRecord[] = [];
        let syncConfigured = false;
        if (typeof api.listConflicts === 'function') {
          try {
            const conflictData = await api.listConflicts(firstBoardId);
            conflicts = conflictData.conflicts;
            syncConfigured = conflictData.syncConfigured;
          } catch {
            // Ignore if conflict endpoint is unavailable in mocked tests.
          }
        }
        set({
          boards,
          activeBoardId: firstBoardId,
          graph,
          conflicts,
          syncConfigured,
          loading: false,
          connectionStatus: 'connected',
        });
      } catch (error) {
        set({ loading: false, connectionStatus: 'disconnected' });
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to connect to Ariadeck server.'
        );
      }
    },

    login: async (token) => {
      set({ authError: null });
      try {
        const status = await api.login(token);
        set({
          authRequired: status.authRequired,
          authenticated: status.authenticated,
          authError: null,
        });
        if (status.authenticated) {
          await get().initialize();
        }
        return status.authenticated;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authentication failed.';
        set({ authError: message, authenticated: false });
        return false;
      }
    },

    logout: async () => {
      try {
        await api.logout();
      } catch {
        // Clear local state regardless of network failure.
      }
      set({
        authenticated: false,
        graph: null,
        boards: [],
        activeBoardId: null,
        selectedCardId: null,
        connectionStatus: 'disconnected',
      });
    },

    selectBoard: async (boardId) => {
      set({ loading: true, selectedCardId: null });
      try {
        const graph = await api.getBoardGraph(boardId);
        set({ activeBoardId: boardId, graph, loading: false });
      } catch (error) {
        set({ loading: false });
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to load board.'
        );
      }
    },

    createBoard: async (title, description = '') => {
      try {
        const board = await api.createBoard({ title, description });
        const boards = await api.listBoards();
        const graph = await api.getBoardGraph(board.id);
        set({ boards, activeBoardId: board.id, graph, selectedCardId: null });
        get().pushToast('success', `Created board "${board.title}".`);
        return board;
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to create board.'
        );
        return null;
      }
    },

    updateBoard: async (boardId, patch) => {
      try {
        const updated = await api.updateBoard(boardId, patch);
        const boards = await api.listBoards();
        const isCurrent = get().activeBoardId === boardId;
        const graph = isCurrent ? await api.getBoardGraph(boardId) : get().graph;
        set({ boards, graph });
        get().pushToast('success', `Updated board "${updated.title}".`);
        return updated;
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to update board.'
        );
        return null;
      }
    },

    deleteBoard: async (boardId) => {
      try {
        await api.deleteBoard(boardId);
        let boards = await api.listBoards();
        if (boards.length === 0) {
          const fallback = await api.createBoard({
            title: 'Untitled Board',
            description: '',
          });
          boards = [fallback];
        }
        const nextBoardId =
          get().activeBoardId === boardId ? boards[0]!.id : (get().activeBoardId ?? boards[0]!.id);
        const graph = await api.getBoardGraph(nextBoardId);
        set({
          boards,
          activeBoardId: nextBoardId,
          graph,
          selectedCardId: null,
        });
        get().pushToast('info', 'Board deleted.');
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to delete board.'
        );
      }
    },

    toggleBoardList: () => set((state) => ({ boardListOpen: !state.boardListOpen })),
    setBoardListOpen: (open) => set({ boardListOpen: open }),

    refreshActiveBoard: async () => {
      const { activeBoardId, selectedCardId } = get();
      try {
        const boards = await api.listBoards();
        if (!activeBoardId) {
          set({ boards });
          return;
        }
        const graph = await api.getBoardGraph(activeBoardId);
        const stillExists =
          selectedCardId !== null && graph.cards.some((c) => c.id === selectedCardId);
        set({
          boards,
          graph,
          selectedCardId: stillExists ? selectedCardId : null,
        });
      } catch {
        // Ignore transient refresh failures.
      }
    },

    selectCard: (cardId) => set({ selectedCardId: cardId }),

    setViewMode: (mode) => set({ viewMode: mode }),

    createCard: async (input) => {
      const boardId = get().activeBoardId;
      if (!boardId) return null;
      try {
        const card = await api.createCard({ boardId, ...input });
        await get().refreshActiveBoard();
        set({ selectedCardId: card.id });
        return card;
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to create card.'
        );
        return null;
      }
    },

    updateCard: async (cardId, patch) => {
      try {
        await api.updateCard(cardId, patch);
        await get().refreshActiveBoard();
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to update card.'
        );
      }
    },

    deleteCard: async (cardId) => {
      try {
        await api.deleteCard(cardId);
        set((state) => ({
          selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
        }));
        await get().refreshActiveBoard();
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to delete card.'
        );
      }
    },

    connectCards: async (sourceCardId, targetCardId, relationType = 'blocks') => {
      const boardId = get().activeBoardId;
      if (!boardId) return;
      try {
        await api.connectCards({ boardId, sourceCardId, targetCardId, relationType });
        await get().refreshActiveBoard();
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to connect cards.'
        );
      }
    },

    disconnectCards: async (edgeId) => {
      try {
        await api.disconnectCards(edgeId);
        await get().refreshActiveBoard();
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to remove edge.'
        );
      }
    },

    splitCard: async (cardId, subCards, linkMode) => {
      try {
        await api.splitCard(cardId, { subCards, linkMode });
        set({ selectedCardId: null });
        await get().refreshActiveBoard();
        get().pushToast('success', `Split card into ${subCards.length} child cards.`);
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to split card.'
        );
      }
    },

    computeTimelineLayout: async () => {
      const boardId = get().activeBoardId;
      if (!boardId) return;
      try {
        const result = await api.computeTimelineLayout(boardId);
        await get().refreshActiveBoard();
        get().pushToast(
          'success',
          `Sorted timeline across ${result.steps.length} step(s).`
        );
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to compute timeline layout.'
        );
      }
    },

    moveCardToTimelineStep: async (cardId, step) => {
      const safeStep = Math.max(0, Math.floor(step));
      await get().updateCard(cardId, { timelineOrder: safeStep });
    },

    setConflictModalOpen: (open) => set({ conflictModalOpen: open }),

    triggerSync: async () => {
      const boardId = get().activeBoardId;
      if (!boardId) return;
      set({ syncing: true });
      try {
        const result = await api.syncBoard(boardId);
        const conflictData = await api.listConflicts(boardId);
        await get().refreshActiveBoard();
        set({
          syncing: false,
          conflicts: conflictData.conflicts,
          syncConfigured: conflictData.syncConfigured,
        });
        if (result.newConflicts.length > 0) {
          get().pushToast(
            'info',
            `Synced board with ${result.newConflicts.length} conflict(s) to review.`
          );
          set({ conflictModalOpen: true });
        } else {
          get().pushToast('success', 'Board synced with Google Drive.');
        }
      } catch (error) {
        set({ syncing: false });
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to sync board.'
        );
      }
    },

    resolveConflict: async (conflictId, action) => {
      const boardId = get().activeBoardId;
      if (!boardId) return;
      try {
        await api.resolveConflict(boardId, conflictId, action);
        const conflictData = await api.listConflicts(boardId);
        await get().refreshActiveBoard();
        set({ conflicts: conflictData.conflicts });
        get().pushToast('success', 'Conflict resolved.');
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to resolve conflict.'
        );
      }
    },

    exportMarkdown: async () => {
      const boardId = get().activeBoardId;
      if (!boardId) return null;
      try {
        const result = await api.exportBoardMarkdown(boardId, true);
        if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
          const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = result.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
        get().pushToast('success', `Exported ${result.filename}`);
        return result;
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to export Markdown.'
        );
        return null;
      }
    },

    exportJson: async () => {
      const boardId = get().activeBoardId;
      if (!boardId) return null;
      try {
        const result = await api.exportBoardJson(boardId);
        if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
          const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = result.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
        get().pushToast('success', `Exported ${result.filename}`);
        return result;
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to export JSON.'
        );
        return null;
      }
    },

    importJson: async (jsonText) => {
      try {
        const graph = await api.importBoardJson(jsonText);
        const boards = await api.listBoards();
        set({
          boards,
          activeBoardId: graph.board.id,
          graph,
          selectedCardId: null,
        });
        get().pushToast(
          'success',
          `Imported "${graph.board.title}" (${graph.cards.length} cards, ${graph.edges.length} edges).`
        );
        return graph;
      } catch (error) {
        get().pushToast(
          'error',
          error instanceof Error ? error.message : 'Failed to import board JSON.'
        );
        return null;
      }
    },

    startEventStream: () => {
      return api.subscribeEvents({
        onConnected: () => set({ connectionStatus: 'connected' }),
        onError: () => set({ connectionStatus: 'disconnected' }),
        onEvent: (event: GraphEvent) => {
          void get().refreshActiveBoard();
          if (event.deviceId === 'ariadeck-mcp-server') {
            get().pushToast('info', `AI agent updated the board (${event.type}).`);
          }
        },
      });
    },
  }));
}

export const useBoardStore = createBoardStore();
