import { useMemo } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, RotateCcw, Sparkles } from 'lucide-react';
import { detectTimelineViolations, type Card, type Edge } from '@ariadeck/core';
import { useMobileStore } from '../store/useMobileStore.ts';

export function MobileTimelineView() {
  const graph = useMobileStore((s) => s.graph);
  const openCardEditor = useMobileStore((s) => s.openCardEditor);
  const computeTimelineLayout = useMobileStore((s) => s.computeTimelineLayout);
  const moveCardToTimelineStep = useMobileStore((s) => s.moveCardToTimelineStep);

  const cards = graph?.cards ?? [];
  const edges = graph?.edges ?? [];

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const jumpBacksBySource = useMemo(() => {
    const map = new Map<string, Edge[]>();
    for (const edge of edges) {
      if (edge.deletedAt !== null || edge.relationType !== 'jump_back') continue;
      const list = map.get(edge.sourceCardId);
      if (list) list.push(edge);
      else map.set(edge.sourceCardId, [edge]);
    }
    return map;
  }, [edges]);

  const violations = useMemo(
    () => detectTimelineViolations(cards, edges),
    [cards, edges]
  );

  const violatedCardIds = useMemo(() => {
    const set = new Set<string>();
    for (const v of violations) {
      set.add(v.sourceCardId);
      set.add(v.targetCardId);
    }
    return set;
  }, [violations]);

  const groupedSteps = useMemo(() => {
    const byStep = new Map<number, Card[]>();
    for (const card of cards) {
      const step = card.timelineOrder ?? 0;
      const list = byStep.get(step);
      if (list) list.push(card);
      else byStep.set(step, [card]);
    }
    return Array.from(byStep.entries()).sort(([a], [b]) => a - b);
  }, [cards]);

  const scrollToCard = (targetCardId: string) => {
    const el = document.getElementById(`mobile-timeline-card-${targetCardId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-950">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Vertical Timeline
        </span>
        <button
          type="button"
          onClick={() => void computeTimelineLayout()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Auto-Sort
        </button>
      </div>

      {violations.length > 0 && (
        <div
          role="alert"
          className="shrink-0 border-b border-rose-500/40 bg-rose-950/60 px-3 py-2 text-xs text-rose-200"
        >
          <p className="flex items-center gap-1.5 font-semibold text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            {violations.length} Dependency Violation(s)
          </p>
          <ul className="ml-4 mt-1 list-disc space-y-0.5 text-[11px]">
            {violations.map((v) => (
              <li key={v.edgeId}>{v.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-3.5">
        {groupedSteps.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">
            Add cards to organize them chronologically.
          </p>
        ) : (
          groupedSteps.map(([step, stepCards]) => (
            <section key={step} aria-label={`Step ${step}`} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-indigo-600/20 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300">
                  Step {step}
                </span>
                <div className="h-px flex-1 bg-slate-800" />
              </div>

              {stepCards.map((card) => {
                const hasViolation = violatedCardIds.has(card.id);
                const currentStep = card.timelineOrder ?? 0;
                const jumpBacks = jumpBacksBySource.get(card.id) ?? [];

                return (
                  <div
                    key={card.id}
                    id={`mobile-timeline-card-${card.id}`}
                    onClick={() => openCardEditor(card.id)}
                    className={`rounded-xl border p-3 ${
                      hasViolation
                        ? 'border-rose-500 bg-rose-950/30'
                        : 'border-slate-800 bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{card.title}</p>
                        <p className="text-[11px] text-slate-400">
                          {card.cardType} · {card.status.replace('_', ' ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={currentStep === 0}
                          aria-label={`Move ${card.title} earlier`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void moveCardToTimelineStep(card.id, Math.max(0, currentStep - 1));
                          }}
                          className="rounded-lg bg-slate-800 p-1.5 text-slate-300 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${card.title} later`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void moveCardToTimelineStep(card.id, currentStep + 1);
                          }}
                          className="rounded-lg bg-slate-800 p-1.5 text-slate-300"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {jumpBacks.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {jumpBacks.map((jb) => {
                          const targetTitle = cardById.get(jb.targetCardId)?.title ?? jb.targetCardId;
                          return (
                            <button
                              key={jb.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                scrollToCard(jb.targetCardId);
                              }}
                              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-200"
                            >
                              <RotateCcw className="h-2.5 w-2.5 text-amber-400" />
                              Jumps back to: {targetTitle}
                              {jb.label ? ` (${jb.label})` : ''}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
