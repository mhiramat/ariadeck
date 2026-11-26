import Database from 'better-sqlite3';
import type {
  AssetSyncStatus,
  AttachmentKind,
  Board,
  BoardType,
  Card,
  CardAttachment,
  CardDisplayMode,
  CardStatus,
  CardType,
  ConflictRecord,
  ConflictType,
  Edge,
  EdgeDirection,
  EdgeStyleVariant,
  RelationType,
  SyncOutboxEntityType,
  SyncOutboxEntry,
  SyncOutboxOperation,
} from '../types/models.js';
import {
  SCHEMA_DDL_STATEMENTS,
  SCHEMA_V2_INDEX_STATEMENTS,
  SCHEMA_V3_INDEX_STATEMENTS,
} from './schema.js';
import type {
  ExternalChangeSource,
  NewSyncOutboxEntry,
  StorageAdapter,
} from './StorageAdapter.js';

interface BoardRow {
  id: string;
  title: string;
  description: string;
  board_type?: string;
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
  display_mode?: string;
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
  direction?: string;
  label: string | null;
  style_variant?: string;
  color?: string | null;
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
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  thumbnail_uri?: string | null;
  caption?: string | null;
  is_cover?: number;
  sort_order?: number;
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
    boardType: (row.board_type === 'flat' ? 'flat' : 'flow') as BoardType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByDeviceId: row.updated_by_device_id,
    version: row.version,
    deletedAt: row.deleted_at,
  };
}

function normalizeDisplayMode(value?: string): CardDisplayMode {
  if (value === 'image_cover' || value === 'image_only') {
    return value;
  }
  return 'standard';
}

function mapCardRow(row: CardRow): Card {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    content: row.content,
    cardType: row.card_type as CardType,
    displayMode: normalizeDisplayMode(row.display_mode),
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
    direction: (row.direction ?? 'directed') as EdgeDirection,
    styleVariant: (row.style_variant ?? 'solid') as EdgeStyleVariant,
    color: row.color ?? null,
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
    sha256: row.sha256 ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    thumbnailUri: row.thumbnail_uri ?? null,
    caption: row.caption ?? null,
    isCover: row.is_cover === 1,
    sortOrder: row.sort_order ?? 0,
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

const MAX_TRACKED_OWN_OUTBOX_SEQS = 10_000;

/**
 * Node.js SQLite StorageAdapter backed by better-sqlite3.
 * Defaults to "./ariadeck.db" unless overridden via the constructor argument
 * or the ARIADECK_DB_PATH environment variable.
 */
export class SqliteStorageAdapter implements StorageAdapter, ExternalChangeSource {
  private readonly dbPath: string;
  private db: Database.Database | null = null;
  private txDepth = 0;
  private readonly ownOutboxSeqs = new Set<number>();

  constructor(dbPath = process.env.ARIADECK_DB_PATH ?? './ariadeck.db') {
    this.dbPath = dbPath;
  }

  private recordOwnOutboxSeq(seq: number): void {
    this.ownOutboxSeqs.add(seq);
    if (this.ownOutboxSeqs.size > MAX_TRACKED_OWN_OUTBOX_SEQS) {
      const excess = this.ownOutboxSeqs.size - MAX_TRACKED_OWN_OUTBOX_SEQS;
      let removed = 0;
      for (const oldSeq of this.ownOutboxSeqs) {
        this.ownOutboxSeqs.delete(oldSeq);
        removed += 1;
        if (removed >= excess) break;
      }
    }
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('SqliteStorageAdapter has not been initialized. Call initialize() first.');
    }
    return this.db;
  }

  private migrateSchemaV1ToV2(db: Database.Database): void {
    const boardCols = new Set(
      (db.prepare('PRAGMA table_info(boards)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!boardCols.has('board_type')) {
      db.exec(
        `ALTER TABLE boards ADD COLUMN board_type TEXT NOT NULL DEFAULT 'flow' CHECK (board_type IN ('flow', 'flat'))`
      );
    }

    const edgeCols = new Set(
      (db.prepare('PRAGMA table_info(edges)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!edgeCols.has('direction') || !edgeCols.has('style_variant') || !edgeCols.has('color')) {
      db.pragma('foreign_keys = OFF');
      db.exec('BEGIN TRANSACTION');
      try {
        db.exec(`CREATE TABLE edges_v2 (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          source_card_id TEXT NOT NULL,
          target_card_id TEXT NOT NULL,
          relation_type TEXT NOT NULL DEFAULT 'blocks'
            CHECK (relation_type IN ('blocks', 'causes', 'relates_to', 'jump_back', 'custom')),
          direction TEXT NOT NULL DEFAULT 'directed'
            CHECK (direction IN ('directed', 'bidirectional', 'undirected')),
          label TEXT,
          style_variant TEXT NOT NULL DEFAULT 'solid'
            CHECK (style_variant IN ('solid', 'dashed', 'dotted')),
          color TEXT,
          is_conflicted INTEGER NOT NULL DEFAULT 0,
          conflict_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by_device_id TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TEXT,
          FOREIGN KEY (board_id) REFERENCES boards(id),
          FOREIGN KEY (source_card_id) REFERENCES cards(id),
          FOREIGN KEY (target_card_id) REFERENCES cards(id)
        )`);
        db.exec(`INSERT INTO edges_v2 (
          id, board_id, source_card_id, target_card_id, relation_type,
          direction, label, style_variant, color, is_conflicted, conflict_reason,
          created_at, updated_at, updated_by_device_id, version, deleted_at
        )
        SELECT
          id, board_id, source_card_id, target_card_id, relation_type,
          'directed', label, 'solid', NULL, COALESCE(is_conflicted, 0), conflict_reason,
          created_at, updated_at, updated_by_device_id, version, deleted_at
        FROM edges`);
        db.exec('DROP TABLE edges');
        db.exec('ALTER TABLE edges_v2 RENAME TO edges');
        db.exec('CREATE INDEX IF NOT EXISTS idx_edges_board_id ON edges(board_id)');
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }

    for (const idxSql of SCHEMA_V2_INDEX_STATEMENTS) {
      db.exec(idxSql);
    }
  }

  private migrateSchemaV2ToV3(db: Database.Database): void {
    const cardCols = new Set(
      (db.prepare('PRAGMA table_info(cards)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!cardCols.has('display_mode')) {
      db.exec(
        `ALTER TABLE cards ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'standard' CHECK (display_mode IN ('standard', 'image_cover', 'image_only'))`
      );
    }

    const attCols = new Set(
      (db.prepare('PRAGMA table_info(card_attachments)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    const alterStatements: Array<[string, string]> = [
      ['sha256', 'ALTER TABLE card_attachments ADD COLUMN sha256 TEXT'],
      ['width', 'ALTER TABLE card_attachments ADD COLUMN width INTEGER'],
      ['height', 'ALTER TABLE card_attachments ADD COLUMN height INTEGER'],
      ['thumbnail_uri', 'ALTER TABLE card_attachments ADD COLUMN thumbnail_uri TEXT'],
      ['caption', 'ALTER TABLE card_attachments ADD COLUMN caption TEXT'],
      ['is_cover', 'ALTER TABLE card_attachments ADD COLUMN is_cover INTEGER NOT NULL DEFAULT 0'],
      ['sort_order', 'ALTER TABLE card_attachments ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [col, sql] of alterStatements) {
      if (!attCols.has(col)) {
        db.exec(sql);
      }
    }

    for (const idxSql of SCHEMA_V3_INDEX_STATEMENTS) {
      db.exec(idxSql);
    }
  }

  async initialize(): Promise<void> {
    if (this.db) {
      return;
    }
    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    for (const ddl of SCHEMA_DDL_STATEMENTS) {
      db.exec(ddl);
    }
    this.migrateSchemaV1ToV2(db);
    this.migrateSchemaV2ToV3(db);
    this.db = db;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.ownOutboxSeqs.clear();
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
        id, title, description, board_type, created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @title, @description, @boardType, @createdAt, @updatedAt, @updatedByDeviceId, @version, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        board_type = excluded.board_type,
        updated_at = excluded.updated_at,
        updated_by_device_id = excluded.updated_by_device_id,
        version = excluded.version,
        deleted_at = excluded.deleted_at`
    ).run({
      ...board,
      boardType: board.boardType ?? 'flow',
    });
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
        id, board_id, title, content, card_type, display_mode, status, tags_json,
        pos_x, pos_y, timeline_order, start_at, end_at,
        split_from_card_id, merged_from_card_ids_json, replaced_by_card_ids_json,
        created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @boardId, @title, @content, @cardType, @displayMode, @status, @tagsJson,
        @posX, @posY, @timelineOrder, @startAt, @endAt,
        @splitFromCardId, @mergedFromCardIdsJson, @replacedByCardIdsJson,
        @createdAt, @updatedAt, @updatedByDeviceId, @version, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        board_id = excluded.board_id,
        title = excluded.title,
        content = excluded.content,
        card_type = excluded.card_type,
        display_mode = excluded.display_mode,
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
      displayMode: normalizeDisplayMode(card.displayMode),
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
        id, board_id, source_card_id, target_card_id, relation_type, direction,
        label, style_variant, color,
        is_conflicted, conflict_reason,
        created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @boardId, @sourceCardId, @targetCardId, @relationType, @direction,
        @label, @styleVariant, @color,
        @isConflicted, @conflictReason,
        @createdAt, @updatedAt, @updatedByDeviceId, @version, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        board_id = excluded.board_id,
        source_card_id = excluded.source_card_id,
        target_card_id = excluded.target_card_id,
        relation_type = excluded.relation_type,
        direction = excluded.direction,
        label = excluded.label,
        style_variant = excluded.style_variant,
        color = excluded.color,
        is_conflicted = excluded.is_conflicted,
        conflict_reason = excluded.conflict_reason,
        updated_at = excluded.updated_at,
        updated_by_device_id = excluded.updated_by_device_id,
        version = excluded.version,
        deleted_at = excluded.deleted_at`
    ).run({
      ...edge,
      direction: edge.direction ?? 'directed',
      label: edge.label ?? null,
      styleVariant: edge.styleVariant ?? 'solid',
      color: edge.color ?? null,
      isConflicted: edge.isConflicted ? 1 : 0,
      conflictReason: edge.conflictReason ?? null,
    });
  }

  async listAllAttachments(includeDeleted = false): Promise<CardAttachment[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM card_attachments ORDER BY sort_order ASC, created_at ASC'
      : 'SELECT * FROM card_attachments WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC';
    const rows = db.prepare(sql).all() as AttachmentRow[];
    return rows.map(mapAttachmentRow);
  }

  async listAttachmentsByBoard(boardId: string, includeDeleted = false): Promise<CardAttachment[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM card_attachments WHERE board_id = ? ORDER BY sort_order ASC, created_at ASC'
      : 'SELECT * FROM card_attachments WHERE board_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC';
    const rows = db.prepare(sql).all(boardId) as AttachmentRow[];
    return rows.map(mapAttachmentRow);
  }

  async listAttachmentsByCard(cardId: string, includeDeleted = false): Promise<CardAttachment[]> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM card_attachments WHERE card_id = ? ORDER BY sort_order ASC, created_at ASC'
      : 'SELECT * FROM card_attachments WHERE card_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC';
    const rows = db.prepare(sql).all(cardId) as AttachmentRow[];
    return rows.map(mapAttachmentRow);
  }

  async getAttachment(attachmentId: string, includeDeleted = false): Promise<CardAttachment | null> {
    const db = this.getDb();
    const sql = includeDeleted
      ? 'SELECT * FROM card_attachments WHERE id = ?'
      : 'SELECT * FROM card_attachments WHERE id = ? AND deleted_at IS NULL';
    const row = db.prepare(sql).get(attachmentId) as AttachmentRow | undefined;
    return row ? mapAttachmentRow(row) : null;
  }

  async saveAttachment(attachment: CardAttachment): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO card_attachments (
        id, card_id, board_id, kind, local_uri, remote_file_id, mime_type,
        file_size, sha256, width, height, thumbnail_uri, caption, is_cover, sort_order,
        duration_ms, transcript, sync_status,
        created_at, updated_at, updated_by_device_id, version, deleted_at
      ) VALUES (
        @id, @cardId, @boardId, @kind, @localUri, @remoteFileId, @mimeType,
        @fileSize, @sha256, @width, @height, @thumbnailUri, @caption, @isCover, @sortOrder,
        @durationMs, @transcript, @syncStatus,
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
        sha256 = excluded.sha256,
        width = excluded.width,
        height = excluded.height,
        thumbnail_uri = excluded.thumbnail_uri,
        caption = excluded.caption,
        is_cover = excluded.is_cover,
        sort_order = excluded.sort_order,
        duration_ms = excluded.duration_ms,
        transcript = excluded.transcript,
        sync_status = excluded.sync_status,
        updated_at = excluded.updated_at,
        updated_by_device_id = excluded.updated_by_device_id,
        version = excluded.version,
        deleted_at = excluded.deleted_at`
    ).run({
      ...attachment,
      sha256: attachment.sha256 ?? null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      thumbnailUri: attachment.thumbnailUri ?? null,
      caption: attachment.caption ?? null,
      isCover: attachment.isCover ? 1 : 0,
      sortOrder: attachment.sortOrder ?? 0,
    });
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
    const seq = Number(result.lastInsertRowid);
    this.recordOwnOutboxSeq(seq);
    return {
      ...entry,
      seq,
    };
  }

  /**
   * Returns SQLite's PRAGMA data_version counter, which increments whenever
   * another database connection commits changes to the shared SQLite file.
   */
  getDataVersion(): number {
    const db = this.getDb();
    return Number(db.pragma('data_version', { simple: true }));
  }

  /**
   * Returns the highest sequence number currently stored in sync_outbox (or 0 if empty).
   */
  getLatestOutboxSeq(): number {
    const db = this.getDb();
    const row = db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM sync_outbox')
      .get() as { max_seq: number };
    return Number(row.max_seq);
  }

  /**
   * Lists sync_outbox entries with seq strictly greater than afterSeq in ascending order.
   */
  listOutboxSince(afterSeq: number, limit = 200): SyncOutboxEntry[] {
    const db = this.getDb();
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = db
      .prepare('SELECT * FROM sync_outbox WHERE seq > ? ORDER BY seq ASC LIMIT ?')
      .all(afterSeq, safeLimit) as OutboxRow[];
    return rows.map(mapOutboxRow);
  }

  /**
   * Reports whether an outbox sequence number was inserted by this adapter instance.
   */
  isOwnOutboxSeq(seq: number): boolean {
    return this.ownOutboxSeqs.has(seq);
  }

  /**
   * Releases tracked in-process outbox sequence numbers up to and including seq.
   */
  pruneOwnOutboxSeqsUpTo(seq: number): void {
    for (const tracked of this.ownOutboxSeqs) {
      if (tracked <= seq) {
        this.ownOutboxSeqs.delete(tracked);
      }
    }
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
