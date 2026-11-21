import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore.ts';
import { AppHeader } from './AppHeader.tsx';
import { GraphCanvas } from './GraphCanvas.tsx';
import { InspectorPanel } from './InspectorPanel.tsx';
import { TimelineView } from './TimelineView.tsx';

export function DesktopAppShell() {
  const viewMode = useBoardStore((s) => s.viewMode);
  const toasts = useBoardStore((s) => s.toasts);
  const dismissToast = useBoardStore((s) => s.dismissToast);
  const initialize = useBoardStore((s) => s.initialize);
  const startEventStream = useBoardStore((s) => s.startEventStream);
  const selectCard = useBoardStore((s) => s.selectCard);

  useEffect(() => {
    void initialize();
    const stopStream = startEventStream();
    return () => {
      stopStream();
    };
  }, [initialize, startEventStream]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        selectCard(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectCard]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <AppHeader />

      <div className="relative flex flex-1 overflow-hidden">
        {viewMode === 'graph' ? <GraphCanvas /> : <TimelineView />}

        <InspectorPanel />

        {toasts.length > 0 && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute right-4 top-4 z-50 flex flex-col gap-2"
          >
            {toasts.map((toast) => {
              const colorClass =
                toast.kind === 'error'
                  ? 'border-rose-500/50 bg-rose-950/95 text-rose-200'
                  : toast.kind === 'success'
                    ? 'border-emerald-500/50 bg-emerald-950/95 text-emerald-200'
                    : 'border-indigo-500/50 bg-slate-900/95 text-indigo-200';
              return (
                <div
                  key={toast.id}
                  className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg ${colorClass}`}
                >
                  <span className="flex-1">{toast.message}</span>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    aria-label="Dismiss notification"
                    className="rounded p-0.5 opacity-70 hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
