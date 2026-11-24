import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Board, BoardGraph, Card, Edge } from '@ariadeck/core';
import { useBoardStore } from '../../store/useBoardStore.ts';
import { TimelineView } from '../TimelineView.tsx';

const NOW = '2026-01-01T00:00:00.000Z';

const board: Board = {
  id: 'board-1',
  title: 'Timeline Board',
  description: '',
  createdAt: NOW,
  updatedAt: NOW,
  updatedByDeviceId: 'ariadeck-test',
  version: 1,
  deletedAt: null,
};

function makeCard(id: string, title: string, timelineOrder: number | null): Card {
  return {
    id,
    boardId: board.id,
    title,
    content: '**Details** for ' + title,
    cardType: 'task',
    status: 'todo',
    tags: [],
    posX: 0,
    posY: 0,
    timelineOrder,
    startAt: null,
    endAt: null,
    splitFromCardId: null,
    mergedFromCardIds: null,
    replacedByCardIds: null,
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

function makeEdge(id: string, sourceCardId: string, targetCardId: string): Edge {
  return {
    id,
    boardId: board.id,
    sourceCardId,
    targetCardId,
    relationType: 'blocks',
    isConflicted: false,
    conflictReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  };
}

describe('TimelineView', () => {
  beforeEach(() => {
    const graph: BoardGraph = {
      board,
      cards: [makeCard('c1', 'Design', 0), makeCard('c2', 'Build', 1)],
      edges: [makeEdge('e1', 'c1', 'c2')],
      attachments: [],
    };
    useBoardStore.setState({
      boards: [board],
      activeBoardId: board.id,
      graph,
      selectedCardId: null,
      viewMode: 'timeline',
      connectionStatus: 'connected',
      loading: false,
      toasts: [],
    });
  });

  it('renders timeline step columns and triggers computeTimelineLayout on Auto-Sort click', () => {
    const computeSpy = vi.fn().mockResolvedValue(undefined);
    useBoardStore.setState({ computeTimelineLayout: computeSpy });

    render(<TimelineView />);

    expect(screen.getByRole('heading', { name: 'Step 0' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 1' })).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Auto-Sort Timeline/i }));
    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it('highlights real-time dependency violations when a card is ahead of its prerequisite', () => {
    useBoardStore.setState({
      graph: {
        board,
        cards: [makeCard('c1', 'Design', 2), makeCard('c2', 'Build', 1)],
        edges: [makeEdge('e1', 'c1', 'c2')],
        attachments: [],
      },
    });

    render(<TimelineView />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Dependency Order Violations Detected');
    expect(alert).toHaveTextContent('"Design" (Step 2) must precede "Build" (Step 1).');
  });

  it('moves a card to a different step using the step navigation buttons', () => {
    const moveSpy = vi.fn().mockResolvedValue(undefined);
    useBoardStore.setState({ moveCardToTimelineStep: moveSpy });

    render(<TimelineView />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Design to later step' }));
    expect(moveSpy).toHaveBeenCalledWith('c1', 1);
  });

  it('renders jump_back SVG return arcs with Show Loops toggle', () => {
    const currentGraph = useBoardStore.getState().graph!;
    useBoardStore.setState({
      graph: {
        ...currentGraph,
        edges: [
          ...currentGraph.edges,
          {
            id: 'e-loop',
            boardId: 'board-1',
            sourceCardId: 'c2',
            targetCardId: 'c1',
            relationType: 'jump_back',
            direction: 'directed',
            label: 'Retry flow',
            styleVariant: 'dashed',
            color: null,
            isConflicted: false,
            conflictReason: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedByDeviceId: 'ariadeck-test',
            version: 1,
            deletedAt: null,
          },
        ],
      },
    });

    render(<TimelineView />);
    expect(screen.getByLabelText('Jump-back return arcs')).toBeInTheDocument();
    expect(screen.getByText(/Retry flow/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Show Loops/i }));
    expect(screen.queryByLabelText('Jump-back return arcs')).not.toBeInTheDocument();
  });
});
