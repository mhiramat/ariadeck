import { create } from 'zustand';
import {
  BoardGraphService,
  CyclicDependencyError,
  type Board,
  type BoardGraph,
  type BoardType,
  type Card,
  type CardAttachment,
  type CardStatus,
  type CardType,
  type ConnectCardsOptions,
  type RelationType,
  type StorageAdapter,
} from '@ariadeck/core';
import { LocalStorageAdapter } from '../storage/LocalStorageAdapter.ts';

export type MobileViewMode = 'list' | 'edit' | 'relations' | 'timeline';
export type RelationToolMode = 'pan' | 'connect';

export interface MobileToast {
  id: string;
  kind: 'info' | 'error' | 'success';
  message: string;
}

export interface MobileStoreState {
  boards: Board[];
  activeBoardId: string | null;
  graph: BoardGraph | null;
  activeMode: MobileViewMode;
  selectedCardId: string | null;
  multiSelectIds: string[];
  searchQuery: string;
  filterType: CardType | 'all';
  relationToolMode: RelationToolMode;
  connectSourceId: string | null;
  pendingFlatEdge: { sourceId: string; targetId: string } | null;
  pendingJumpBack: { sourceId: string; targetId: string } | null;
  toasts: MobileToast[];

  initialize: () => Promise<void>;
  selectBoard: (boardId: string) => Promise<void>;
  createBoard: (title: string, boardType?: BoardType) => Promise<void>;
  renameBoard: (boardId: string, title: string) => Promise<void>;

  setActiveMode: (mode: MobileViewMode) => void;
  openCardEditor: (cardId: string) => void;
  setSearchQuery: (query: string) => void;
  setFilterType: (filter: CardType | 'all') => void;
  toggleMultiSelect: (cardId: string) => void;
  clearMultiSelect: () => void;

  setRelationToolMode: (mode: RelationToolMode) => void;
  handleRelationCardTap: (cardId: string) => Promise<void>;
  clearPendingEdgePrompts: () => void;

  createCard: (title: string, cardType?: CardType) => Promise<Card | null>;
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
    }
  ) => Promise<void>;
  deleteCard: (cardId: string) => Promise<void>;
  deleteSelectedCards: () => Promise<void>;
  mergeSelectedCards: (title: string) => Promise<void>;

  connectCards: (
    sourceId: string,
    targetId: string,
    relationType?: RelationType,
    options?: ConnectCardsOptions
  ) => Promise<void>;
  disconnectCards: (edgeId: string) => Promise<void>;

  addAttachment: (input: {
    cardId: string;
    kind: 'image' | 'audio';
    localUri: string;
    mimeType: string;
    fileSize: number;
    durationMs?: number | null;
    transcript?: string | null;
  }) => Promise<CardAttachment | null>;
  updateAttachmentTranscript: (attachmentId: string, transcript: string | null) => Promise<void>;
  deleteAttachment: (attachmentId: string) => Promise<void>;

  computeTimelineLayout: () => Promise<void>;
  moveCardToTimelineStep: (cardId: string, step: number) => Promise<void>;
  exportMarkdown: () => Promise<string | null>;

  pushToast: (kind: MobileToast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
}

export function createMobileStore(
  storage: StorageAdapter = new LocalStorageAdapter()
) {
  const service = new BoardGraphService(storage, {
    deviceId: 'ariadeck-android-local',
  });
  let toastSeq = 1;

  return create<MobileStoreState>((set, get) => {
    const refresh = async (boardId?: string) => {
      const targetBoardId = boardId ?? get().activeBoardId;
      const boards = await service.listBoards();
      if (!targetBoardId) {
        set({ boards });
        return;
      }
      const graph = await service.getBoardGraph(targetBoardId);
      set({ boards, activeBoardId: targetBoardId, graph });
    };

    return {
      boards: [],
      activeBoardId: null,
      graph: null,
      activeMode: 'list',
      selectedCardId: null,
      multiSelectIds: [],
      searchQuery: '',
      filterType: 'all',
      relationToolMode: 'pan',
      connectSourceId: null,
      pendingFlatEdge: null,
      pendingJumpBack: null,
      toasts: [],

      pushToast: (kind, message) => {
        const id = `mtoast-${toastSeq++}`;
        set((state) => ({
          toasts: [...state.toasts.slice(-2), { id, kind, message }],
        }));
      },

      dismissToast: (id) => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      },

      initialize: async () => {
        await storage.initialize();
        let boards = await service.listBoards();
        if (boards.length === 0) {
          const board = await service.createBoard({
            title: 'Mobile Board',
            description: 'Capture ideas, voice notes, and dependencies on the go.',
          });
          boards = [board];
        }
        const firstId = boards[0]!.id;
        const graph = await service.getBoardGraph(firstId);
        set({ boards, activeBoardId: firstId, graph });
      },

      selectBoard: async (boardId) => {
        set({
          selectedCardId: null,
          multiSelectIds: [],
          connectSourceId: null,
          pendingFlatEdge: null,
          pendingJumpBack: null,
        });
        await refresh(boardId);
        const nextGraph = get().graph;
        if ((nextGraph?.board.boardType ?? 'flow') === 'flat' && get().activeMode === 'timeline') {
          set({ activeMode: 'list' });
        }
      },

      createBoard: async (title, boardType = 'flow') => {
        try {
          const board = await service.createBoard({ title, boardType });
          await refresh(board.id);
          if (boardType === 'flat' && get().activeMode === 'timeline') {
            set({ activeMode: 'list' });
          }
          get().pushToast('success', `Created ${boardType} board "${board.title}".`);
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to create board.');
        }
      },

      renameBoard: async (boardId, title) => {
        try {
          const updated = await service.updateBoard(boardId, { title });
          await refresh(boardId);
          get().pushToast('success', `Renamed board to "${updated.title}".`);
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to rename board.');
        }
      },

      setActiveMode: (mode) => set({ activeMode: mode, connectSourceId: null }),

      openCardEditor: (cardId) =>
        set({ selectedCardId: cardId, activeMode: 'edit', multiSelectIds: [] }),

      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilterType: (filter) => set({ filterType: filter }),

      toggleMultiSelect: (cardId) =>
        set((state) => {
          const exists = state.multiSelectIds.includes(cardId);
          return {
            multiSelectIds: exists
              ? state.multiSelectIds.filter((id) => id !== cardId)
              : [...state.multiSelectIds, cardId],
          };
        }),

      clearMultiSelect: () => set({ multiSelectIds: [] }),

      setRelationToolMode: (mode) =>
        set({
          relationToolMode: mode,
          connectSourceId: null,
          pendingFlatEdge: null,
          pendingJumpBack: null,
        }),

      clearPendingEdgePrompts: () =>
        set({ pendingFlatEdge: null, pendingJumpBack: null }),

      handleRelationCardTap: async (cardId) => {
        const { relationToolMode, connectSourceId, graph, activeBoardId } = get();
        if (relationToolMode === 'pan') {
          set({ selectedCardId: cardId });
          return;
        }
        if (!connectSourceId) {
          set({ connectSourceId: cardId });
          get().pushToast('info', 'Now tap a target card to connect.');
          return;
        }
        if (connectSourceId === cardId) {
          set({ connectSourceId: null });
          return;
        }

        const boardType = graph?.board.boardType ?? 'flow';
        if (boardType === 'flat') {
          set({
            pendingFlatEdge: { sourceId: connectSourceId, targetId: cardId },
            connectSourceId: null,
          });
          return;
        }

        if (!activeBoardId) {
          set({ connectSourceId: null });
          return;
        }
        try {
          await service.connectCards(activeBoardId, connectSourceId, cardId, 'blocks');
          await refresh(activeBoardId);
          get().pushToast('success', 'Connected dependency edge.');
        } catch (error) {
          if (error instanceof CyclicDependencyError) {
            set({
              pendingJumpBack: { sourceId: connectSourceId, targetId: cardId },
            });
          } else {
            get().pushToast(
              'error',
              error instanceof Error ? error.message : 'Failed to connect cards.'
            );
          }
        }
        set({ connectSourceId: null });
      },

      createCard: async (title, cardType = 'idea') => {
        const boardId = get().activeBoardId;
        if (!boardId) return null;
        try {
          const card = await service.createCard({ boardId, title, cardType });
          await refresh(boardId);
          set({ selectedCardId: card.id, activeMode: 'edit' });
          return card;
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to create card.');
          return null;
        }
      },

      updateCard: async (cardId, patch) => {
        try {
          await service.updateCard(cardId, patch);
          await refresh();
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to update card.');
        }
      },

      deleteCard: async (cardId) => {
        try {
          await service.deleteCard(cardId);
          set((state) => ({
            selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
            activeMode: state.selectedCardId === cardId ? 'list' : state.activeMode,
          }));
          await refresh();
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to delete card.');
        }
      },

      deleteSelectedCards: async () => {
        const ids = get().multiSelectIds;
        for (const id of ids) {
          await service.deleteCard(id);
        }
        set({ multiSelectIds: [], selectedCardId: null });
        await refresh();
        get().pushToast('info', `Deleted ${ids.length} card(s).`);
      },

      mergeSelectedCards: async (title) => {
        const ids = get().multiSelectIds;
        const graph = get().graph;
        if (!graph || ids.length < 2) return;
        const chosen = graph.cards.filter((c) => ids.includes(c.id));
        const mergedContent = chosen
          .map((c) => `### ${c.title}\n\n${c.content}`.trim())
          .join('\n\n---\n\n');
        try {
          const merged = await service.mergeCards({
            targetCardIds: ids,
            mergedCard: { title, content: mergedContent },
          });
          set({ multiSelectIds: [], selectedCardId: merged.id, activeMode: 'edit' });
          await refresh();
          get().pushToast('success', `Merged ${ids.length} cards into "${merged.title}".`);
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to merge cards.');
        }
      },

      connectCards: async (sourceId, targetId, relationType = 'blocks', options) => {
        const boardId = get().activeBoardId;
        if (!boardId) return;
        try {
          await service.connectCards(boardId, sourceId, targetId, relationType, options);
          await refresh(boardId);
          set({ pendingFlatEdge: null, pendingJumpBack: null });
          get().pushToast(
            'success',
            relationType === 'jump_back'
              ? 'Created jump-back loop edge.'
              : 'Connected relationship edge.'
          );
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to connect cards.');
        }
      },

      disconnectCards: async (edgeId) => {
        try {
          await service.disconnectCards(edgeId);
          await refresh();
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to remove edge.');
        }
      },

      addAttachment: async (input) => {
        const boardId = get().activeBoardId;
        if (!boardId) return null;
        try {
          const att = await service.addAttachment({ boardId, ...input });
          await refresh(boardId);
          get().pushToast('success', `Attached ${input.kind}.`);
          return att;
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to attach media.');
          return null;
        }
      },

      updateAttachmentTranscript: async (attachmentId, transcript) => {
        try {
          await service.updateAttachmentTranscript(attachmentId, transcript);
          await refresh();
        } catch (error) {
          get().pushToast(
            'error',
            error instanceof Error ? error.message : 'Failed to update transcript.'
          );
        }
      },

      deleteAttachment: async (attachmentId) => {
        try {
          await service.deleteAttachment(attachmentId);
          await refresh();
        } catch (error) {
          get().pushToast('error', error instanceof Error ? error.message : 'Failed to delete attachment.');
        }
      },

      computeTimelineLayout: async () => {
        const boardId = get().activeBoardId;
        if (!boardId) return;
        const result = await service.computeTimelineLayout(boardId);
        await refresh(boardId);
        get().pushToast('success', `Sorted into ${result.steps.length} step(s).`);
      },

      moveCardToTimelineStep: async (cardId, step) => {
        await get().updateCard(cardId, { timelineOrder: Math.max(0, Math.floor(step)) });
      },

      exportMarkdown: async () => {
        const boardId = get().activeBoardId;
        if (!boardId) return null;
        const result = await service.exportBoardToMarkdown(boardId);
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
        return result.markdown;
      },
    };
  });
}

export const useMobileStore = createMobileStore();
