import { List, FileEdit, GitBranch, Clock } from 'lucide-react';
import { useMobileStore, type MobileViewMode } from '../store/useMobileStore.ts';

const NAV_ITEMS: Array<{ mode: MobileViewMode; label: string; icon: typeof List }> = [
  { mode: 'list', label: 'List', icon: List },
  { mode: 'edit', label: 'Card Edit', icon: FileEdit },
  { mode: 'relations', label: 'Relations', icon: GitBranch },
  { mode: 'timeline', label: 'Timeline', icon: Clock },
];

export function BottomNavBar() {
  const activeMode = useMobileStore((s) => s.activeMode);
  const setActiveMode = useMobileStore((s) => s.setActiveMode);
  const graph = useMobileStore((s) => s.graph);
  const isFlatBoard = (graph?.board.boardType ?? 'flow') === 'flat';

  return (
    <nav
      aria-label="Mobile navigation"
      className="grid shrink-0 grid-cols-4 border-t border-slate-800 bg-slate-900 pb-safe"
    >
      {NAV_ITEMS.map(({ mode, label, icon: Icon }) => {
        const active = activeMode === mode;
        const disabled = mode === 'timeline' && isFlatBoard;
        return (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            title={disabled ? 'Timeline view is available for Flow boards' : label}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (!disabled) setActiveMode(mode);
            }}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${
              active ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
