import { LayoutGrid, Plus, RotateCcw, Sparkles } from 'lucide-react';
import type { BoardType, CardType, EdgeDirection } from '@ariadeck/core';

interface CanvasQuickToolbarProps {
  boardType: BoardType;
  flatEdgeDirection: EdgeDirection;
  onFlatEdgeDirectionChange: (dir: EdgeDirection) => void;
  jumpBackMode: boolean;
  onToggleJumpBackMode: () => void;
  onCreateCard: (cardType: CardType) => void;
  onAutoLayout: () => void;
  hasCards: boolean;
}

const QUICK_TYPES: Array<{ type: CardType; label: string }> = [
  { type: 'idea', label: 'Idea' },
  { type: 'task', label: 'Task' },
  { type: 'plot_event', label: 'Plot' },
  { type: 'note', label: 'Note' },
];

const FLAT_DIRECTIONS: Array<{ value: EdgeDirection; label: string; title: string }> = [
  { value: 'directed', label: '→', title: 'Directed arrow edge' },
  { value: 'bidirectional', label: '↔', title: 'Bidirectional edge (rivalry / mutual)' },
  { value: 'undirected', label: '—', title: 'Undirected edge (shared trait / symbiosis)' },
];

export function CanvasQuickToolbar({
  boardType,
  flatEdgeDirection,
  onFlatEdgeDirectionChange,
  jumpBackMode,
  onToggleJumpBackMode,
  onCreateCard,
  onAutoLayout,
  hasCards,
}: CanvasQuickToolbarProps) {
  return (
    <div className="pointer-events-auto absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 shadow-xl backdrop-blur">
      {QUICK_TYPES.map((item) => (
        <button
          key={item.type}
          type="button"
          onClick={() => onCreateCard(item.type)}
          className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 transition hover:bg-indigo-600 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          {item.label}
        </button>
      ))}
      <div className="h-4 w-px bg-slate-700" />

      {boardType === 'flat' ? (
        <div
          role="group"
          aria-label="Flat edge direction mode"
          className="flex items-center rounded-full border border-slate-700 bg-slate-950 p-0.5"
        >
          {FLAT_DIRECTIONS.map((dir) => (
            <button
              key={dir.value}
              type="button"
              title={dir.title}
              aria-pressed={flatEdgeDirection === dir.value}
              onClick={() => onFlatEdgeDirectionChange(dir.value)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                flatEdgeDirection === dir.value
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {dir.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          aria-pressed={jumpBackMode}
          onClick={onToggleJumpBackMode}
          title="Toggle Jump-Back loop creation mode when dragging between cards"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
            jumpBackMode
              ? 'border-amber-400 bg-amber-500/20 text-amber-200'
              : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-amber-500/60 hover:text-amber-200'
          }`}
        >
          <RotateCcw className="h-3 w-3" />
          Loop
        </button>
      )}

      <button
        type="button"
        onClick={onAutoLayout}
        disabled={!hasCards}
        title={
          boardType === 'flat'
            ? 'Auto-arrange relationship map using force-directed layout'
            : 'Automatically arrange cards left-to-right by dependency order'
        }
        className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600/90 px-3 py-1 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
      >
        {boardType === 'flat' ? (
          <>
            <Sparkles className="h-3.5 w-3.5" />
            Auto-Arrange
          </>
        ) : (
          <>
            <LayoutGrid className="h-3.5 w-3.5" />
            Auto-Layout
          </>
        )}
      </button>
      <span className="hidden border-l border-slate-700 pl-2 text-[11px] text-slate-400 lg:inline">
        Double-click canvas to add card
      </span>
    </div>
  );
}
