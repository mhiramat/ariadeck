import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Check, X } from 'lucide-react';
import type { RelationType } from '@ariadeck/core';

export interface DependencyEdgeData extends Record<string, unknown> {
  relationType: RelationType;
  label?: string;
  isConflicted?: boolean;
  onUpdate?: (
    edgeId: string,
    patch: { relationType: RelationType; label: string | null }
  ) => void;
  onDelete: (edgeId: string) => void;
}

export type DependencyFlowEdge = Edge<DependencyEdgeData, 'dependency'>;

export function DependencyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<DependencyFlowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const currentRelation: RelationType = data?.relationType ?? 'blocks';
  const currentLabel = data?.label ?? '';

  const [editing, setEditing] = useState(false);
  const [draftRelation, setDraftRelation] = useState<RelationType>(currentRelation);
  const [draftLabel, setDraftLabel] = useState(currentLabel);

  useEffect(() => {
    setDraftRelation(currentRelation);
    setDraftLabel(currentLabel);
  }, [currentRelation, currentLabel]);

  const isConflicted = Boolean(data?.isConflicted);
  const displayLabel = currentLabel ? `${currentLabel} (${currentRelation})` : currentRelation;

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draftLabel.trim();
    data?.onUpdate?.(id, {
      relationType: draftRelation,
      label: trimmed ? trimmed : null,
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    commitEdit();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraftRelation(currentRelation);
      setDraftLabel(currentLabel);
      setEditing(false);
    }
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isConflicted
            ? '#f43f5e'
            : currentRelation === 'relates_to'
              ? '#2dd4bf'
              : '#818cf8',
          strokeWidth: isConflicted ? 2.5 : 2,
          strokeDasharray: currentRelation === 'relates_to' ? '6 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan z-20"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {editing ? (
            <form
              onSubmit={handleSubmit}
              onKeyDown={handleKeyDown}
              className="flex items-center gap-1.5 rounded-lg border border-indigo-500 bg-slate-900 p-1.5 shadow-xl"
            >
              <select
                aria-label="Edge relation type"
                value={draftRelation}
                onChange={(e) => setDraftRelation(e.target.value as RelationType)}
                className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-white outline-none focus:border-indigo-400"
              >
                <option value="blocks">blocks</option>
                <option value="causes">causes</option>
                <option value="relates_to">relates_to</option>
              </select>
              <input
                type="text"
                aria-label="Edge label"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="Optional label..."
                autoFocus
                className="w-28 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] text-white outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                aria-label="Save edge changes"
                title="Save"
                className="rounded bg-indigo-600 p-1 text-white hover:bg-indigo-500"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Cancel edge edit"
                title="Cancel"
                onClick={() => {
                  setDraftRelation(currentRelation);
                  setDraftLabel(currentLabel);
                  setEditing(false);
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          ) : (
            <div className="group flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 px-2 py-0.5 text-[10px] font-medium text-slate-300 shadow hover:border-indigo-400">
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Edit edge ${displayLabel}`}
                title="Click to edit relation type or label"
                className={`cursor-pointer ${
                  isConflicted ? 'text-rose-400' : 'text-slate-300 hover:text-white'
                }`}
              >
                {displayLabel}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  data?.onDelete(id);
                }}
                aria-label="Delete dependency edge"
                title="Delete edge"
                className="rounded-full p-0.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
