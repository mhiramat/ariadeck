import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ConflictRecord } from '@ariadeck/core';
import { useBoardStore } from '../../store/useBoardStore.ts';
import { ConflictResolverModal } from '../ConflictResolverModal.tsx';

const NOW = '2026-06-01T12:00:00.000Z';

const cardConflict: ConflictRecord = {
  id: 'conf-1',
  boardId: 'board-1',
  entityType: 'card',
  entityId: 'card-1',
  conflictType: 'content_collision',
  localSnapshotJson: JSON.stringify({
    id: 'card-1',
    title: 'Local Draft',
    content: 'Local notes',
  }),
  remoteSnapshotJson: JSON.stringify({
    id: 'card-1',
    title: 'Remote Draft',
    content: 'Remote notes',
  }),
  resolvedAt: null,
  createdAt: NOW,
};

const cycleConflict: ConflictRecord = {
  id: 'conf-2',
  boardId: 'board-1',
  entityType: 'edge',
  entityId: 'edge-9',
  conflictType: 'cyclic_edge',
  localSnapshotJson: JSON.stringify({
    id: 'edge-9',
    sourceCardId: 'card-b',
    targetCardId: 'card-a',
  }),
  remoteSnapshotJson: '[]',
  resolvedAt: null,
  createdAt: NOW,
};

describe('ConflictResolverModal', () => {
  beforeEach(() => {
    useBoardStore.setState({
      conflictModalOpen: true,
      conflicts: [cardConflict, cycleConflict],
    });
  });

  it('displays local vs remote snapshots and dispatches resolution actions', () => {
    const resolveSpy = vi.fn().mockResolvedValue(undefined);
    useBoardStore.setState({ resolveConflict: resolveSpy });

    render(<ConflictResolverModal />);

    expect(screen.getByText('Sync Conflicts (2)')).toBeInTheDocument();
    expect(screen.getByText('Local Draft')).toBeInTheDocument();
    expect(screen.getByText('Remote Draft')).toBeInTheDocument();
    expect(screen.getByText('Cyclic Dependency Edge')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep Remote' }));
    expect(resolveSpy).toHaveBeenCalledWith('conf-1', { strategy: 'keep_remote' });

    fireEvent.click(screen.getByRole('button', { name: /Remove Conflicted Edge/i }));
    expect(resolveSpy).toHaveBeenCalledWith('conf-2', { strategy: 'delete_edge' });
  });
});
