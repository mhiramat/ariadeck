import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Check, RotateCcw, X } from 'lucide-react';
import type {
  BoardType,
  EdgeDirection,
  EdgeStyleVariant,
  RelationType,
} from '@ariadeck/core';

export interface DependencyEdgeData extends Record<string, unknown> {
  boardType?: BoardType;
  relationType: RelationType;
  direction?: EdgeDirection;
  styleVariant?: EdgeStyleVariant;
  color?: string | null;
  label?: string;
  isConflicted?: boolean;
  onUpdate?: (
    edgeId: string,
    patch: {
      relationType: RelationType;
      direction?: EdgeDirection;
      styleVariant?: EdgeStyleVariant;
      label: string | null;
    }
  ) => void;
  onDelete: (edgeId: string) => void;
}

export type DependencyFlowEdge = Edge<DependencyEdgeData, 'dependency'>;

function buildJumpBackArcPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): [string, number, number] {
  const dx = Math.abs(targetX - sourceX);
  const archDepth = Math.max(84, Math.min(200, dx * 0.28 + 64));
  const controlY = Math.max(sourceY, targetY) + archDepth;
  const path = `M ${sourceX} ${sourceY} C ${sourceX} ${controlY}, ${targetX} ${controlY}, ${targetX} ${targetY}`;
  // Cubic Bezier midpoint at t = 0.5
  const labelX = (sourceX + targetX) / 2;
  const labelY = 0.125 * sourceY + 0.75 * controlY + 0.125 * targetY;
  return [path, labelX, labelY];
}

function getStrokeDasharray(
  styleVariant: EdgeStyleVariant,
  relationType: RelationType
): string | undefined {
  if (styleVariant === 'dotted') return '2 4';
  if (styleVariant === 'dashed' || relationType === 'jump_back' || relationType === 'relates_to') {
    return '6 4';
  }
  return undefined;
}

export function DependencyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  data,
}: EdgeProps<DependencyFlowEdge>) {
  const boardType: BoardType = data?.boardType ?? 'flow';
  const currentRelation: RelationType = data?.relationType ?? 'blocks';
  const currentDirection: EdgeDirection = data?.direction ?? 'directed';
  const currentStyle: EdgeStyleVariant =
    data?.styleVariant ?? (currentRelation === 'jump_back' ? 'dashed' : 'solid');
  const currentLabel = data?.label ?? '';

  const [edgePath, labelX, labelY] =
    currentRelation === 'jump_back'
      ? buildJumpBackArcPath(sourceX, sourceY, targetX, targetY)
      : getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        });

  const [editing, setEditing] = useState(false);
  const [draftRelation, setDraftRelation] = useState<RelationType>(currentRelation);
  const [draftDirection, setDraftDirection] = useState<EdgeDirection>(currentDirection);
  const [draftStyle, setDraftStyle] = useState<EdgeStyleVariant>(currentStyle);
  const [draftLabel, setDraftLabel] = useState(currentLabel);
  const zoom = useStore((s) => s.transform[2]);
  const showLabel = editing || zoom >= 0.45;

  useEffect(() => {
    setDraftRelation(currentRelation);
    setDraftDirection(currentDirection);
    setDraftStyle(currentStyle);
    setDraftLabel(currentLabel);
  }, [currentRelation, currentDirection, currentStyle, currentLabel]);

  const isConflicted = Boolean(data?.isConflicted);
  const directionGlyph =
    currentDirection === 'bidirectional'
      ? '↔ '
      : currentDirection === 'undirected'
        ? '— '
        : '';
  const displayLabel = currentLabel
    ? `${directionGlyph}${currentLabel} (${currentRelation})`
    : `${directionGlyph}${currentRelation}`;

  const strokeColor = isConflicted
    ? '#f43f5e'
    : data?.color
      ? data.color
      : currentRelation === 'jump_back'
        ? '#f59e0b'
        : currentRelation === 'relates_to'
          ? '#2dd4bf'
          : currentDirection === 'bidirectional'
            ? '#f43f5e'
            : currentDirection === 'undirected'
              ? '#94a3b8'
              : '#818cf8';

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draftLabel.trim();
    data?.onUpdate?.(id, {
      relationType: draftRelation,
      ...(boardType === 'flat' ? { direction: draftDirection } : {}),
      styleVariant: draftStyle,
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
      setDraftDirection(currentDirection);
      setDraftStyle(currentStyle);
      setDraftLabel(currentLabel);
      setEditing(false);
    }
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: isConflicted ? 2.5 : 2,
          strokeDasharray: getStrokeDasharray(currentStyle, currentRelation),
        }}
      />
      {showLabel && (
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
              className="flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-500 bg-slate-900 p-1.5 shadow-xl"
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
                {boardType === 'flow' ? (
                  <option value="jump_back">jump_back</option>
                ) : (
                  <option value="custom">custom</option>
                )}
              </select>

              {boardType === 'flat' && (
                <select
                  aria-label="Edge direction"
                  value={draftDirection}
                  onChange={(e) => setDraftDirection(e.target.value as EdgeDirection)}
                  className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-white outline-none focus:border-indigo-400"
                >
                  <option value="directed">→</option>
                  <option value="bidirectional">↔</option>
                  <option value="undirected">—</option>
                </select>
              )}

              <select
                aria-label="Edge style"
                value={draftStyle}
                onChange={(e) => setDraftStyle(e.target.value as EdgeStyleVariant)}
                className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-white outline-none focus:border-indigo-400"
              >
                <option value="solid">solid</option>
                <option value="dashed">dashed</option>
                <option value="dotted">dotted</option>
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
                  setDraftDirection(currentDirection);
                  setDraftStyle(currentStyle);
                  setDraftLabel(currentLabel);
                  setEditing(false);
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          ) : (
            <div
              className={`group flex items-center gap-1 rounded-full border bg-slate-900/95 px-2 py-0.5 text-[10px] font-medium shadow hover:border-indigo-400 ${
                currentRelation === 'jump_back'
                  ? 'border-amber-500/50 text-amber-200'
                  : 'border-slate-700 text-slate-300'
              }`}
            >
              {currentRelation === 'jump_back' && (
                <RotateCcw className="h-2.5 w-2.5 text-amber-400" />
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Edit edge ${displayLabel}`}
                title="Click to edit relation type or label"
                className={`cursor-pointer ${
                  isConflicted
                    ? 'text-rose-400'
                    : currentRelation === 'jump_back'
                      ? 'text-amber-200 hover:text-white'
                      : 'text-slate-300 hover:text-white'
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
      )}
    </>
  );
}
