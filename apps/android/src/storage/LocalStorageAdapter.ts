import {
  InMemoryStorageAdapter,
  type Board,
  type Card,
  type CardAttachment,
  type ConflictRecord,
  type Edge,
} from '@ariadeck/core';

interface PersistedMobileState {
  boards: Board[];
  cards: Card[];
  edges: Edge[];
  attachments: CardAttachment[];
  conflicts: ConflictRecord[];
}

const DEFAULT_STORAGE_KEY = 'ariadeck_mobile_v1';

/**
 * Offline-first StorageAdapter for Capacitor Android WebView and mobile web
 * previews, extending InMemoryStorageAdapter with localStorage persistence.
 */
export class LocalStorageAdapter extends InMemoryStorageAdapter {
  private readonly storageKey: string;

  constructor(storageKey = DEFAULT_STORAGE_KEY) {
    super();
    this.storageKey = storageKey;
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedMobileState>;
      for (const board of parsed.boards ?? []) await super.saveBoard(board);
      for (const card of parsed.cards ?? []) await super.saveCard(card);
      for (const edge of parsed.edges ?? []) await super.saveEdge(edge);
      for (const att of parsed.attachments ?? []) await super.saveAttachment(att);
      for (const conflict of parsed.conflicts ?? []) await super.saveConflict(conflict);
    } catch {
      // Ignore corrupted local storage state and start fresh.
    }
  }

  private async persist(): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const boards = await super.listBoards(true);
    const cards: Card[] = [];
    const edges: Edge[] = [];
    const attachments: CardAttachment[] = [];
    const conflicts: ConflictRecord[] = [];
    for (const board of boards) {
      cards.push(...(await super.listCardsByBoard(board.id, true)));
      edges.push(...(await super.listEdgesByBoard(board.id, true)));
      attachments.push(...(await super.listAttachmentsByBoard(board.id, true)));
      conflicts.push(...(await super.listConflicts(board.id, true)));
    }
    const payload: PersistedMobileState = { boards, cards, edges, attachments, conflicts };
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage quota exceeded errors gracefully.
    }
  }

  override async saveBoard(board: Board): Promise<void> {
    await super.saveBoard(board);
    await this.persist();
  }

  override async saveCard(card: Card): Promise<void> {
    await super.saveCard(card);
    await this.persist();
  }

  override async saveEdge(edge: Edge): Promise<void> {
    await super.saveEdge(edge);
    await this.persist();
  }

  override async saveAttachment(attachment: CardAttachment): Promise<void> {
    await super.saveAttachment(attachment);
    await this.persist();
  }

  override async saveConflict(conflict: ConflictRecord): Promise<void> {
    await super.saveConflict(conflict);
    await this.persist();
  }
}
