import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useMobileStore } from '../store/useMobileStore.ts';
import { ListModeView } from '../components/ListModeView.tsx';
import { CardEditorView } from '../components/CardEditorView.tsx';
import { MobileTimelineView } from '../components/MobileTimelineView.tsx';
import { BottomNavBar } from '../components/BottomNavBar.tsx';

describe('Android Mobile UI Components', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await useMobileStore.getState().initialize();
    await useMobileStore.getState().createBoard(`Test Board ${Math.random()}`);
  });

  it('searches across card titles and attachment transcripts in ListModeView', async () => {
    const store = useMobileStore.getState();
    const cardA = await store.createCard('Harbor Scene', 'plot_event');
    await store.createCard('Train Station', 'idea');

    await store.addAttachment({
      cardId: cardA!.id,
      kind: 'audio',
      localUri: 'media/memo.m4a',
      mimeType: 'audio/mp4',
      fileSize: 1024,
      durationMs: 2000,
      transcript: 'Mysterious lighthouse bell rings three times',
    });

    useMobileStore.setState({ activeMode: 'list', searchQuery: '', filterType: 'all' });

    render(<ListModeView />);

    expect(screen.getByText('Harbor Scene')).toBeInTheDocument();
    expect(screen.getByText('Train Station')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search cards and transcripts'), {
      target: { value: 'lighthouse' },
    });

    expect(screen.getByText('Harbor Scene')).toBeInTheDocument();
    expect(screen.queryByText('Train Station')).not.toBeInTheDocument();
  });

  it('edits card fields and connects prerequisite relations in CardEditorView', async () => {
    const store = useMobileStore.getState();
    const prereq = await store.createCard('Gather Clues', 'task');
    const target = await store.createCard('Solve Mystery', 'task');

    useMobileStore.setState({ activeMode: 'edit', selectedCardId: target!.id });

    render(<CardEditorView />);

    expect(screen.getByLabelText('Title')).toHaveValue('Solve Mystery');

    fireEvent.change(screen.getByLabelText('Add prerequisite'), {
      target: { value: prereq!.id },
    });
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons[0]!);

    await waitFor(() => {
      const edges = useMobileStore.getState().graph?.edges ?? [];
      expect(edges.some((e) => e.sourceCardId === prereq!.id && e.targetCardId === target!.id)).toBe(
        true
      );
    });
  });

  it('switches modes via BottomNavBar and prevents accidental connections in Pan mode', async () => {
    const store = useMobileStore.getState();
    const c1 = await store.createCard('Card One', 'idea');
    const c2 = await store.createCard('Card Two', 'idea');

    // In Pan mode, tapping cards does not create edges
    useMobileStore.setState({ relationToolMode: 'pan' });
    await useMobileStore.getState().handleRelationCardTap(c1!.id);
    await useMobileStore.getState().handleRelationCardTap(c2!.id);
    expect(useMobileStore.getState().graph?.edges ?? []).toHaveLength(0);

    // In Connect mode, tapping Card 1 then Card 2 creates an edge
    useMobileStore.getState().setRelationToolMode('connect');
    await useMobileStore.getState().handleRelationCardTap(c1!.id);
    await useMobileStore.getState().handleRelationCardTap(c2!.id);
    expect(useMobileStore.getState().graph?.edges ?? []).toHaveLength(1);

    render(<BottomNavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(useMobileStore.getState().activeMode).toBe('timeline');
  });

  it('renders vertical timeline steps and highlights dependency violations in MobileTimelineView', async () => {
    const store = useMobileStore.getState();
    const first = await store.createCard('Step A', 'task');
    const second = await store.createCard('Step B', 'task');
    await store.connectCards(first!.id, second!.id, 'blocks');

    // Force an out-of-order timeline placement
    await store.moveCardToTimelineStep(first!.id, 2);
    await store.moveCardToTimelineStep(second!.id, 0);

    render(<MobileTimelineView />);

    expect(screen.getByRole('alert')).toHaveTextContent('1 Dependency Violation(s)');
    expect(screen.getByText('Step A')).toBeInTheDocument();
    expect(screen.getByText('Step B')).toBeInTheDocument();
  });
});
