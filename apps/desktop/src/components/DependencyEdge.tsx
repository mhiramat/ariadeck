import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';
import type { RelationType } from '@ariadeck/core';

export interface DependencyEdgeData extends Record<string, unknown> {
  relationType: RelationType;
  label?: string;
  isConflicted?: boolean;
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

  const isConflicted = Boolean(data?.isConflicted);
  const relationLabel = data?.label || data?.relationType || 'blocks';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isConflicted ? '#f43f5e' : '#818cf8',
          strokeWidth: isConflicted ? 2.5 : 2,
          strokeDasharray: data?.relationType === 'relates_to' ? '6 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan group flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 px-2 py-0.5 text-[10px] font-medium text-slate-300 shadow"
        >
          <span className={isConflicted ? 'text-rose-400' : 'text-slate-300'}>
            {relationLabel}
          </span>
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
      </EdgeLabelRenderer>
    </>
  );
}
