import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Board } from '@ariadeck/core';
import { useBoardStore } from '../../store/useBoardStore.ts';
import { BoardListPanel } from '../BoardListPanel.tsx';

const NOW = '2026-01-01T00:00:00.000Z';

const boards: Board[] = [
  {
    id: 'board-1',
    title: 'Product Roadmap',
    description: 'Q2 engineering deliverables',
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  },
  {
    id: 'board-2',
    title: 'Story Plot',
    description: 'Chapter outline',
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
  },
];

describe('BoardListPanel', () => {
  beforeEach(() => {
    useBoardStore.setState({
      boards,
      activeBoardId: 'board-1',
      boardListOpen: true,
    });
  });

  it('lists all boards and switches active board on click', () => {
    const selectBoardSpy = vi.fn().mockResolvedValue(undefined);
    useBoardStore.setState({ selectBoard: selectBoardSpy });

    render(<BoardListPanel />);

    expect(screen.getByText('Boards (2)')).toBeInTheDocument();
    expect(screen.getByText('Product Roadmap')).toBeInTheDocument();
    expect(screen.getByText('Story Plot')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Story Plot'));
    expect(selectBoardSpy).toHaveBeenCalledWith('board-2');
  });

  it('renames a board inline and updates its description', async () => {
    const updateBoardSpy = vi.fn().mockResolvedValue(boards[0]);
    useBoardStore.setState({ updateBoard: updateBoardSpy });

    render(<BoardListPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename Product Roadmap' }));

    const titleInput = screen.getByLabelText('Board title');
    const descInput = screen.getByLabelText('Board description');
    fireEvent.change(titleInput, { target: { value: 'Q3 Roadmap' } });
    fireEvent.change(descInput, { target: { value: 'Updated scope' } });

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(updateBoardSpy).toHaveBeenCalledWith('board-1', {
        title: 'Q3 Roadmap',
        description: 'Updated scope',
      });
    });
  });

  it('creates a new board and deletes an existing board', async () => {
    const createBoardSpy = vi.fn().mockResolvedValue(boards[0]);
    const deleteBoardSpy = vi.fn().mockResolvedValue(undefined);
    useBoardStore.setState({
      createBoard: createBoardSpy,
      deleteBoard: deleteBoardSpy,
    });

    render(<BoardListPanel />);

    fireEvent.change(screen.getByLabelText('New board title'), {
      target: { value: 'Research Notes' },
    });
    fireEvent.change(screen.getByLabelText('New board description'), {
      target: { value: 'Literature links' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Board/i }));

    await waitFor(() => {
      expect(createBoardSpy).toHaveBeenCalledWith('Research Notes', 'Literature links', 'flow');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Story Plot' }));
    expect(deleteBoardSpy).toHaveBeenCalledWith('board-2');
  });
});
