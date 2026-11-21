import type { Board, Card, CardAttachment, Edge } from '../types/models.js';

/**
 * Per-board synchronization snapshot stored at Ariadeck/boards/board_{boardId}.json
 * (including soft-deleted tombstones for deterministic multi-device LWW merging).
 */
export interface BoardSyncSnapshot {
  schemaVersion: 1;
  board: Board;
  cards: Card[];
  edges: Edge[];
  attachments: CardAttachment[];
  exportedAt: string;
  deviceId: string;
}

/**
 * Pluggable remote synchronization transport (implemented by GoogleDriveSyncAdapter
 * for production and InMemoryRemoteSyncAdapter for tests).
 */
export interface RemoteSyncAdapter {
  fetchBoardSnapshot(boardId: string): Promise<BoardSyncSnapshot | null>;
  uploadBoardSnapshot(snapshot: BoardSyncSnapshot): Promise<void>;
  listRemoteBoardIds(): Promise<string[]>;
  uploadMediaAsset(
    attachmentId: string,
    filename: string,
    data: Uint8Array,
    mimeType: string
  ): Promise<{ remoteFileId: string }>;
  downloadMediaAsset(remoteFileId: string): Promise<Uint8Array>;
}

/**
 * In-memory RemoteSyncAdapter for deterministic multi-device offline sync tests.
 */
export class InMemoryRemoteSyncAdapter implements RemoteSyncAdapter {
  private readonly snapshots = new Map<string, BoardSyncSnapshot>();
  private readonly media = new Map<string, Uint8Array>();

  async fetchBoardSnapshot(boardId: string): Promise<BoardSyncSnapshot | null> {
    const snap = this.snapshots.get(boardId);
    return snap ? structuredClone(snap) : null;
  }

  async uploadBoardSnapshot(snapshot: BoardSyncSnapshot): Promise<void> {
    this.snapshots.set(snapshot.board.id, structuredClone(snapshot));
  }

  async listRemoteBoardIds(): Promise<string[]> {
    return Array.from(this.snapshots.keys());
  }

  async uploadMediaAsset(
    attachmentId: string,
    filename: string,
    data: Uint8Array
  ): Promise<{ remoteFileId: string }> {
    const remoteFileId = `mem-media-${attachmentId}-${filename}`;
    this.media.set(remoteFileId, new Uint8Array(data));
    return { remoteFileId };
  }

  async downloadMediaAsset(remoteFileId: string): Promise<Uint8Array> {
    const data = this.media.get(remoteFileId);
    if (!data) {
      throw new Error(`Remote media asset "${remoteFileId}" was not found.`);
    }
    return new Uint8Array(data);
  }
}
