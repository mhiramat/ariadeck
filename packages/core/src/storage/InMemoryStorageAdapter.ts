import type {
  Board,
  Card,
  CardAttachment,
  ConflictRecord,
  Edge,
  SyncOutboxEntry,
} from '../types/models.js';
import type { NewSyncOutboxEntry, StorageAdapter } from './StorageAdapter.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * In-memory StorageAdapter implementation for fast unit testing and
 * browser-only previews without native SQLite dependencies.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private boards = new Map<string, Board>();
  private cards = new Map<string, Card>();
  private edges = new Map<string, Edge>();
  private attachments = new Map<string, CardAttachment>();
  private outbox: SyncOutboxEntry[] = [];
  private conflicts = new Map<string, ConflictRecord>();
  private nextOutboxSeq = 1;

  async initialize(): Promise<void> {
    // No-op for in-memory storage.
  }

  async close(): Promise<void> {
    // No-op for in-memory storage.
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const snapshot = {
      boards: clone(this.boards),
      cards: clone(this.cards),
      edges: clone(this.edges),
      attachments: clone(this.attachments),
      outbox: clone(this.outbox),
      conflicts: clone(this.conflicts),
      nextOutboxSeq: this.nextOutboxSeq,
    };

    try {
      return await fn();
    } catch (error) {
      this.boards = snapshot.boards;
      this.cards = snapshot.cards;
      this.edges = snapshot.edges;
      this.attachments = snapshot.attachments;
      this.outbox = snapshot.outbox;
      this.conflicts = snapshot.conflicts;
      this.nextOutboxSeq = snapshot.nextOutboxSeq;
      throw error;
    }
  }

  async listBoards(includeDeleted = false): Promise<Board[]> {
    return Array.from(this.boards.values())
      .filter((b) => includeDeleted || b.deletedAt === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async getBoard(boardId: string, includeDeleted = false): Promise<Board | null> {
    const board = this.boards.get(boardId);
    if (!board || (!includeDeleted && board.deletedAt !== null)) {
      return null;
    }
    return clone(board);
  }

  async saveBoard(board: Board): Promise<void> {
    this.boards.set(board.id, clone(board));
  }

  async listCardsByBoard(boardId: string, includeDeleted = false): Promise<Card[]> {
    return Array.from(this.cards.values())
      .filter((c) => c.boardId === boardId && (includeDeleted || c.deletedAt === null))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async getCard(cardId: string, includeDeleted = false): Promise<Card | null> {
    const card = this.cards.get(cardId);
    if (!card || (!includeDeleted && card.deletedAt !== null)) {
      return null;
    }
    return clone(card);
  }

  async saveCard(card: Card): Promise<void> {
    this.cards.set(card.id, clone(card));
  }

  async listEdgesByBoard(boardId: string, includeDeleted = false): Promise<Edge[]> {
    return Array.from(this.edges.values())
      .filter((e) => e.boardId === boardId && (includeDeleted || e.deletedAt === null))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async getEdge(edgeId: string, includeDeleted = false): Promise<Edge | null> {
    const edge = this.edges.get(edgeId);
    if (!edge || (!includeDeleted && edge.deletedAt !== null)) {
      return null;
    }
    return clone(edge);
  }

  async saveEdge(edge: Edge): Promise<void> {
    this.edges.set(edge.id, clone(edge));
  }

  async listAllAttachments(includeDeleted = false): Promise<CardAttachment[]> {
    return Array.from(this.attachments.values())
      .filter((a) => includeDeleted || a.deletedAt === null)
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt)
      )
      .map(clone);
  }

  async listAttachmentsByBoard(boardId: string, includeDeleted = false): Promise<CardAttachment[]> {
    return Array.from(this.attachments.values())
      .filter((a) => a.boardId === boardId && (includeDeleted || a.deletedAt === null))
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt)
      )
      .map(clone);
  }

  async listAttachmentsByCard(cardId: string, includeDeleted = false): Promise<CardAttachment[]> {
    return Array.from(this.attachments.values())
      .filter((a) => a.cardId === cardId && (includeDeleted || a.deletedAt === null))
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt)
      )
      .map(clone);
  }

  async getAttachment(attachmentId: string, includeDeleted = false): Promise<CardAttachment | null> {
    const att = this.attachments.get(attachmentId);
    if (!att || (!includeDeleted && att.deletedAt !== null)) {
      return null;
    }
    return clone(att);
  }

  async saveAttachment(attachment: CardAttachment): Promise<void> {
    this.attachments.set(attachment.id, clone(attachment));
  }

  async appendOutbox(entry: NewSyncOutboxEntry): Promise<SyncOutboxEntry> {
    const created: SyncOutboxEntry = {
      ...clone(entry),
      seq: this.nextOutboxSeq++,
    };
    this.outbox.push(created);
    return clone(created);
  }

  async listUnsyncedOutbox(boardId: string): Promise<SyncOutboxEntry[]> {
    return this.outbox
      .filter((entry) => entry.boardId === boardId && entry.syncedAt === null)
      .map(clone);
  }

  async markOutboxSynced(seqIds: number[], syncedAt: string): Promise<void> {
    const idSet = new Set(seqIds);
    for (const entry of this.outbox) {
      if (idSet.has(entry.seq)) {
        entry.syncedAt = syncedAt;
      }
    }
  }

  async listConflicts(boardId: string, includeResolved = false): Promise<ConflictRecord[]> {
    return Array.from(this.conflicts.values())
      .filter((c) => c.boardId === boardId && (includeResolved || c.resolvedAt === null))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async saveConflict(conflict: ConflictRecord): Promise<void> {
    this.conflicts.set(conflict.id, clone(conflict));
  }
}
