import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  BoardType,
  CardType,
  EdgeDirection,
  EdgeStyleVariant,
  RelationType,
} from '@ariadeck/core';
import { useBoardStore } from '../store/useBoardStore.ts';
import {
  computeAutoGraphLayout,
  computeForceDirectedLayout,
  resolveEdgeHandles,
  type CardDimensions,
} from '../utils/autoLayout.ts';
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
  const { screenToFlowPosition, fitView } = useReactFlow();
  const graph = useBoardStore((s) => s.graph);
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const selectCard = useBoardStore((s) => s.selectCard);
  const createCard = useBoardStore((s) => s.createCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const connectCards = useBoardStore((s) => s.connectCards);
  const updateEdge = useBoardStore((s) => s.updateEdge);
  const disconnectCards = useBoardStore((s) => s.disconnectCards);
  const pushToast = useBoardStore((s) => s.pushToast);

  const [nodes, setNodes, onNodesChange] = useNodesState<IdeaCardFlowNode>([]);
  const [flatEdgeDirection, setFlatEdgeDirection] = useState<EdgeDirection>('directed');
  const [jumpBackMode, setJumpBackMode] = useState(false);
  const lastFittedBoardIdRef = useRef<string | null>(null);

  const boardType: BoardType = graph?.board.boardType ?? 'flow';

  const handleRename = useCallback(
    (cardId: string, title: string) => {
      void updateCard(cardId, { title });
    },
    [updateCard]
  );

  const handleUpdateEdge = useCallback(
    (
      edgeId: string,
      patch: {
        relationType: RelationType;
        direction?: EdgeDirection;
        styleVariant?: EdgeStyleVariant;
        label: string | null;
      }
    ) => {
      void updateEdge(edgeId, patch);
    },
    [updateEdge]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      void disconnectCards(edgeId);
    },
    [disconnectCards]
  );

  // Sync React Flow nodes from domain graph while preserving measured dimensions
  // so MiniMap and dragging work accurately.
  useEffect(() => {
    if (!graph) {
      setNodes([]);
      return;
    }
    const attachmentCounts = new Map<string, number>();
    for (const att of graph.attachments) {
      attachmentCounts.set(att.cardId, (attachmentCounts.get(att.cardId) ?? 0) + 1);
    }

    setNodes((prevNodes) => {
      const prevById = new Map(prevNodes.map((n) => [n.id, n]));
      return graph.cards.map((card) => {
        const existing = prevById.get(card.id);
        return {
          ...(existing ?? {}),
          id: card.id,
          type: 'ideaCard' as const,
          position: { x: card.posX, y: card.posY },
          selected: card.id === selectedCardId,
          data: {
            card,
            attachmentCount: attachmentCounts.get(card.id) ?? 0,
            onRename: handleRename,
          },
        };
      });
    });

    if (lastFittedBoardIdRef.current !== graph.board.id) {
      lastFittedBoardIdRef.current = graph.board.id;
      if (graph.cards.length > 0) {
        requestAnimationFrame(() => {
          void fitView({ padding: 0.25, duration: 250 });
        });
      }
    }
  }, [graph, selectedCardId, handleRename, setNodes, fitView]);

  const edges: DependencyFlowEdge[] = useMemo(() => {
    if (!graph) return [];
    const cardPosById = new Map(graph.cards.map((c) => [c.id, { x: c.posX, y: c.posY }]));

    return graph.edges.map((edge) => {
      const { sourceHandle, targetHandle } = resolveEdgeHandles(
        edge.relationType,
        cardPosById.get(edge.sourceCardId),
        cardPosById.get(edge.targetCardId),
        boardType
      );

      const direction = edge.direction ?? 'directed';
      const strokeColor = edge.isConflicted
        ? '#f43f5e'
        : edge.color
          ? edge.color
          : edge.relationType === 'jump_back'
            ? '#f59e0b'
            : edge.relationType === 'relates_to'
              ? '#2dd4bf'
              : direction === 'bidirectional'
                ? '#f43f5e'
                : direction === 'undirected'
                  ? '#94a3b8'
                  : '#818cf8';

      const arrowMarker = {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
      };

      return {
        id: edge.id,
        source: edge.sourceCardId,
        target: edge.targetCardId,
        sourceHandle,
        targetHandle,
        type: 'dependency',
        ...(direction === 'bidirectional' ? { markerStart: arrowMarker } : {}),
        ...(direction !== 'undirected' ? { markerEnd: arrowMarker } : {}),
        data: {
          boardType,
          relationType: edge.relationType,
          direction,
          styleVariant: edge.styleVariant,
          color: edge.color,
          label: edge.label,
          isConflicted: edge.isConflicted,
          onUpdate: handleUpdateEdge,
          onDelete: handleDeleteEdge,
        },
      };
    });
  }, [graph, boardType, handleUpdateEdge, handleDeleteEdge]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      if (boardType === 'flat') {
        void connectCards(connection.source, connection.target, 'relates_to', {
          direction: flatEdgeDirection,
        });
        return;
      }

      if (jumpBackMode) {
        void connectCards(connection.source, connection.target, 'jump_back', {
          styleVariant: 'dashed',
        });
        return;
      }

      const isVerticalHandle =
        connection.sourceHandle === 'top' ||
        connection.sourceHandle === 'bottom' ||
        connection.targetHandle === 'top' ||
        connection.targetHandle === 'bottom';
      void connectCards(
        connection.source,
        connection.target,
        isVerticalHandle ? 'relates_to' : 'blocks'
      );
    },
    [boardType, flatEdgeDirection, jumpBackMode, connectCards]
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
      if (
        target.closest(
          '.react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap, .react-flow__panel, button, input, textarea'
        )
      ) {
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

  const handleAutoLayout = useCallback(async () => {
    if (!graph || graph.cards.length === 0) return;
    const measuredDimensions = new Map<string, CardDimensions>();
    for (const node of nodes) {
      if (node.measured?.width && node.measured?.height) {
        measuredDimensions.set(node.id, {
          width: node.measured.width,
          height: node.measured.height,
        });
      }
    }
    const positions =
      boardType === 'flat'
        ? computeForceDirectedLayout(graph.cards, graph.edges, measuredDimensions)
        : computeAutoGraphLayout(graph.cards, graph.edges, measuredDimensions);
    const posMap = new Map(positions.map((p) => [p.cardId, p]));

    setNodes((prev) =>
      prev.map((node) => {
        const next = posMap.get(node.id);
        return next ? { ...node, position: { x: next.posX, y: next.posY } } : node;
      })
    );

    await Promise.all(
      positions.map((p) => updateCard(p.cardId, { posX: p.posX, posY: p.posY }))
    );

    requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 300 });
    });
    pushToast(
      'success',
      boardType === 'flat'
        ? 'Relationship map arranged with force-directed layout.'
        : 'Graph layout arranged by dependency order.'
    );
  }, [graph, boardType, nodes, setNodes, updateCard, fitView, pushToast]);

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
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={() => selectCard(null)}
        connectionMode={ConnectionMode.Loose}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        colorMode="dark"
      >
        <Background color="#334155" gap={24} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={boardType === 'flat' ? '#10b981' : '#6366f1'}
          nodeStrokeColor={boardType === 'flat' ? '#6ee7b7' : '#a5b4fc'}
          nodeBorderRadius={4}
          maskColor="rgba(2, 6, 23, 0.72)"
          maskStrokeColor="#38bdf8"
          maskStrokeWidth={2}
          bgColor="#1e293b"
          className="!rounded-lg !border !border-slate-700/80"
        />
      </ReactFlow>

      <CanvasQuickToolbar
        boardType={boardType}
        flatEdgeDirection={flatEdgeDirection}
        onFlatEdgeDirectionChange={setFlatEdgeDirection}
        jumpBackMode={jumpBackMode}
        onToggleJumpBackMode={() => setJumpBackMode((prev) => !prev)}
        onCreateCard={handleQuickCreate}
        onAutoLayout={() => void handleAutoLayout()}
        hasCards={(graph?.cards.length ?? 0) > 0}
      />
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
