import { useCallback, useMemo, type MouseEvent } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CardType } from '@ariadeck/core';
import { useBoardStore } from '../store/useBoardStore.ts';
import { IdeaCardNode, type IdeaCardFlowNode } from './IdeaCardNode.tsx';
import { DependencyEdge, type DependencyFlowEdge } from './DependencyEdge.tsx';
import { CanvasQuickToolbar } from './CanvasQuickToolbar.tsx';

const nodeTypes = {
  ideaCard: IdeaCardNode,
};

const edgeTypes = {
  dependency: DependencyEdge,
};

function GraphCanvasInner() {
  const { screenToFlowPosition } = useReactFlow();
  const graph = useBoardStore((s) => s.graph);
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const selectCard = useBoardStore((s) => s.selectCard);
  const createCard = useBoardStore((s) => s.createCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const connectCards = useBoardStore((s) => s.connectCards);
  const disconnectCards = useBoardStore((s) => s.disconnectCards);

  const handleRename = useCallback(
    (cardId: string, title: string) => {
      void updateCard(cardId, { title });
    },
    [updateCard]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      void disconnectCards(edgeId);
    },
    [disconnectCards]
  );

  const nodes: IdeaCardFlowNode[] = useMemo(() => {
    if (!graph) return [];
    const attachmentCounts = new Map<string, number>();
    for (const att of graph.attachments) {
      attachmentCounts.set(att.cardId, (attachmentCounts.get(att.cardId) ?? 0) + 1);
    }
    return graph.cards.map((card) => ({
      id: card.id,
      type: 'ideaCard',
      position: { x: card.posX, y: card.posY },
      selected: card.id === selectedCardId,
      data: {
        card,
        attachmentCount: attachmentCounts.get(card.id) ?? 0,
        onRename: handleRename,
      },
    }));
  }, [graph, selectedCardId, handleRename]);

  const edges: DependencyFlowEdge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceCardId,
      target: edge.targetCardId,
      type: 'dependency',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edge.isConflicted ? '#f43f5e' : '#818cf8',
      },
      data: {
        relationType: edge.relationType,
        label: edge.label,
        isConflicted: edge.isConflicted,
        onDelete: handleDeleteEdge,
      },
    }));
  }, [graph, handleDeleteEdge]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        void connectCards(connection.source, connection.target, 'blocks');
      }
    },
    [connectCards]
  );

  const onNodeDragStop: OnNodeDrag<IdeaCardFlowNode> = useCallback(
    (_event, node) => {
      void updateCard(node.id, {
        posX: Math.round(node.position.x),
        posY: Math.round(node.position.y),
      });
    },
    [updateCard]
  );

  const onNodeClick: NodeMouseHandler<IdeaCardFlowNode> = useCallback(
    (_event, node) => {
      selectCard(node.id);
    },
    [selectCard]
  );

  const handlePaneDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) {
        return;
      }
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      void createCard({
        title: 'New Card',
        cardType: 'idea',
        posX: Math.round(pos.x),
        posY: Math.round(pos.y),
      });
    },
    [screenToFlowPosition, createCard]
  );

  const handleQuickCreate = useCallback(
    (cardType: CardType) => {
      const labels: Record<CardType, string> = {
        idea: 'New Idea',
        task: 'New Task',
        plot_event: 'New Plot Event',
        note: 'New Note',
      };
      void createCard({ title: labels[cardType], cardType });
    },
    [createCard]
  );

  return (
    <div
      className="relative h-full w-full flex-1 bg-slate-950"
      onDoubleClick={handlePaneDoubleClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={() => selectCard(null)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        colorMode="dark"
      >
        <Background color="#334155" gap={24} />
        <Controls />
        <MiniMap
          nodeColor="#6366f1"
          maskColor="rgba(15, 23, 42, 0.75)"
          className="!bg-slate-900"
        />
      </ReactFlow>

      <CanvasQuickToolbar onCreateCard={handleQuickCreate} />
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
