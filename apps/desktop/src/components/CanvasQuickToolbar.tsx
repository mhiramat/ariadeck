import { Plus } from 'lucide-react';
import type { CardType } from '@ariadeck/core';

interface CanvasQuickToolbarProps {
  onCreateCard: (cardType: CardType) => void;
}

const QUICK_TYPES: Array<{ type: CardType; label: string }> = [
  { type: 'idea', label: 'Idea' },
  { type: 'task', label: 'Task' },
  { type: 'plot_event', label: 'Plot' },
  { type: 'note', label: 'Note' },
];

export function CanvasQuickToolbar({ onCreateCard }: CanvasQuickToolbarProps) {
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
      <span className="hidden border-l border-slate-700 pl-2 text-[11px] text-slate-400 md:inline">
        Double-click canvas to add card
      </span>
    </div>
  );
}
