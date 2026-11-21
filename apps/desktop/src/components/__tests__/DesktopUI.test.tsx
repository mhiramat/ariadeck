import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Board, BoardGraph, Card } from '@ariadeck/core';
import { useBoardStore } from '../../store/useBoardStore.ts';
import { AppHeader } from '../AppHeader.tsx';
import { InspectorPanel } from '../InspectorPanel.tsx';

const NOW = '2026-01-01T00:00:00.000Z';

const sampleBoard: Board = {
  id: 'board-1',
  title: 'Story Arc',
  description: '',
  createdAt: NOW,
  updatedAt: NOW,
  updatedByDeviceId: 'ariadeck-test',
  version: 1,
  deletedAt: null,
};

const sampleCard: Card = {
  id: 'card-1',
  boardId: 'board-1',
  title: 'Hero Journey',
  content: 'Initial draft',
  cardType: 'plot_event',
  status: 'todo',
  tags: ['act1'],
  posX: 120,
  posY: 80,
  timelineOrder: null,
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

const sampleGraph: BoardGraph = {
  board: sampleBoard,
  cards: [sampleCard],
  edges: [],
  attachments: [],
};

describe('Desktop UI Components', () => {
  beforeEach(() => {
    useBoardStore.setState({
      boards: [sampleBoard],
      activeBoardId: sampleBoard.id,
      graph: sampleGraph,
      selectedCardId: sampleCard.id,
      viewMode: 'graph',
      connectionStatus: 'connected',
      loading: false,
      toasts: [],
    });
  });

  it('renders AppHeader with board selector, MCP status, and view mode switch', () => {
    render(<AppHeader />);

    expect(screen.getByText('Ariadeck')).toBeInTheDocument();
    expect(screen.getByText('MCP Live')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Select board' })).toHaveValue('board-1');

    const timelineTab = screen.getByRole('tab', { name: /Timeline/i });
    fireEvent.click(timelineTab);
    expect(useBoardStore.getState().viewMode).toBe('timeline');
  });

  it('renders InspectorPanel for the selected card and submits updates and splits', async () => {
    const updateCardSpy = vi.fn().mockResolvedValue(undefined);
    const splitCardSpy = vi.fn().mockResolvedValue(undefined);
    const deleteCardSpy = vi.fn().mockResolvedValue(undefined);

    useBoardStore.setState({
      updateCard: updateCardSpy,
      splitCard: splitCardSpy,
      deleteCard: deleteCardSpy,
    });

    render(<InspectorPanel />);

    const titleInput = screen.getByLabelText('Title');
    expect(titleInput).toHaveValue('Hero Journey');

    fireEvent.change(titleInput, { target: { value: 'Hero Journey Revised' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    expect(updateCardSpy).toHaveBeenCalledWith(
      'card-1',
      expect.objectContaining({
        title: 'Hero Journey Revised',
        cardType: 'plot_event',
        tags: ['act1'],
      })
    );

    // Trigger manual split
    fireEvent.click(screen.getByRole('button', { name: /Split Card/i }));
    fireEvent.change(screen.getByLabelText('Child card titles'), {
      target: { value: 'Departure\nTrials' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Execute Split/i }));

    await waitFor(() => {
      expect(splitCardSpy).toHaveBeenCalledWith(
        'card-1',
        [
          { title: 'Departure', content: '' },
          { title: 'Trials', content: '' },
        ],
        'sequential'
      );
      expect(screen.queryByLabelText('Child card titles')).not.toBeInTheDocument();
    });

    // Trigger delete
    fireEvent.click(screen.getByRole('button', { name: /Delete Card/i }));
    expect(deleteCardSpy).toHaveBeenCalledWith('card-1');
  });

  it('toggles InspectorPanel between Write and rendered Markdown Preview', () => {
    useBoardStore.setState({
      graph: {
        ...sampleGraph,
        cards: [
          {
            ...sampleCard,
            content: '### Plot Summary\n\n- **Act 1**: Call to adventure',
          },
        ],
      },
    });

    render(<InspectorPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    expect(screen.getByRole('heading', { level: 3, name: 'Plot Summary' })).toBeInTheDocument();
    expect(screen.getByText('Act 1').tagName).toBe('STRONG');

    fireEvent.click(screen.getByRole('button', { name: /Write/i }));
    expect(screen.getByLabelText('Markdown Content')).toBeInTheDocument();
  });
});
