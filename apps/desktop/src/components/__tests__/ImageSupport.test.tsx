import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { Board, BoardGraph, Card, CardAttachment } from '@ariadeck/core';
import { useBoardStore } from '../../store/useBoardStore.ts';
import { IdeaCardNode, type IdeaCardFlowNode } from '../IdeaCardNode.tsx';
import { ImageLightboxModal } from '../ImageLightboxModal.tsx';
import { InspectorPanel } from '../InspectorPanel.tsx';

const NOW = '2026-11-26T00:00:00.000Z';

const sampleBoard: Board = {
  id: 'board-1',
  title: 'Storyboard',
  description: '',
  boardType: 'flow',
  createdAt: NOW,
  updatedAt: NOW,
  updatedByDeviceId: 'ariadeck-test',
  version: 1,
  deletedAt: null,
};

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: 'board-1',
    title: 'Elena Portrait',
    content: 'Winter cloak reference',
    cardType: 'idea',
    displayMode: 'image_cover',
    status: 'todo',
    tags: ['character'],
    posX: 100,
    posY: 100,
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
    ...overrides,
  };
}

function makeImageAttachment(overrides: Partial<CardAttachment> = {}): CardAttachment {
  return {
    id: 'att-1',
    cardId: 'card-1',
    boardId: 'board-1',
    kind: 'image',
    localUri: 'originals/abcd.png',
    remoteFileId: null,
    mimeType: 'image/png',
    fileSize: 45_000,
    sha256: 'a'.repeat(64),
    width: 1024,
    height: 768,
    thumbnailUri: 'thumbs/abcd.webp',
    caption: 'Portrait in snow',
    isCover: true,
    sortOrder: 0,
    durationMs: null,
    transcript: null,
    syncStatus: 'local_only',
    createdAt: NOW,
    updatedAt: NOW,
    updatedByDeviceId: 'ariadeck-test',
    version: 1,
    deletedAt: null,
    ...overrides,
  };
}

function renderIdeaCard(
  card: Card,
  attachments: CardAttachment[],
  callbacks: {
    onRename?: (cardId: string, title: string) => void;
    onOpenLightbox?: (cardId: string, attachmentId: string) => void;
    onDropImageFiles?: (cardId: string, files: File[]) => void;
  } = {}
) {
  const props = {
    id: card.id,
    type: 'ideaCard',
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: card.posX,
    positionAbsoluteY: card.posY,
    data: {
      card,
      attachmentCount: attachments.length,
      imageAttachments: attachments,
      onRename: callbacks.onRename ?? vi.fn(),
      onOpenLightbox: callbacks.onOpenLightbox ?? vi.fn(),
      onDropImageFiles: callbacks.onDropImageFiles ?? vi.fn(),
    },
  } as unknown as NodeProps<IdeaCardFlowNode>;

  return render(
    <ReactFlowProvider>
      <IdeaCardNode {...props} />
    </ReactFlowProvider>
  );
}

describe('Desktop Image Card, Inspector Gallery, and Lightbox UX', () => {
  const att1 = makeImageAttachment({ id: 'att-1', isCover: true, sortOrder: 0, caption: 'First shot' });
  const att2 = makeImageAttachment({
    id: 'att-2',
    isCover: false,
    sortOrder: 1,
    caption: 'Second angle',
  });

  beforeEach(() => {
    const card = makeCard({ displayMode: 'image_cover' });
    const graph: BoardGraph = {
      board: sampleBoard,
      cards: [card],
      edges: [],
      attachments: [att1, att2],
    };
    useBoardStore.setState({
      boards: [sampleBoard],
      activeBoardId: sampleBoard.id,
      graph,
      selectedCardId: card.id,
      lightboxState: null,
      viewMode: 'graph',
      connectionStatus: 'connected',
      loading: false,
      toasts: [],
    });
  });

  it('renders IdeaCardNode across standard, image_cover, and image_only modes and opens lightbox on double-click or inspect button', () => {
    const onOpenLightbox = vi.fn();

    // 1. image_cover mode
    const { unmount } = renderIdeaCard(makeCard({ displayMode: 'image_cover' }), [att1, att2], {
      onOpenLightbox,
    });
    const coverImg = screen.getByRole('img', { name: 'First shot' });
    expect(coverImg).toHaveAttribute('src', '/api/media/attachments/att-1/thumb');
    fireEvent.doubleClick(coverImg);
    expect(onOpenLightbox).toHaveBeenCalledWith('card-1', 'att-1');

    fireEvent.click(screen.getByRole('button', { name: /Inspect image for Elena Portrait/i }));
    expect(onOpenLightbox).toHaveBeenCalledTimes(2);
    unmount();

    // 2. image_only mode
    onOpenLightbox.mockClear();
    const { unmount: unmountOnly } = renderIdeaCard(
      makeCard({ displayMode: 'image_only' }),
      [att1],
      { onOpenLightbox }
    );
    expect(screen.getByText('Elena Portrait')).toBeInTheDocument();
    const onlyImg = screen.getByRole('img', { name: 'First shot' });
    fireEvent.doubleClick(onlyImg);
    expect(onOpenLightbox).toHaveBeenCalledWith('card-1', 'att-1');
    unmountOnly();

    // 3. standard mode renders compact thumbnail strip
    onOpenLightbox.mockClear();
    renderIdeaCard(makeCard({ displayMode: 'standard' }), [att1, att2], { onOpenLightbox });
    const stripButtons = screen.getAllByRole('button', { name: /Inspect image/i });
    expect(stripButtons).toHaveLength(2);
    fireEvent.click(stripButtons[1]!);
    expect(onOpenLightbox).toHaveBeenCalledWith('card-1', 'att-2');
  });

  it('forwards dropped JPEG/PNG files on an existing IdeaCardNode to onDropImageFiles', () => {
    const onDropImageFiles = vi.fn();
    renderIdeaCard(makeCard({ displayMode: 'standard' }), [], { onDropImageFiles });

    const cardEl = screen.getByText('Elena Portrait').closest('[data-display-mode]')!;
    const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'sketch.png', {
      type: 'image/png',
    });

    fireEvent.drop(cardEl, {
      dataTransfer: {
        types: ['Files'],
        files: [pngFile],
      },
    });
    expect(onDropImageFiles).toHaveBeenCalledWith('card-1', [pngFile]);
  });

  it('manages displayMode, uploads, cover toggle, captions, reordering, and deletion in InspectorPanel', async () => {
    const updateCardSpy = vi.fn().mockResolvedValue(undefined);
    const attachSpy = vi.fn().mockResolvedValue(null);
    const updateAttSpy = vi.fn().mockResolvedValue(null);
    const reorderSpy = vi.fn().mockResolvedValue(undefined);
    const removeSpy = vi.fn().mockResolvedValue(undefined);

    useBoardStore.setState({
      updateCard: updateCardSpy,
      attachImageToCard: attachSpy,
      updateAttachment: updateAttSpy,
      reorderCardAttachments: reorderSpy,
      removeAttachment: removeSpy,
    });

    render(<InspectorPanel />);

    // Change displayMode to image_only
    fireEvent.change(screen.getByLabelText('Display Mode'), {
      target: { value: 'image_only' },
    });
    expect(updateCardSpy).toHaveBeenCalledWith('card-1', { displayMode: 'image_only' });

    // Upload a new PNG via hidden file input
    const uploadFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'scene.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('Upload card images'), {
      target: { files: [uploadFile] },
    });
    await waitFor(() => {
      expect(attachSpy).toHaveBeenCalledWith('card-1', uploadFile);
    });

    // Promote second image as cover
    fireEvent.click(screen.getByRole('button', { name: 'Set as Cover' }));
    expect(updateAttSpy).toHaveBeenCalledWith('att-2', { isCover: true });

    // Edit caption and blur
    const captionInput = screen.getByLabelText('Caption for image 1');
    fireEvent.change(captionInput, { target: { value: 'Updated caption' } });
    fireEvent.blur(captionInput);
    expect(updateAttSpy).toHaveBeenCalledWith('att-1', { caption: 'Updated caption' });

    // Reorder second image up
    const moveUpButtons = screen.getAllByRole('button', { name: 'Move image up' });
    fireEvent.click(moveUpButtons[1]!);
    expect(reorderSpy).toHaveBeenCalledWith('card-1', ['att-2', 'att-1']);

    // Delete second image
    fireEvent.click(screen.getByRole('button', { name: 'Remove image att-2' }));
    expect(removeSpy).toHaveBeenCalledWith('att-2');

    // Open lightbox from gallery thumbnail
    fireEvent.click(screen.getByRole('button', { name: /Open lightbox for First shot/i }));
    expect(useBoardStore.getState().lightboxState).toEqual({
      cardId: 'card-1',
      attachmentId: 'att-1',
    });
  });

  it('displays full-resolution image, zoom controls, multi-image navigation, and Escape close in ImageLightboxModal', () => {
    useBoardStore.setState({
      lightboxState: { cardId: 'card-1', attachmentId: 'att-1' },
    });

    render(<ImageLightboxModal />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'First shot' });
    expect(img).toHaveAttribute('src', '/api/media/attachments/att-1/original');
    expect(screen.getByText('1024 × 768')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('First shot')).toBeInTheDocument();

    // Zoom in and reset
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.getByText('100%')).toBeInTheDocument();

    // Navigate to next image
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(useBoardStore.getState().lightboxState?.attachmentId).toBe('att-2');

    // Close via Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useBoardStore.getState().lightboxState).toBeNull();
  });
});
