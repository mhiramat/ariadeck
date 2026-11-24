import { useState, type FormEvent } from 'react';
import { X, Plus, Pencil, Trash2, Check, FolderKanban } from 'lucide-react';
import type { Board, BoardType } from '@ariadeck/core';
import { useBoardStore } from '../store/useBoardStore.ts';

export function BoardListPanel() {
  const boardListOpen = useBoardStore((s) => s.boardListOpen);
  const setBoardListOpen = useBoardStore((s) => s.setBoardListOpen);
  const boards = useBoardStore((s) => s.boards);
  const activeBoardId = useBoardStore((s) => s.activeBoardId);
  const selectBoard = useBoardStore((s) => s.selectBoard);
  const createBoard = useBoardStore((s) => s.createBoard);
  const updateBoard = useBoardStore((s) => s.updateBoard);
  const deleteBoard = useBoardStore((s) => s.deleteBoard);

  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newBoardType, setNewBoardType] = useState<BoardType>('flow');

  if (!boardListOpen) {
    return null;
  }

  const startEditing = (board: Board) => {
    setEditingBoardId(board.id);
    setEditTitle(board.title);
    setEditDescription(board.description);
  };

  const cancelEditing = () => {
    setEditingBoardId(null);
    setEditTitle('');
    setEditDescription('');
  };

  const handleSaveEdit = async (e: FormEvent, boardId: string) => {
    e.preventDefault();
    const trimmed = editTitle.trim();
    if (!trimmed) return;
    await updateBoard(boardId, {
      title: trimmed,
      description: editDescription.trim(),
    });
    cancelEditing();
  };

  const handleCreateBoard = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    await createBoard(trimmed, newDescription.trim(), newBoardType);
    setNewTitle('');
    setNewDescription('');
    setNewBoardType('flow');
  };

  return (
    <aside
      aria-label="Board list"
      className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900/95 text-slate-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Boards ({boards.length})
          </span>
        </div>
        <button
          type="button"
          onClick={() => setBoardListOpen(false)}
          aria-label="Close board list"
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {boards.map((board) => {
          const isActive = board.id === activeBoardId;
          const isEditing = editingBoardId === board.id;

          if (isEditing) {
            return (
              <form
                key={board.id}
                onSubmit={(e) => void handleSaveEdit(e, board.id)}
                className="space-y-2 rounded-lg border border-indigo-500 bg-slate-950 p-2.5"
              >
                <input
                  type="text"
                  aria-label="Board title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                  className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-white outline-none focus:border-indigo-500"
                />
                <textarea
                  aria-label="Board description"
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Optional description..."
                  className="w-full resize-none rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-indigo-500"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="rounded px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                  >
                    <Check className="h-3 w-3" />
                    Save
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div
              key={board.id}
              onClick={() => void selectBoard(board.id)}
              className={`group cursor-pointer rounded-lg border p-2.5 transition ${
                isActive
                  ? 'border-indigo-500/70 bg-indigo-600/15'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-xs font-semibold text-slate-100">{board.title}</p>
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
                        (board.boardType ?? 'flow') === 'flat'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-indigo-500/20 text-indigo-300'
                      }`}
                    >
                      {board.boardType ?? 'flow'}
                    </span>
                  </div>
                  {board.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">
                      {board.description}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(board);
                    }}
                    aria-label={`Rename ${board.title}`}
                    title="Rename board"
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={boards.length <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteBoard(board.id);
                    }}
                    aria-label={`Delete ${board.title}`}
                    title={
                      boards.length <= 1
                        ? 'At least one board must remain'
                        : 'Delete board'
                    }
                    className="rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-30"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => void handleCreateBoard(e)}
        className="space-y-2 border-t border-slate-800 p-3"
      >
        <p className="text-[11px] font-medium text-slate-400">Create New Board</p>
        <input
          type="text"
          aria-label="New board title"
          placeholder="Board title..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
        />
        <input
          type="text"
          aria-label="New board description"
          placeholder="Description (optional)"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setNewBoardType('flow')}
            className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
              newBoardType === 'flow'
                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Flow (Timeline)
          </button>
          <button
            type="button"
            onClick={() => setNewBoardType('flat')}
            className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
              newBoardType === 'flat'
                ? 'border-emerald-500 bg-emerald-600/20 text-emerald-200'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Flat (Network)
          </button>
        </div>
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Board
        </button>
      </form>
    </aside>
  );
}
