export type GraphEventType =
  | 'board:created'
  | 'board:updated'
  | 'board:deleted'
  | 'card:created'
  | 'card:updated'
  | 'card:deleted'
  | 'card:split'
  | 'card:merged'
  | 'edge:created'
  | 'edge:deleted';

export interface GraphEvent {
  type: GraphEventType;
  boardId: string;
  entityIds: string[];
  deviceId: string;
  timestamp: string;
}

export type GraphEventListener = (event: GraphEvent) => void;

/**
 * Lightweight, platform-agnostic event bus used by BoardGraphService to notify
 * local subscribers and SSE/MCP bridges whenever board state changes.
 */
export class GraphEventBus {
  private readonly listeners = new Set<GraphEventListener>();

  /**
   * Registers a listener for all graph events and returns an unsubscribe function.
   */
  subscribe(listener: GraphEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emits a graph event to all active subscribers.
   */
  emit(event: GraphEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  /**
   * Returns the number of currently registered listeners.
   */
  listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Removes all registered listeners.
   */
  clear(): void {
    this.listeners.clear();
  }
}
