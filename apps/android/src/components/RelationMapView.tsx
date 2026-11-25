import { useMemo, useState, type FormEvent } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Hand, Link2, RotateCcw, X } from 'lucide-react';
import type { EdgeDirection } from '@ariadeck/core';
import { useMobileStore } from '../store/useMobileStore.ts';

function RelationMapInner() {
  const graph = useMobileStore((s) => s.graph);
  const relationToolMode = useMobileStore((s) => s.relationToolMode);
  const connectSourceId = useMobileStore((s) => s.connectSourceId);
  const pendingFlatEdge = useMobileStore((s) => s.pendingFlatEdge);
  const pendingJumpBack = useMobileStore((s) => s.pendingJumpBack);
  const setRelationToolMode = useMobileStore((s) => s.setRelationToolMode);
  const handleRelationCardTap = useMobileStore((s) => s.handleRelationCardTap);
  const clearPendingEdgePrompts = useMobileStore((s) => s.clearPendingEdgePrompts);
  const connectCards = useMobileStore((s) => s.connectCards);
  const updateCard = useMobileStore((s) => s.updateCard);

  const [flatDirection, setFlatDirection] = useState<EdgeDirection>('directed');
  const [edgeLabel, setEdgeLabel] = useState('');

  const nodes: FlowNode[] = useMemo(() => {
    if (!graph) return [];
    return graph.cards.map((card) => {
      const isSource = card.id === connectSourceId;
      return {
        id: card.id,
        position: { x: card.posX, y: card.posY },
        data: { label: card.title },
        style: {
          background: isSource ? '#312e81' : '#0f172a',
          color: '#f8fafc',
          border: isSource ? '2px solid #818cf8' : '1px solid #334155',
          borderRadius: '12px',
          padding: '10px 14px',
          fontSize: '12px',
          fontWeight: 600,
          width: 180,
        },
      };
    });
  }, [graph, connectSourceId]);

  const edges: FlowEdge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges.map((edge) => {
      const direction = edge.direction ?? 'directed';
      const stroke = edge.isConflicted
        ? '#f43f5e'
        : edge.color
          ? edge.color
          : edge.relationType === 'jump_back'
            ? '#f59e0b'
            : direction === 'bidirectional'
              ? '#f43f5e'
              : direction === 'undirected'
                ? '#94a3b8'
                : '#818cf8';
      const arrow = { type: MarkerType.ArrowClosed, color: stroke };
      const labelText = edge.label
        ? `${edge.relationType === 'jump_back' ? '↩ ' : ''}${edge.label}`
        : edge.relationType;

      return {
        id: edge.id,
        source: edge.sourceCardId,
        target: edge.targetCardId,
        label: labelText,
        ...(direction === 'bidirectional' ? { markerStart: arrow } : {}),
        ...(direction !== 'undirected' ? { markerEnd: arrow } : {}),
        style: {
          stroke,
          strokeWidth: 2,
          ...(edge.styleVariant === 'dashed' || edge.relationType === 'jump_back'
            ? { strokeDasharray: '6 4' }
            : edge.styleVariant === 'dotted'
              ? { strokeDasharray: '2 4' }
              : {}),
        },
      };
    });
  }, [graph]);

  const handleConfirmFlatEdge = async (e: FormEvent) => {
    e.preventDefault();
    if (!pendingFlatEdge) return;
    await connectCards(pendingFlatEdge.sourceId, pendingFlatEdge.targetId, 'relates_to', {
      direction: flatDirection,
      label: edgeLabel.trim() || undefined,
    });
    setEdgeLabel('');
    setFlatDirection('directed');
  };

  const handleConfirmJumpBack = async (e: FormEvent) => {
    e.preventDefault();
    if (!pendingJumpBack) return;
    await connectCards(pendingJumpBack.sourceId, pendingJumpBack.targetId, 'jump_back', {
      label: edgeLabel.trim() || undefined,
      styleVariant: 'dashed',
    });
    setEdgeLabel('');
  };

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-slate-950">
      {/* Accidental-Touch Prevention Mode Toggle */}
      <div className="z-10 flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-3 py-2">
        <div
          role="group"
          aria-label="Relation map interaction mode"
          className="flex items-center rounded-xl border border-slate-700 bg-slate-950 p-0.5"
        >
          <button
            type="button"
            aria-pressed={relationToolMode === 'pan'}
            onClick={() => setRelationToolMode('pan')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              relationToolMode === 'pan'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Hand className="h-3.5 w-3.5" />
            Pan / Inspect
          </button>
          <button
            type="button"
            aria-pressed={relationToolMode === 'connect'}
            onClick={() => setRelationToolMode('connect')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              relationToolMode === 'connect'
                ? 'bg-amber-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            Connect Mode
          </button>
        </div>

        <span className="text-[11px] text-slate-400">
          {relationToolMode === 'connect'
            ? connectSourceId
              ? 'Tap target card'
              : 'Tap source card'
            : 'Pinch to zoom, drag to pan'}
        </span>
      </div>

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={(_e, node) => void handleRelationCardTap(node.id)}
          onNodeDragStop={(_e, node) =>
            void updateCard(node.id, {
              posX: Math.round(node.position.x),
              posY: Math.round(node.position.y),
            })
          }
          nodesDraggable={relationToolMode === 'pan'}
          nodesConnectable={false}
          minZoom={0.1}
          maxZoom={2}
          panOnDrag
          zoomOnPinch
          fitView
          colorMode="dark"
        >
          <Background color="#334155" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Flat Board Relationship Bottom Sheet */}
      {pendingFlatEdge && (
        <form
          onSubmit={(e) => void handleConfirmFlatEdge(e)}
          aria-label="Flat relationship edge sheet"
          className="absolute inset-x-3 bottom-3 z-30 space-y-3 rounded-2xl border border-emerald-500/50 bg-slate-900 p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white">Connect Relationship Edge</h3>
            <button
              type="button"
              aria-label="Cancel edge creation"
              onClick={clearPendingEdgePrompts}
              className="rounded p-1 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { value: 'directed', label: 'Arrow (→)' },
                { value: 'bidirectional', label: 'Mutual (↔)' },
                { value: 'undirected', label: 'Link (—)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={flatDirection === opt.value}
                onClick={() => setFlatDirection(opt.value)}
                className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
                  flatDirection === opt.value
                    ? 'border-emerald-500 bg-emerald-600/20 text-emerald-200'
                    : 'border-slate-700 bg-slate-950 text-slate-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            aria-label="Relationship label"
            placeholder="Optional label (e.g., Rivalry, Mentor)..."
            value={edgeLabel}
            onChange={(e) => setEdgeLabel(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
          />

          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white"
          >
            Create Edge
          </button>
        </form>
      )}

      {/* Automatic Jump-Back Loop Prompt on Reverse Flow Connection */}
      {pendingJumpBack && (
        <form
          onSubmit={(e) => void handleConfirmJumpBack(e)}
          aria-label="Create jump-back loop prompt"
          className="absolute inset-x-3 bottom-3 z-30 space-y-3 rounded-2xl border border-amber-500/60 bg-slate-900 p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <RotateCcw className="h-3.5 w-3.5" />
              Create as Jump-Back Loop?
            </h3>
            <button
              type="button"
              aria-label="Cancel jump-back creation"
              onClick={clearPendingEdgePrompts}
              className="rounded p-1 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[11px] text-slate-300">
            The target card precedes the source card. Connecting with a normal dependency would
            create a cycle, so you can save it as a non-blocking Jump-Back loop instead.
          </p>
          <input
            type="text"
            aria-label="Jump-back loop label"
            placeholder="Optional loop label (e.g., Retry on error)..."
            value={edgeLabel}
            onChange={(e) => setEdgeLabel(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-amber-600 py-2 text-xs font-semibold text-white"
          >
            Create Jump-Back Loop
          </button>
        </form>
      )}
    </div>
  );
}

export function RelationMapView() {
  return (
    <ReactFlowProvider>
      <RelationMapInner />
    </ReactFlowProvider>
  );
}
