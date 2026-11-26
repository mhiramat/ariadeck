import { useEffect, useMemo, useState, type WheelEvent } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildMediaOriginalUrl } from '../api/client.ts';
import { useBoardStore } from '../store/useBoardStore.ts';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export function ImageLightboxModal() {
  const graph = useBoardStore((s) => s.graph);
  const lightboxState = useBoardStore((s) => s.lightboxState);
  const openLightbox = useBoardStore((s) => s.openLightbox);
  const closeLightbox = useBoardStore((s) => s.closeLightbox);

  const [zoom, setZoom] = useState(1);

  const card = useMemo(() => {
    if (!graph || !lightboxState) return null;
    return graph.cards.find((c) => c.id === lightboxState.cardId) ?? null;
  }, [graph, lightboxState]);

  const cardImages = useMemo(() => {
    if (!graph || !lightboxState) return [];
    return graph.attachments
      .filter((a) => a.cardId === lightboxState.cardId && a.kind === 'image')
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt)
      );
  }, [graph, lightboxState]);

  const currentIndex = useMemo(() => {
    if (!lightboxState) return -1;
    return cardImages.findIndex((a) => a.id === lightboxState.attachmentId);
  }, [cardImages, lightboxState]);

  const activeAttachment = currentIndex >= 0 ? cardImages[currentIndex] : null;

  useEffect(() => {
    setZoom(1);
  }, [lightboxState?.attachmentId]);

  useEffect(() => {
    if (!lightboxState || !activeAttachment) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeLightbox();
      } else if (event.key === 'ArrowLeft' && cardImages.length > 1) {
        const prevIdx = (currentIndex - 1 + cardImages.length) % cardImages.length;
        openLightbox(lightboxState.cardId, cardImages[prevIdx]!.id);
      } else if (event.key === 'ArrowRight' && cardImages.length > 1) {
        const nextIdx = (currentIndex + 1) % cardImages.length;
        openLightbox(lightboxState.cardId, cardImages[nextIdx]!.id);
      } else if (event.key === '+' || event.key === '=') {
        setZoom((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))));
      } else if (event.key === '-') {
        setZoom((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))));
      } else if (event.key === '0') {
        setZoom(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxState, activeAttachment, cardImages, currentIndex, openLightbox, closeLightbox]);

  if (!lightboxState || !activeAttachment) {
    return null;
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((z + delta).toFixed(2)))));
  };

  const goPrev = () => {
    if (cardImages.length <= 1) return;
    const prevIdx = (currentIndex - 1 + cardImages.length) % cardImages.length;
    openLightbox(lightboxState.cardId, cardImages[prevIdx]!.id);
  };

  const goNext = () => {
    if (cardImages.length <= 1) return;
    const nextIdx = (currentIndex + 1) % cardImages.length;
    openLightbox(lightboxState.cardId, cardImages[nextIdx]!.id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activeAttachment.caption || card?.title || 'Image preview'}
      onClick={closeLightbox}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-sm"
    >
      {/* Top Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-2.5"
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="truncate text-sm font-semibold text-white">
            {card?.title ?? 'Image Preview'}
          </span>
          {activeAttachment.width && activeAttachment.height && (
            <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
              {activeAttachment.width} × {activeAttachment.height}
            </span>
          )}
          {cardImages.length > 1 && (
            <span className="shrink-0 text-xs text-slate-400">
              {currentIndex + 1} / {cardImages.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() =>
              setZoom((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))))
            }
            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:border-indigo-500 hover:text-white"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[3.2rem] text-center text-xs font-medium text-slate-200">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() =>
              setZoom((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))
            }
            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:border-indigo-500 hover:text-white"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={() => setZoom(1)}
            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:border-indigo-500 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <div className="mx-1 h-4 w-px bg-slate-700" />
          <button
            type="button"
            aria-label="Close lightbox"
            onClick={closeLightbox}
            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:border-rose-500 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div
        onWheel={handleWheel}
        className="relative flex flex-1 items-center justify-center overflow-auto p-6"
      >
        {cardImages.length > 1 && (
          <button
            type="button"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            className="absolute left-4 z-10 rounded-full border border-slate-700 bg-slate-900/90 p-2 text-slate-200 shadow-lg hover:border-indigo-500 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <img
          src={buildMediaOriginalUrl(activeAttachment.id)}
          alt={activeAttachment.caption || card?.title || 'Card image'}
          onClick={(e) => e.stopPropagation()}
          style={{ transform: `scale(${zoom})` }}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-100"
        />

        {cardImages.length > 1 && (
          <button
            type="button"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            className="absolute right-4 z-10 rounded-full border border-slate-700 bg-slate-900/90 p-2 text-slate-200 shadow-lg hover:border-indigo-500 hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Caption Footer */}
      {activeAttachment.caption && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="border-t border-slate-800 bg-slate-900/90 px-6 py-3 text-center text-sm text-slate-200"
        >
          {activeAttachment.caption}
        </div>
      )}
    </div>
  );
}
