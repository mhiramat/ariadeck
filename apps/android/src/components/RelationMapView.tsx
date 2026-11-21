import { useMemo } from 'react';
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
import { Hand, Link2 } from 'lucide-react';
import { useMobileStore } from '../store/useMobileStore.ts';

function RelationMapInner() {
  const graph = useMobileStore((s) => s.graph);
  const relationToolMode = useMobileStore((s) => s.relationToolMode);
  const connectSourceId = useMobileStore((s) => s.connectSourceId);
  const setRelationToolMode = useMobileStore((s) => s.setRelationToolMode);
  const handleRelationCardTap = useMobileStore((s) => s.handleRelationCardTap);
  const updateCard = useMobileStore((s) => s.updateCard);

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
    return graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceCardId,
      target: edge.targetCardId,
      label: edge.relationType,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edge.isConflicted ? '#f43f5e' : '#818cf8',
      },
      style: {
        stroke: edge.isConflicted ? '#f43f5e' : '#818cf8',
        strokeWidth: 2,
      },
    }));
  }, [graph]);

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
          panOnDrag
          zoomOnPinch
          fitView
          colorMode="dark"
        >
          <Background color="#334155" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
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
