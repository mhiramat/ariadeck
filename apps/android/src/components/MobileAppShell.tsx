import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { X } from 'lucide-react';
import { useMobileStore } from '../store/useMobileStore.ts';
import { MobileHeader } from './MobileHeader.tsx';
import { BottomNavBar } from './BottomNavBar.tsx';
import { ListModeView } from './ListModeView.tsx';
import { CardEditorView } from './CardEditorView.tsx';
import { RelationMapView } from './RelationMapView.tsx';
import { MobileTimelineView } from './MobileTimelineView.tsx';

export function MobileAppShell() {
  const activeMode = useMobileStore((s) => s.activeMode);
  const setActiveMode = useMobileStore((s) => s.setActiveMode);
  const initialize = useMobileStore((s) => s.initialize);
  const toasts = useMobileStore((s) => s.toasts);
  const dismissToast = useMobileStore((s) => s.dismissToast);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Handle Android hardware back button cleanly across modes
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      const currentMode = useMobileStore.getState().activeMode;
      if (currentMode !== 'list') {
        setActiveMode('list');
      } else {
        void CapacitorApp.exitApp();
      }
    });
    return () => {
      void listenerPromise.then((handle) => handle.remove());
    };
  }, [setActiveMode]);

  return (
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <MobileHeader />

      <main className="relative flex flex-1 flex-col overflow-hidden">
        {activeMode === 'list' && <ListModeView />}
        {activeMode === 'edit' && <CardEditorView />}
        {activeMode === 'relations' && <RelationMapView />}
        {activeMode === 'timeline' && <MobileTimelineView />}

        {toasts.length > 0 && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-50 flex flex-col gap-1.5">
            {toasts.map((toast) => {
              const cls =
                toast.kind === 'error'
                  ? 'border-rose-500/50 bg-rose-950/95 text-rose-200'
                  : toast.kind === 'success'
                    ? 'border-emerald-500/50 bg-emerald-950/95 text-emerald-200'
                    : 'border-indigo-500/50 bg-slate-900/95 text-indigo-200';
              return (
                <div
                  key={toast.id}
                  className={`pointer-events-auto flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs shadow-lg ${cls}`}
                >
                  <span>{toast.message}</span>
                  <button
                    type="button"
                    aria-label="Dismiss toast"
                    onClick={() => dismissToast(toast.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <BottomNavBar />
    </div>
  );
}
