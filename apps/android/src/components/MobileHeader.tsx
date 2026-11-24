import { useState, type FormEvent } from 'react';
import { Layers, Plus, Download, FolderPlus, X } from 'lucide-react';
import type { BoardType } from '@ariadeck/core';
import { useMobileStore } from '../store/useMobileStore.ts';

export function MobileHeader() {
  const boards = useMobileStore((s) => s.boards);
  const activeBoardId = useMobileStore((s) => s.activeBoardId);
  const selectBoard = useMobileStore((s) => s.selectBoard);
  const createBoard = useMobileStore((s) => s.createBoard);
  const createCard = useMobileStore((s) => s.createCard);
  const exportMarkdown = useMobileStore((s) => s.exportMarkdown);

  const [modalOpen, setModalOpen] = useState(false);
  const [boardTitle, setBoardTitle] = useState('');
  const [boardType, setBoardType] = useState<BoardType>('flow');

  const handleCreateBoard = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = boardTitle.trim();
    if (!trimmed) return;
    await createBoard(trimmed, boardType);
    setBoardTitle('');
    setBoardType('flow');
    setModalOpen(false);
  };

  return (
    <>
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
            className="max-w-[150px] truncate rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-semibold text-white outline-none"
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
            onClick={() => setModalOpen(true)}
            aria-label="Create new board"
            title="Create new board"
            className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-200"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
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

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create New Board"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-4 sm:items-center"
        >
          <form
            onSubmit={(e) => void handleCreateBoard(e)}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Create New Board</h2>
              <button
                type="button"
                aria-label="Close board modal"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              type="text"
              aria-label="Mobile board title"
              placeholder="Board title..."
              value={boardTitle}
              onChange={(e) => setBoardTitle(e.target.value)}
              autoFocus
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
            />

            <div role="group" aria-label="Board type selector" className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={boardType === 'flow'}
                onClick={() => setBoardType('flow')}
                className={`rounded-xl border p-2.5 text-left transition ${
                  boardType === 'flow'
                    ? 'border-indigo-500 bg-indigo-600/20 text-white'
                    : 'border-slate-700 bg-slate-950 text-slate-400'
                }`}
              >
                <p className="text-xs font-semibold">Flow Board</p>
                <p className="mt-0.5 text-[10px] text-slate-400">Tasks, plots & timelines</p>
              </button>
              <button
                type="button"
                aria-pressed={boardType === 'flat'}
                onClick={() => setBoardType('flat')}
                className={`rounded-xl border p-2.5 text-left transition ${
                  boardType === 'flat'
                    ? 'border-emerald-500 bg-emerald-600/20 text-white'
                    : 'border-slate-700 bg-slate-950 text-slate-400'
                }`}
              >
                <p className="text-xs font-semibold">Flat Board</p>
                <p className="mt-0.5 text-[10px] text-slate-400">Characters & relationship maps</p>
              </button>
            </div>

            <button
              type="submit"
              disabled={!boardTitle.trim()}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              Create Board
            </button>
          </form>
        </div>
      )}
    </>
  );
}
