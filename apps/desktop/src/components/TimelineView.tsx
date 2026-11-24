import { useMemo, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  detectJumpBackWarnings,
  detectTimelineViolations,
  type Card,
  type CardType,
} from '@ariadeck/core';
import { useBoardStore } from '../store/useBoardStore.ts';
import { MarkdownContent } from './MarkdownContent.tsx';

const TYPE_BADGE: Record<CardType, { label: string; cls: string }> = {
  task: { label: 'Task', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  idea: { label: 'Idea', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  plot_event: { label: 'Plot Event', cls: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
  note: { label: 'Note', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
};

const COLUMN_WIDTH = 288; // w-72
const COLUMN_GAP = 16; // gap-4

export function TimelineView() {
  const graph = useBoardStore((s) => s.graph);
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const selectCard = useBoardStore((s) => s.selectCard);
  const createCard = useBoardStore((s) => s.createCard);
  const computeTimelineLayout = useBoardStore((s) => s.computeTimelineLayout);
  const moveCardToTimelineStep = useBoardStore((s) => s.moveCardToTimelineStep);

  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverStep, setDragOverStep] = useState<number | null>(null);
  const [showLoops, setShowLoops] = useState(true);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);

  const cards = graph?.cards ?? [];
  const edges = graph?.edges ?? [];

  const violations = useMemo(
    () => detectTimelineViolations(cards, edges),
    [cards, edges]
  );

  const jumpBackEdges = useMemo(
    () => edges.filter((e) => e.deletedAt === null && e.relationType === 'jump_back'),
    [edges]
  );

  const jumpBackWarnings = useMemo(
    () => detectJumpBackWarnings(cards, edges),
    [cards, edges]
  );

  const warningByEdgeId = useMemo(
    () => new Map(jumpBackWarnings.map((w) => [w.edgeId, w])),
    [jumpBackWarnings]
  );

  const cardById = useMemo(
    () => new Map(cards.map((c) => [c.id, c])),
    [cards]
  );

  const violatedCardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of violations) {
      ids.add(v.sourceCardId);
      ids.add(v.targetCardId);
    }
    return ids;
  }, [violations]);

  const { unassignedCards, stepNumbers, cardsByStep } = useMemo(() => {
    const unassigned: Card[] = [];
    const byStep = new Map<number, Card[]>();
    let maxStep = -1;

    for (const card of cards) {
      if (card.timelineOrder === null) {
        unassigned.push(card);
      } else {
        if (card.timelineOrder > maxStep) maxStep = card.timelineOrder;
        const list = byStep.get(card.timelineOrder);
        if (list) {
          list.push(card);
        } else {
          byStep.set(card.timelineOrder, [card]);
        }
      }
    }

    const count = Math.max(0, maxStep);
    const steps: number[] = [];
    for (let s = 0; s <= count; s++) {
      steps.push(s);
    }

    return { unassignedCards: unassigned, stepNumbers: steps, cardsByStep: byStep };
  }, [cards]);

  const dependencyCounts = useMemo(() => {
    const prereq = new Map<string, number>();
    const dep = new Map<string, number>();
    for (const edge of edges) {
      if (edge.relationType === 'blocks' || edge.relationType === 'causes') {
        dep.set(edge.sourceCardId, (dep.get(edge.sourceCardId) ?? 0) + 1);
        prereq.set(edge.targetCardId, (prereq.get(edge.targetCardId) ?? 0) + 1);
      }
    }
    return { prereq, dep };
  }, [edges]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, cardId: string) => {
    setDraggedCardId(cardId);
    event.dataTransfer.setData('text/plain', cardId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, step: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverStep !== step) {
      setDragOverStep(step);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>, targetStep: number) => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain') || draggedCardId;
    setDraggedCardId(null);
    setDragOverStep(null);
    if (cardId) {
      void moveCardToTimelineStep(cardId, targetStep);
    }
  };

  const nextNewStep = stepNumbers.length;
  const stepColumnOffset = unassignedCards.length > 0 ? 1 : 0;
  const totalLaneWidth =
    (stepNumbers.length + stepColumnOffset) * (COLUMN_WIDTH + COLUMN_GAP) + 32;

  const getStepCenterX = (step: number): number =>
    16 + (step + stepColumnOffset) * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2;

  const renderCard = (card: Card) => {
    const isSelected = card.id === selectedCardId;
    const hasViolation = violatedCardIds.has(card.id);
    const badge = TYPE_BADGE[card.cardType];
    const currentStep = card.timelineOrder ?? 0;
    const prereqCount = dependencyCounts.prereq.get(card.id) ?? 0;
    const depCount = dependencyCounts.dep.get(card.id) ?? 0;

    return (
      <div
        key={card.id}
        draggable
        onDragStart={(e) => handleDragStart(e, card.id)}
        onDragEnd={() => {
          setDraggedCardId(null);
          setDragOverStep(null);
        }}
        onMouseEnter={() => setHoveredCardId(card.id)}
        onMouseLeave={() => setHoveredCardId((prev) => (prev === card.id ? null : prev))}
        onClick={() => selectCard(card.id)}
        className={`cursor-pointer rounded-xl border bg-slate-900 p-3 shadow transition-all ${
          hasViolation
            ? 'border-rose-500 ring-2 ring-rose-500/30'
            : isSelected
              ? 'border-indigo-400 ring-2 ring-indigo-500/40'
              : 'border-slate-700/80 hover:border-slate-500'
        }`}
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}
          >
            {badge.label}
          </span>

          <div className="flex items-center gap-1">
            {hasViolation && (
              <span
                title="Dependency order violation"
                className="inline-flex items-center gap-0.5 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300"
              >
                <AlertTriangle className="h-3 w-3" />
                Order Conflict
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void moveCardToTimelineStep(card.id, Math.max(0, currentStep - 1));
              }}
              disabled={card.timelineOrder !== null && currentStep === 0}
              aria-label={`Move ${card.title} to earlier step`}
              title="Move to earlier step"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
            >
              <ArrowLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void moveCardToTimelineStep(
                  card.id,
                  card.timelineOrder === null ? 0 : currentStep + 1
                );
              }}
              aria-label={`Move ${card.title} to later step`}
              title="Move to later step"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-slate-100">{card.title}</h3>

        {card.content && (
          <div className="mt-1.5 max-h-20 overflow-hidden">
            <MarkdownContent content={card.content} compact />
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
          <div className="flex items-center gap-2">
            {prereqCount > 0 && <span>{prereqCount} prereq</span>}
            {depCount > 0 && <span>{depCount} next</span>}
          </div>
          {card.startAt && (
            <span className="inline-flex items-center gap-1 text-indigo-300">
              <Calendar className="h-2.5 w-2.5" />
              {card.startAt}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-950">
      {/* Timeline Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/70 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Timeline Sequence
          </span>
          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-300">
            {cards.length} card(s)
          </span>
          {jumpBackEdges.length > 0 && (
            <button
              type="button"
              aria-pressed={showLoops}
              onClick={() => setShowLoops((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                showLoops
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <RotateCcw className="h-3 w-3" />
              Show Loops ({jumpBackEdges.length})
            </button>
          )}
          {violations.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-300">
              <AlertTriangle className="h-3 w-3" />
              {violations.length} dependency violation(s)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void createCard({ title: 'New Timeline Card', cardType: 'task' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-indigo-500 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Card
          </button>
          <button
            type="button"
            onClick={() => void computeTimelineLayout()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-indigo-500"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Auto-Sort Timeline
          </button>
        </div>
      </div>

      {/* Real-time Dependency Violation Banner */}
      {violations.length > 0 && (
        <div
          role="alert"
          className="shrink-0 border-b border-rose-500/30 bg-rose-950/50 px-4 py-2 text-xs text-rose-200"
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Dependency Order Violations Detected
          </div>
          <ul className="ml-5 list-disc space-y-0.5 text-[11px] text-rose-200/90">
            {violations.map((v) => (
              <li key={v.edgeId}>{v.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Scrollable Timeline Canvas (Overhead Return Arcs + Step Columns) */}
      <div className="flex flex-1 flex-col overflow-x-auto">
        {showLoops && jumpBackEdges.length > 0 && (
          <div
            aria-label="Jump-back return arcs"
            className="shrink-0 border-b border-slate-800/80 bg-slate-900/30 px-0 pt-2"
            style={{ minWidth: `${totalLaneWidth}px` }}
          >
            <svg
              width={totalLaneWidth}
              height={Math.min(130, 56 + jumpBackEdges.length * 22)}
              className="block overflow-visible"
            >
              <defs>
                <marker
                  id="jump-back-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
                </marker>
              </defs>
              {jumpBackEdges.map((edge, idx) => {
                const src = cardById.get(edge.sourceCardId);
                const tgt = cardById.get(edge.targetCardId);
                if (!src || !tgt) return null;
                const srcStep = src.timelineOrder ?? 0;
                const tgtStep = tgt.timelineOrder ?? 0;
                const x1 = getStepCenterX(srcStep);
                const x2 = getStepCenterX(tgtStep);
                const svgHeight = Math.min(130, 56 + jumpBackEdges.length * 22);
                const baseY = svgHeight - 8;
                const arcHeight = Math.min(baseY - 18, 32 + idx * 18);
                const midX = x1 === x2 ? x1 + 40 : (x1 + x2) / 2;
                const controlY = baseY - arcHeight;
                const d =
                  x1 === x2
                    ? `M ${x1 + 14} ${baseY} C ${x1 + 52} ${controlY}, ${x1 - 52} ${controlY}, ${x1 - 14} ${baseY}`
                    : `M ${x1} ${baseY} Q ${midX} ${controlY} ${x2} ${baseY}`;

                const warning = warningByEdgeId.get(edge.id);
                const isFocused =
                  hoveredCardId === null ||
                  hoveredCardId === edge.sourceCardId ||
                  hoveredCardId === edge.targetCardId;
                const apexLabel = edge.label
                  ? `↩ ${edge.label}`
                  : `↩ ${src.title} → ${tgt.title}`;

                return (
                  <g
                    key={edge.id}
                    opacity={isFocused ? 1 : 0.22}
                    className="transition-opacity duration-200"
                  >
                    <path
                      d={d}
                      fill="none"
                      stroke={warning ? '#fbbf24' : '#f59e0b'}
                      strokeWidth={isFocused ? 2 : 1.5}
                      strokeDasharray="6 4"
                      markerEnd="url(#jump-back-arrow)"
                    />
                    <text
                      x={midX}
                      y={Math.max(14, controlY + 12)}
                      textAnchor="middle"
                      fill={warning ? '#fde68a' : '#fcd34d'}
                      fontSize="11"
                      fontWeight="600"
                    >
                      {warning ? `⚠ ${apexLabel}` : apexLabel}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Horizontal Step Columns */}
        <div className="flex flex-1 gap-4 p-4">
          {unassignedCards.length > 0 && (
            <section
              aria-label="Unscheduled cards"
              className="flex w-72 shrink-0 flex-col rounded-xl border border-dashed border-slate-700 bg-slate-900/40"
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Unscheduled
                </h2>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {unassignedCards.length}
                </span>
              </div>
              <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
                {unassignedCards.map(renderCard)}
              </div>
            </section>
          )}

          {stepNumbers.map((step) => {
            const stepCards = cardsByStep.get(step) ?? [];
            const isDropTarget = dragOverStep === step;
            return (
              <section
                key={step}
                aria-label={`Step ${step}`}
                onDragOver={(e) => handleDragOver(e, step)}
                onDragLeave={() => setDragOverStep(null)}
                onDrop={(e) => handleDrop(e, step)}
                className={`flex w-72 shrink-0 flex-col rounded-xl border transition-colors ${
                  isDropTarget
                    ? 'border-indigo-400 bg-indigo-950/30'
                    : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                    Step {step}
                  </h2>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {stepCards.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
                  {stepCards.length === 0 ? (
                    <p className="py-6 text-center text-xs italic text-slate-600">
                      Drop a card here
                    </p>
                  ) : (
                    stepCards.map(renderCard)
                  )}
                </div>
              </section>
            );
          })}

          {/* Drop target for creating a new step column at the end */}
          <section
            aria-label={`Step ${nextNewStep} drop zone`}
            onDragOver={(e) => handleDragOver(e, nextNewStep)}
            onDragLeave={() => setDragOverStep(null)}
            onDrop={(e) => handleDrop(e, nextNewStep)}
            className={`flex w-56 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center transition-colors ${
              dragOverStep === nextNewStep
                ? 'border-indigo-400 bg-indigo-950/30 text-indigo-300'
                : 'border-slate-800 bg-slate-900/20 text-slate-500'
            }`}
          >
            <Plus className="mb-1 h-5 w-5" />
            <span className="text-xs font-medium">Drop to create Step {nextNewStep}</span>
          </section>
        </div>
      </div>
    </div>
  );
}
