import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useBoardStore, type ToastNotification } from '../store/useBoardStore.ts';
import { AppHeader } from './AppHeader.tsx';
import { AuthGate } from './AuthGate.tsx';
import { BoardListPanel } from './BoardListPanel.tsx';
import { ConflictResolverModal } from './ConflictResolverModal.tsx';
import { GraphCanvas } from './GraphCanvas.tsx';
import { ImageLightboxModal } from './ImageLightboxModal.tsx';
import { InspectorPanel } from './InspectorPanel.tsx';
import { TimelineView } from './TimelineView.tsx';

const TOAST_FADE_DELAY_MS = 4500;
const TOAST_REMOVE_DELAY_MS = 5000;

export function AutoDismissToast({
  toast,
  onDismiss,
}: {
  toast: ToastNotification;
  onDismiss: (id: string) => void;
}) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), TOAST_FADE_DELAY_MS);
    const removeTimer = setTimeout(() => onDismiss(toast.id), TOAST_REMOVE_DELAY_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, onDismiss]);

  const colorClass =
    toast.kind === 'error'
      ? 'border-rose-500/50 bg-rose-950/95 text-rose-200'
      : toast.kind === 'success'
        ? 'border-emerald-500/50 bg-emerald-950/95 text-emerald-200'
        : 'border-indigo-500/50 bg-slate-900/95 text-indigo-200';

  return (
    <div
      className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg transition-all duration-500 ${
        fading ? 'pointer-events-none -translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
      } ${colorClass}`}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="rounded p-0.5 opacity-70 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function DesktopAppShell() {
  const authRequired = useBoardStore((s) => s.authRequired);
  const authenticated = useBoardStore((s) => s.authenticated);
  const viewMode = useBoardStore((s) => s.viewMode);
  const toasts = useBoardStore((s) => s.toasts);
  const dismissToast = useBoardStore((s) => s.dismissToast);
  const initialize = useBoardStore((s) => s.initialize);
  const startEventStream = useBoardStore((s) => s.startEventStream);
  const selectCard = useBoardStore((s) => s.selectCard);
  const lightboxState = useBoardStore((s) => s.lightboxState);
  const closeLightbox = useBoardStore((s) => s.closeLightbox);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (authRequired && !authenticated) {
      return;
    }
    const stopStream = startEventStream();
    return () => {
      stopStream();
    };
  }, [authRequired, authenticated, startEventStream]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (lightboxState) {
          closeLightbox();
        } else {
          selectCard(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxState, closeLightbox, selectCard]);

  if (authRequired && !authenticated) {
    return <AuthGate />;
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <AppHeader />

      <div className="relative flex flex-1 overflow-hidden">
        <BoardListPanel />

        {viewMode === 'graph' ? <GraphCanvas /> : <TimelineView />}

        <InspectorPanel />
        <ConflictResolverModal />
        <ImageLightboxModal />

        {toasts.length > 0 && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute right-4 top-4 z-50 flex flex-col gap-2"
          >
            {toasts.map((toast) => (
              <AutoDismissToast key={toast.id} toast={toast} onDismiss={dismissToast} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
