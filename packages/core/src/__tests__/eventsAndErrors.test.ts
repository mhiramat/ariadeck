import { describe, it, expect, vi } from 'vitest';
import {
  AriadeckError,
  CyclicDependencyError,
  NotFoundError,
  ValidationError,
} from '../errors.js';
import { GraphEventBus, type GraphEvent } from '../events/GraphEventBus.js';

describe('Domain Errors', () => {
  it('constructs CyclicDependencyError with self-loop message', () => {
    const err = new CyclicDependencyError('card-1', 'card-1');
    expect(err).toBeInstanceOf(AriadeckError);
    expect(err).toBeInstanceOf(CyclicDependencyError);
    expect(err.code).toBe('CYCLIC_DEPENDENCY');
    expect(err.message).toContain('self-loops');
  });

  it('constructs CyclicDependencyError with cycle message for distinct cards', () => {
    const err = new CyclicDependencyError('card-a', 'card-b');
    expect(err.sourceCardId).toBe('card-a');
    expect(err.targetCardId).toBe('card-b');
    expect(err.message).toContain('introduce a cycle');
  });

  it('constructs NotFoundError and ValidationError with expected codes', () => {
    const notFound = new NotFoundError('Card', 'card-42');
    expect(notFound.code).toBe('NOT_FOUND');
    expect(notFound.message).toContain('card-42');

    const validation = new ValidationError('Title must not be empty');
    expect(validation.code).toBe('VALIDATION_ERROR');
    expect(validation.message).toBe('Title must not be empty');
  });
});

describe('GraphEventBus', () => {
  it('notifies subscribers and supports unsubscribing', () => {
    const bus = new GraphEventBus();
    const received: GraphEvent[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    const sampleEvent: GraphEvent = {
      type: 'card:created',
      boardId: 'board-1',
      entityIds: ['card-1'],
      deviceId: 'ariadeck-test',
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    expect(bus.listenerCount()).toBe(1);
    bus.emit(sampleEvent);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(sampleEvent);

    unsubscribe();
    expect(bus.listenerCount()).toBe(0);
    bus.emit(sampleEvent);
    expect(received).toHaveLength(1);
  });

  it('clears all registered listeners', () => {
    const bus = new GraphEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
    bus.emit({
      type: 'board:updated',
      boardId: 'board-1',
      entityIds: ['board-1'],
      deviceId: 'ariadeck-test',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
