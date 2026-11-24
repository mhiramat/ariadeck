import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InMemoryStorageAdapter } from '@ariadeck/core';
import { createMobileStore, useMobileStore } from '../../store/useMobileStore.ts';
import { MobileTimelineView } from '../MobileTimelineView.tsx';
import { BottomNavBar } from '../BottomNavBar.tsx';

describe('Android Phase 2 UI & Store', () => {
  beforeEach(async () => {
    const store = createMobileStore(new InMemoryStorageAdapter());
    await store.getState().initialize();
    useMobileStore.setState(store.getState());
  });

  it('prompts for jump-back loop on reverse connection in flow boards and supports flat edge sheet', async () => {
    const store = createMobileStore(new InMemoryStorageAdapter());
    await store.getState().initialize();

    const c1 = (await store.getState().createCard('Step 1', 'task'))!;
    const c2 = (await store.getState().createCard('Step 2', 'task'))!;

    store.getState().setRelationToolMode('connect');
    await store.getState().handleRelationCardTap(c1.id);
    await store.getState().handleRelationCardTap(c2.id);
    expect(store.getState().graph?.edges).toHaveLength(1);

    // Reverse tap c2 -> c1 triggers automatic jump-back prompt instead of failing silently
    await store.getState().handleRelationCardTap(c2.id);
    await store.getState().handleRelationCardTap(c1.id);
    expect(store.getState().pendingJumpBack).toEqual({
      sourceId: c2.id,
      targetId: c1.id,
    });

    await store.getState().connectCards(c2.id, c1.id, 'jump_back', {
      label: 'Retry',
      styleVariant: 'dashed',
    });
    expect(store.getState().pendingJumpBack).toBeNull();
    expect(store.getState().graph?.edges.some((e) => e.relationType === 'jump_back')).toBe(true);

    // Create a flat board and verify tapping opens pendingFlatEdge sheet
    await store.getState().createBoard('Characters', 'flat');
    expect(store.getState().graph?.board.boardType).toBe('flat');

    const a = (await store.getState().createCard('Alice', 'idea'))!;
    const b = (await store.getState().createCard('Bob', 'idea'))!;
    store.getState().setRelationToolMode('connect');
    await store.getState().handleRelationCardTap(a.id);
    await store.getState().handleRelationCardTap(b.id);
    expect(store.getState().pendingFlatEdge).toEqual({ sourceId: a.id, targetId: b.id });
  });

  it('disables Timeline tab in BottomNavBar on flat boards and renders jump-back chips on flow boards', async () => {
    const store = createMobileStore(new InMemoryStorageAdapter());
    await store.getState().initialize();
    const c1 = (await store.getState().createCard('Start', 'plot_event'))!;
    const c2 = (await store.getState().createCard('Trap', 'plot_event'))!;
    await store.getState().connectCards(c1.id, c2.id, 'causes');
    await store.getState().connectCards(c2.id, c1.id, 'jump_back', { label: 'Reset' });
    await store.getState().computeTimelineLayout();

    useMobileStore.setState(store.getState());
    const { rerender } = render(<MobileTimelineView />);
    expect(screen.getByText(/Jumps back to: Start \(Reset\)/)).toBeInTheDocument();

    // Switch to flat board and verify BottomNavBar disables Timeline tab
    await store.getState().createBoard('Network', 'flat');
    useMobileStore.setState(store.getState());
    rerender(<BottomNavBar />);
    await waitFor(() => {
      const timelineBtn = screen.getByRole('button', { name: /Timeline/i });
      expect(timelineBtn).toBeDisabled();
    });
  });
});
