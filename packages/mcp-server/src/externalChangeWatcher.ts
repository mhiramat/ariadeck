import type {
  ExternalChangeSource,
  GraphEvent,
  GraphEventBus,
  GraphEventType,
  SyncOutboxEntry,
} from '@ariadeck/core';

export const DEFAULT_EXTERNAL_CHANGE_POLL_MS = 350;
const DEFAULT_OUTBOX_BATCH_SIZE = 200;

export interface ExternalChangeWatcherOptions {
  pollIntervalMs?: number;
  batchSize?: number;
  onError?: (error: unknown) => void;
}

interface ParsedOutboxMetadata {
  deviceId: string | null;
  cardId: string | null;
}

function parseOutboxPayloadMetadata(payloadJson: string): ParsedOutboxMetadata {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return { deviceId: null, cardId: null };
    }
    const deviceId =
      typeof parsed.updatedByDeviceId === 'string' && parsed.updatedByDeviceId.trim().length > 0
        ? parsed.updatedByDeviceId.trim()
        : null;
    const cardId =
      typeof parsed.cardId === 'string' && parsed.cardId.trim().length > 0
        ? parsed.cardId.trim()
        : null;
    return { deviceId, cardId };
  } catch {
    return { deviceId: null, cardId: null };
  }
}

function mapOutboxEntryToEventType(entry: SyncOutboxEntry): GraphEventType {
  switch (entry.entityType) {
    case 'board':
      if (entry.operation === 'create') return 'board:created';
      if (entry.operation === 'delete') return 'board:deleted';
      return 'board:updated';
    case 'card':
      if (entry.operation === 'create') return 'card:created';
      if (entry.operation === 'delete') return 'card:deleted';
      if (entry.operation === 'split') return 'card:split';
      if (entry.operation === 'merge') return 'card:merged';
      return 'card:updated';
    case 'edge':
      if (entry.operation === 'create') return 'edge:created';
      if (entry.operation === 'delete') return 'edge:deleted';
      return 'board:updated';
    case 'attachment':
      return 'card:updated';
    default:
      return 'board:updated';
  }
}

function selectRepresentativeEventType(entries: SyncOutboxEntry[]): GraphEventType {
  if (entries.some((e) => e.entityType === 'board' && e.operation === 'delete')) {
    return 'board:deleted';
  }
  if (entries.some((e) => e.entityType === 'board' && e.operation === 'create')) {
    return 'board:created';
  }
  if (entries.some((e) => e.entityType === 'card' && e.operation === 'split')) {
    return 'card:split';
  }
  if (entries.some((e) => e.entityType === 'card' && e.operation === 'merge')) {
    return 'card:merged';
  }
  if (entries.some((e) => e.entityType === 'board' && e.operation === 'update')) {
    return 'board:updated';
  }

  const mappedTypes = entries.map(mapOutboxEntryToEventType);
  const uniqueTypes = new Set(mappedTypes);
  if (uniqueTypes.size === 1) {
    return mappedTypes[0]!;
  }
  if (uniqueTypes.has('card:deleted')) {
    return 'card:deleted';
  }
  if (uniqueTypes.has('card:created')) {
    return 'card:created';
  }
  return 'board:updated';
}

/**
 * Coalesces a batch of external sync_outbox rows into one GraphEvent per
 * affected board so multi-row transactions (e.g. split_card, merge_cards,
 * delete_card cascade, import_board_json) trigger a single UI refresh.
 */
export function coalesceOutboxEntriesToGraphEvents(entries: SyncOutboxEntry[]): GraphEvent[] {
  if (entries.length === 0) {
    return [];
  }

  const byBoard = new Map<string, SyncOutboxEntry[]>();
  for (const entry of entries) {
    const list = byBoard.get(entry.boardId);
    if (list) {
      list.push(entry);
    } else {
      byBoard.set(entry.boardId, [entry]);
    }
  }

  const events: GraphEvent[] = [];
  for (const [boardId, boardEntries] of byBoard.entries()) {
    const entityIdSet = new Set<string>();
    let deviceId: string | null = null;

    for (const entry of boardEntries) {
      const meta = parseOutboxPayloadMetadata(entry.payloadJson);
      if (!deviceId && meta.deviceId) {
        deviceId = meta.deviceId;
      }
      if (entry.entityType === 'attachment' && meta.cardId) {
        entityIdSet.add(meta.cardId);
      } else {
        entityIdSet.add(entry.entityId);
      }
    }

    const lastEntry = boardEntries[boardEntries.length - 1]!;
    events.push({
      type: selectRepresentativeEventType(boardEntries),
      boardId,
      entityIds: Array.from(entityIdSet),
      deviceId: deviceId ?? 'external',
      timestamp: lastEntry.createdAt,
    });
  }

  return events;
}

/**
 * Watches a shared SQLite database for commits performed by external processes
 * (such as stdio MCP workers) using PRAGMA data_version and replays new
 * sync_outbox entries onto the local GraphEventBus.
 */
export class ExternalChangeWatcher {
  private readonly source: ExternalChangeSource;
  private readonly eventBus: GraphEventBus;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly onError?: (error: unknown) => void;

  private initialized = false;
  private lastDataVersion = 0;
  private lastSeenSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    source: ExternalChangeSource,
    eventBus: GraphEventBus,
    options: ExternalChangeWatcherOptions = {}
  ) {
    this.source = source;
    this.eventBus = eventBus;
    this.pollIntervalMs = Math.max(20, options.pollIntervalMs ?? DEFAULT_EXTERNAL_CHANGE_POLL_MS);
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_OUTBOX_BATCH_SIZE);
    this.onError = options.onError;
  }

  /**
   * Aligns the watcher cursor with the current database state so previously
   * committed outbox rows are not replayed as new notifications.
   */
  syncCursor(): void {
    this.lastDataVersion = this.source.getDataVersion();
    this.lastSeenSeq = this.source.getLatestOutboxSeq();
    this.source.pruneOwnOutboxSeqsUpTo?.(this.lastSeenSeq);
    this.initialized = true;
  }

  /**
   * Checks whether another connection committed changes to SQLite and emits
   * coalesced GraphEvents for any new external sync_outbox rows.
   */
  poll(): GraphEvent[] {
    if (!this.initialized) {
      this.syncCursor();
      return [];
    }

    const currentVersion = this.source.getDataVersion();
    if (currentVersion === this.lastDataVersion) {
      return [];
    }
    this.lastDataVersion = currentVersion;

    const externalEntries: SyncOutboxEntry[] = [];
    let cursor = this.lastSeenSeq;

    for (;;) {
      const batch = this.source.listOutboxSince(cursor, this.batchSize);
      if (batch.length === 0) {
        break;
      }
      for (const entry of batch) {
        cursor = entry.seq;
        if (!this.source.isOwnOutboxSeq(entry.seq)) {
          externalEntries.push(entry);
        }
      }
      if (batch.length < this.batchSize) {
        break;
      }
    }

    this.lastSeenSeq = cursor;
    this.source.pruneOwnOutboxSeqsUpTo?.(cursor);

    if (externalEntries.length === 0) {
      return [];
    }

    const events = coalesceOutboxEntriesToGraphEvents(externalEntries);
    for (const event of events) {
      this.eventBus.emit(event);
    }
    return events;
  }

  /**
   * Starts periodic polling if not already active.
   */
  start(options: { syncCursorFirst?: boolean } = {}): void {
    if (this.timer) {
      return;
    }
    if (!this.initialized || options.syncCursorFirst) {
      this.syncCursor();
    }
    this.timer = setInterval(() => {
      try {
        this.poll();
      } catch (error) {
        this.onError?.(error);
      }
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  /**
   * Stops periodic polling.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}
