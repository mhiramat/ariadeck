import Database from 'better-sqlite3';
import type {
  AssetSyncStatus,
  AttachmentKind,
  Board,
  Card,
  CardAttachment,
  CardStatus,
  CardType,
  ConflictRecord,
  ConflictType,
  Edge,
  RelationType,
  SyncOutboxEntityType,
  SyncOutboxEntry,
  SyncOutboxOperation,
} from '../types/models.js';
import { SCHEMA_DDL_STATEMENTS } from './schema.js';
import type { NewSyncOutboxEntry, StorageAdapter } from './StorageAdapter.js';

interface BoardRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  updated_by_device_id: string;
  version: number;
  deleted_at: string | null;
}

interface CardRow {
  id: string;
  board_id: string;
  title: string;
  content: string;
  card_type: string;
  status: string;
  tags_json: string;
  pos_x: number;
  pos_y: number;
  timeline_order: number | null;
  start_at: string | null;
  end_at: string | null;
  split_from_card_id: string | null;
  merged_from_card_ids_json: string | null;
  replaced_by_card_ids_json: string | null;
  created_at: string;
  updated_at: string;
  updated_by_device_id: string;
  version: number;
  deleted_at: string | null;
}

interface EdgeRow {
  id: string;
  board_id: string;
  source_card_id: string;
  target_card_id: string;
  relation_type: string;
  label: string | null;
  is_conflicted: number;
  conflict_reason: string | null;
  created_at: string;
  updated_at: string;
  updated_by_device_id: string;
  version: number;
  deleted_at: string | null;
}

interface AttachmentRow {
  id: string;
  card_id: string;
  board_id: string;
  kind: string;
  local_uri: string;
  remote_file_id: string | null;
  mime_type: string;
  file_size: number;
  duration_ms: number | null;
  transcript: string | null;
  sync_status: string;
  created_at: string;
  updated_at: string;
  updated_by_device_id: string;
  version: number;
  deleted_at: string | null;
}

interface OutboxRow {
  seq: number;
  entity_type: string;
  entity_id: string;
  board_id: string;
  operation: string;
  payload_json: string;
  created_at: string;
  synced_at: string | null;
}

interface ConflictRow {
  id: string;
  board_id: string;
  entity_type: string;
  entity_id: string;
  conflict_type: string;
  local_snapshot_json: string;
  remote_snapshot_json: string;
  resolved_at: string | null;
  created_at: string;
}

function mapBoardRow(row: BoardRow): Board {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByDeviceId: row.updated_by_device_id,
    version: row.version,
    deletedAt: row.deleted_at,
  };
}

function mapCardRow(row: CardRow): Card {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    content: row.content,
    cardType: row.card_type as CardType,
    status: row.status as CardStatus,
    tags: JSON.parse(row.tags_json) as string[],
    posX: row.pos_x,
    posY: row.pos_y,
    timelineOrder: row.timeline_order,
    startAt: row.start_at,
    endAt: row.end_at,
    splitFromCardId: row.split_from_card_id,
    mergedFromCardIds: row.merged_from_card_ids_json
      ? (JSON.parse(row.merged_from_card_ids_json) as string[])
      : null,
    replacedByCardIds: row.replaced_by_card_ids_json
      ? (JSON.parse(row.replaced_by_card_ids_json) as string[])
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByDeviceId: row.updated_by_device_id,
    version: row.version,
    deletedAt: row.deleted_at,
  };
}

function mapEdgeRow(row: EdgeRow): Edge {
  const edge: Edge = {
    id: row.id,
    boardId: row.board_id,
    sourceCardId: row.source_card_id,
    targetCardId: row.target_card_id,
    relationType: row.relation_type as RelationType,
    isConflicted: row.is_conflicted === 1,
    conflictReason: row.conflict_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByDeviceId: row.updated_by_device_id,
    version: row.version,
    deletedAt: row.deleted_at,
  };
  if (row.label !== null) {
    edge.label = row.label;
  }
  return edge;
}

function mapAttachmentRow(row: AttachmentRow): CardAttachment {
  return {
    id: row.id,
    cardId: row.card_id,
    boardId: row.board_id,
    kind: row.kind as AttachmentKind,
    localUri: row.local_uri,
    remoteFileId: row.remote_file_id,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    durationMs: row.duration_ms,
    transcript: row.transcript,
    syncStatus: row.sync_status as AssetSyncStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByDeviceId: row.updated_by_device_id,
    version: row.version,
    deletedAt: row.deleted_at,
  };
}

function mapOutboxRow(row: OutboxRow): SyncOutboxEntry {
  return {
    seq: row.seq,
    entityType: row.entity_type as SyncOutboxEntityType,
    entityId: row.entity_id,
    boardId: row.board_id,
    operation: row.operation as SyncOutboxOperation,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  };
}

function mapConflictRow(row: ConflictRow): ConflictRecord {
  return {
    id: row.id,
    boardId: row.board_id,
    entityType: row.entity_type as SyncOutboxEntityType,
    entityId: row.entity_id,
    conflictType: row.conflict_type as ConflictType,
    localSnapshotJson: row.local_snapshot_json,
    remoteSnapshotJson: row.remote_snapshot_json,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/**
 * Node.js SQLite StorageAdapter backed by better-sqlite3.
 * Defaults to "./ariadeck.db" unless overridden via the constructor argument
 * or the ARIADECK_DB_PATH environment variable.
 */
export class SqliteStorageAdapter implements StorageAdapter {
  private readonly dbPath: string;
  private db: Database.Database | null = null;
  private txDepth = 0;

  constructor(dbPath = process.env.ARIADECK_DB_PATH ?? './ariadeck.db') {
    this.dbPath = dbPath;
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('SqliteStorageAdapter has not been initialized. Call initialize() first.');
    }
    return this.db;
  }

  async initialize(): Promise<void> {
    if (this.db) {
      return;
    }
    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    for (const ddl of SCHEMA_DDL_STATEMENTS) {
      db.exec(ddl);
    }
    this.db = db;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.getDb();
    const isOuter = this.txDepth === 0;
    const savepointName = `sp_${this.txDepth}`;

    if (isOuter) {
      db.exec('BEGIN IMMEDIATE');
    } else {
      db.exec(`SAVEPOINT ${savepointName}`);
    }
    this.txDepth += 1;

    try {
      const result = await fn();
      this.txDepth -= 1;
      if (isOuter) {
        db.exec('COMMIT');
      } else {
        db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      return result;
    } catch (error) {
      this.txDepth -= 1;
      if (isOuter) {
        db.exec('ROLLBACK');
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      throw error;
    }
  }

  async listBoards(includeDeleted = false): Promise<Board[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM boards ORDER BY created_at ASC'
      : 'SELECT * FROM boards WHERE deleted_at IS NULL ORDER BY created_at ASC';
    const rows = db.prepare(sql).all() as BoardRow[];
    return rows.map(mapBoardRow);
  }

  async getBoard(boardId: string, includeDeleted = false): Promise<Board | null> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM boards WHERE id = ?'
      : 'SELECT * FROM boards WHERE id = ? AND deleted_at IS NULL';
    const row = db.prepare(sql).get(boardId) as BoardRow | undefined;
    return row ? mapBoardRow(row) : null;
  }

  async saveBoard(board: Board): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO boards (
        id, title, description, created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @title, @description, @createdAt, @updatedAt, @updatedByDeviceId, @version, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        updated_at = excluded.updated_at,
        updated_by_device_id = excluded.updated_by_device_id,
        version = excluded.version,
        deleted_at = excluded.deleted_at`
    ).run(board);
  }

  async listCardsByBoard(boardId: string, includeDeleted = false): Promise<Card[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM cards WHERE board_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM cards WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at ASC';
    const rows = db.prepare(sql).all(boardId) as CardRow[];
    return rows.map(mapCardRow);
  }

  async getCard(cardId: string, includeDeleted = false): Promise<Card | null> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM cards WHERE id = ?'
      : 'SELECT * FROM cards WHERE id = ? AND deleted_at IS NULL';
    const row = db.prepare(sql).get(cardId) as CardRow | undefined;
    return row ? mapCardRow(row) : null;
  }

  async saveCard(card: Card): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO cards (
        id, board_id, title, content, card_type, status, tags_json,
        pos_x, pos_y, timeline_order, start_at, end_at,
        split_from_card_id, merged_from_card_ids_json, replaced_by_card_ids_json,
        created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @boardId, @title, @content, @cardType, @status, @tagsJson,
        @posX, @posY, @timelineOrder, @startAt, @endAt,
        @splitFromCardId, @mergedFromCardIdsJson, @replacedByCardIdsJson,
        @createdAt, @updatedAt, @updatedByDeviceId, @version, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        board_id = excluded.board_id,
        title = excluded.title,
        content = excluded.content,
        card_type = excluded.card_type,
        status = excluded.status,
        tags_json = excluded.tags_json,
        pos_x = excluded.pos_x,
        pos_y = excluded.pos_y,
        timeline_order = excluded.timeline_order,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        split_from_card_id = excluded.split_from_card_id,
        merged_from_card_ids_json = excluded.merged_from_card_ids_json,
        replaced_by_card_ids_json = excluded.replaced_by_card_ids_json,
        updated_at = excluded.updated_at,
        updated_by_device_id = excluded.updated_by_device_id,
        version = excluded.version,
        deleted_at = excluded.deleted_at`
    ).run({
      ...card,
      tagsJson: JSON.stringify(card.tags),
      mergedFromCardIdsJson: card.mergedFromCardIds ? JSON.stringify(card.mergedFromCardIds) : null,
      replacedByCardIdsJson: card.replacedByCardIds ? JSON.stringify(card.replacedByCardIds) : null,
    });
  }

  async listEdgesByBoard(boardId: string, includeDeleted = false): Promise<Edge[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM edges WHERE board_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM edges WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at ASC';
    const rows = db.prepare(sql).all(boardId) as EdgeRow[];
    return rows.map(mapEdgeRow);
  }

  async getEdge(edgeId: string, includeDeleted = false): Promise<Edge | null> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM edges WHERE id = ?'
      : 'SELECT * FROM edges WHERE id = ? AND deleted_at IS NULL';
    const row = db.prepare(sql).get(edgeId) as EdgeRow | undefined;
    return row ? mapEdgeRow(row) : null;
  }

  async saveEdge(edge: Edge): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO edges (
        id, board_id, source_card_id, target_card_id, relation_type, label,
        is_conflicted, conflict_reason,
        created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @boardId, @sourceCardId, @targetCardId, @relationType, @label,
        @isConflicted, @conflictReason,
        @createdAt, @updatedAt, @updatedByDeviceId, @version, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        board_id = excluded.board_id,
        source_card_id = excluded.source_card_id,
        target_card_id = excluded.target_card_id,
        relation_type = excluded.relation_type,
        label = excluded.label,
        is_conflicted = excluded.is_conflicted,
        conflict_reason = excluded.conflict_reason,
        updated_at = excluded.updated_at,
        updated_by_device_id = excluded.updated_by_device_id,
        version = excluded.version,
        deleted_at = excluded.deleted_at`
    ).run({
      ...edge,
      label: edge.label ?? null,
      isConflicted: edge.isConflicted ? 1 : 0,
      conflictReason: edge.conflictReason ?? null,
    });
  }

  async listAttachmentsByBoard(boardId: string, includeDeleted = false): Promise<CardAttachment[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM card_attachments WHERE board_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM card_attachments WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at ASC';
    const rows = db.prepare(sql).all(boardId) as AttachmentRow[];
    return rows.map(mapAttachmentRow);
  }

  async listAttachmentsByCard(cardId: string, includeDeleted = false): Promise<CardAttachment[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM card_attachments WHERE card_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM card_attachments WHERE card_id = ? AND deleted_at IS NULL ORDER BY created_at ASC';
    const rows = db.prepare(sql).all(cardId) as AttachmentRow[];
    return rows.map(mapAttachmentRow);
  }

  async saveAttachment(attachment: CardAttachment): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO card_attachments (
        id, card_id, board_id, kind, local_uri, remote_file_id, mime_type,
        file_size, duration_ms, transcript, sync_status,
        created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @cardId, @boardId, @kind, @localUri, @remoteFileId, @mimeType,
        @fileSize, @durationMs, @transcript, @syncStatus,
        @createdAt, @updatedAt, @updatedByDeviceId, @version, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        card_id = excluded.card_id,
        board_id = excluded.board_id,
        kind = excluded.kind,
        local_uri = excluded.local_uri,
        remote_file_id = excluded.remote_file_id,
        mime_type = excluded.mime_type,
        file_size = excluded.file_size,
        duration_ms = excluded.duration_ms,
        transcript = excluded.transcript,
        sync_status = excluded.sync_status,
        updated_at = excluded.updated_at,
        updated_by_device_id = excluded.updated_by_device_id,
        version = excluded.version,
        deleted_at = excluded.deleted_at`
    ).run(attachment);
  }

  async appendOutbox(entry: NewSyncOutboxEntry): Promise<SyncOutboxEntry> {
    const db = this.getDb();
    const result = db
      .prepare(
        `INSERT INTO sync_outbox (
          entity_type, entity_id, board_id, operation, payload_json, created_at, synced_at
        ) VALUES (
          @entityType, @entityId, @boardId, @operation, @payloadJson, @createdAt, @syncedAt
        )`
      )
      .run(entry);
    return {
      ...entry,
      seq: Number(result.lastInsertRowid),
    };
  }

  async listUnsyncedOutbox(boardId: string): Promise<SyncOutboxEntry[]> {
    const db = this.getDb();
    const rows = db
      .prepare(
        'SELECT * FROM sync_outbox WHERE board_id = ? AND synced_at IS NULL ORDER BY seq ASC'
      )
      .all(boardId) as OutboxRow[];
    return rows.map(mapOutboxRow);
  }

  async markOutboxSynced(seqIds: number[], syncedAt: string): Promise<void> {
    if (seqIds.length === 0) {
      return;
    }
    const db = this.getDb();
    const placeholders = seqIds.map(() => '?').join(', ');
    db.prepare(`UPDATE sync_outbox SET synced_at = ? WHERE seq IN (${placeholders})`).run(
      syncedAt,
      ...seqIds
    );
  }

  async listConflicts(boardId: string, includeResolved = false): Promise<ConflictRecord[]> {
    const db = this.getDb();
    const sql = includeDeletedSql(includeResolved);
    const rows = db.prepare(sql).all(boardId) as ConflictRow[];
    return rows.map(mapConflictRow);
  }

  async saveConflict(conflict: ConflictRecord): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO conflicts (
        id, board_id, entity_type, entity_id, conflict_type,
        local_snapshot_json, remote_snapshot_json, resolved_at, created_at
      ) VALUES (
        @id, @boardId, @entityType, @entityId, @conflictType,
        @localSnapshotJson, @remoteSnapshotJson, @resolvedAt, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        resolved_at = excluded.resolved_at,
        local_snapshot_json = excluded.local_snapshot_json,
        remote_snapshot_json = excluded.remote_snapshot_json`
    ).run(conflict);
  }
}

function includeDeletedSql(includeResolved: boolean): string {
  return includeResolved
    ? 'SELECT * FROM conflicts WHERE board_id = ? ORDER BY created_at ASC'
    : 'SELECT * FROM conflicts WHERE board_id = ? AND resolved_at IS NULL ORDER BY created_at ASC';
}
