import { Layers, Plus, Download } from 'lucide-react';
import { useMobileStore } from '../store/useMobileStore.ts';

export function MobileHeader() {
  const boards = useMobileStore((s) => s.boards);
  const activeBoardId = useMobileStore((s) => s.activeBoardId);
  const selectBoard = useMobileStore((s) => s.selectBoard);
  const createCard = useMobileStore((s) => s.createCard);
  const exportMarkdown = useMobileStore((s) => s.exportMarkdown);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 pt-safe">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <Layers className="h-4 w-4" />
        </div>
        <select
          aria-label="Select mobile board"
          value={activeBoardId ?? ''}
          onChange={(e) => {
            if (e.target.value) void selectBoard(e.target.value);
          }}
          className="max-w-[160px] truncate rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-semibold text-white outline-none"
        >
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void exportMarkdown()}
          aria-label="Export Markdown"
          title="Export board to Markdown"
          className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-200"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void createCard('New Card', 'idea')}
          aria-label="Quick create card"
          title="Create new card"
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>
    </header>
  );
}
