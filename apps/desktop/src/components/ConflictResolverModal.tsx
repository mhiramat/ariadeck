import { X, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import type { Card, ConflictRecord, Edge } from '@ariadeck/core';
import { useBoardStore } from '../store/useBoardStore.ts';

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function ConflictResolverModal() {
  const open = useBoardStore((s) => s.conflictModalOpen);
  const setOpen = useBoardStore((s) => s.setConflictModalOpen);
  const conflicts = useBoardStore((s) => s.conflicts);
  const resolveConflict = useBoardStore((s) => s.resolveConflict);

  if (!open) {
    return null;
  }

  const renderConflictCard = (conflict: ConflictRecord) => {
    if (conflict.conflictType === 'cyclic_edge') {
      const edge = safeParseJson<Edge>(conflict.localSnapshotJson);
      return (
        <div
          key={conflict.id}
          className="rounded-xl border border-rose-500/40 bg-slate-950 p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Cyclic Dependency Edge
            </span>
            <span className="text-[11px] text-slate-500">{conflict.entityId}</span>
          </div>
          <p className="mb-3 text-xs text-slate-300">
            Syncing offline edits introduced a dependency cycle involving edge{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-indigo-300">
              {edge ? `${edge.sourceCardId} -> ${edge.targetCardId}` : conflict.entityId}
            </code>
            .
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void resolveConflict(conflict.id, { strategy: 'keep_edge' })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-indigo-500"
            >
              Keep Edge
            </button>
            <button
              type="button"
              onClick={() => void resolveConflict(conflict.id, { strategy: 'delete_edge' })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove Conflicted Edge
            </button>
          </div>
        </div>
      );
    }

    const localCard = safeParseJson<Card>(conflict.localSnapshotJson);
    const remoteCard = safeParseJson<Card>(conflict.remoteSnapshotJson);

    return (
      <div
        key={conflict.id}
        className="rounded-xl border border-amber-500/40 bg-slate-950 p-4"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            {conflict.conflictType === 'deleted_target_edit'
              ? 'Edit on Split / Merged Card'
              : 'Concurrent Card Content Collision'}
          </span>
          <span className="text-[11px] text-slate-500">{conflict.entityId}</span>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
              Local Version
            </p>
            <p className="text-xs font-semibold text-white">{localCard?.title ?? '(Unknown)'}</p>
            <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-300">
              {localCard?.content || '(Empty)'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
              Remote Version
            </p>
            <p className="text-xs font-semibold text-white">{remoteCard?.title ?? '(Unknown)'}</p>
            <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-300">
              {remoteCard?.content || '(Empty)'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void resolveConflict(conflict.id, { strategy: 'keep_local' })}
            className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/25"
          >
            Keep Local
          </button>
          <button
            type="button"
            onClick={() => void resolveConflict(conflict.id, { strategy: 'keep_remote' })}
            className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/25"
          >
            Keep Remote
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sync conflict resolver"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">
            Sync Conflicts ({conflicts.length})
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close conflict resolver"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {conflicts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              <p className="text-sm font-medium text-slate-200">No unresolved sync conflicts</p>
              <p className="text-xs text-slate-400">
                Your board is clean and ready for synchronization.
              </p>
            </div>
          ) : (
            conflicts.map(renderConflictCard)
          )}
        </div>
      </div>
    </div>
  );
}
