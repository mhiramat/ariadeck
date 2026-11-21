import { useState, type FormEvent } from 'react';
import { Layers, Plus, GitBranch, Clock, Radio, FolderKanban, Pencil, Check, X } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore.ts';

export function AppHeader() {
  const boards = useBoardStore((s) => s.boards);
  const activeBoardId = useBoardStore((s) => s.activeBoardId);
  const boardListOpen = useBoardStore((s) => s.boardListOpen);
  const viewMode = useBoardStore((s) => s.viewMode);
  const connectionStatus = useBoardStore((s) => s.connectionStatus);
  const selectBoard = useBoardStore((s) => s.selectBoard);
  const createBoard = useBoardStore((s) => s.createBoard);
  const updateBoard = useBoardStore((s) => s.updateBoard);
  const toggleBoardList = useBoardStore((s) => s.toggleBoardList);
  const setViewMode = useBoardStore((s) => s.setViewMode);

  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;

  const handleCreateBoard = async (e: FormEvent) => {
    e.preventDefault();
    const title = newBoardTitle.trim();
    if (!title) return;
    await createBoard(title);
    setNewBoardTitle('');
    setCreatingBoard(false);
  };

  const handleRenameBoard = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeBoard) return;
    const title = renameTitle.trim();
    if (!title) return;
    await updateBoard(activeBoard.id, { title });
    setRenamingBoard(false);
  };

  const statusConfig = {
    connected: {
      dot: 'bg-emerald-400',
      text: 'MCP Live',
      cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    },
    connecting: {
      dot: 'bg-amber-400 animate-pulse',
      text: 'Connecting',
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    },
    disconnected: {
      dot: 'bg-rose-400',
      text: 'MCP Offline',
      cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    },
  }[connectionStatus];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow">
            <Layers className="h-4 w-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">Ariadeck</span>
        </div>

        <div className="h-5 w-px bg-slate-800" />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleBoardList}
            aria-pressed={boardListOpen}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              boardListOpen
                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-indigo-500 hover:text-white'
            }`}
          >
            <FolderKanban className="h-3.5 w-3.5" />
            Boards
            <span className="rounded bg-slate-900/80 px-1.5 py-0.2 text-[10px] text-slate-300">
              {boards.length}
            </span>
          </button>

          {renamingBoard && activeBoard ? (
            <form onSubmit={(e) => void handleRenameBoard(e)} className="flex items-center gap-1">
              <input
                type="text"
                aria-label="Rename active board"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                autoFocus
                className="w-44 rounded-lg border border-indigo-500 bg-slate-800 px-2.5 py-1 text-xs text-white outline-none"
              />
              <button
                type="submit"
                aria-label="Confirm board rename"
                className="rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-500"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Cancel board rename"
                onClick={() => setRenamingBoard(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <>
              <select
                aria-label="Select board"
                value={activeBoardId ?? ''}
                onChange={(e) => {
                  if (e.target.value) {
                    void selectBoard(e.target.value);
                  }
                }}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 outline-none focus:border-indigo-500"
              >
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.title}
                  </option>
                ))}
              </select>

              {activeBoard && (
                <button
                  type="button"
                  onClick={() => {
                    setRenameTitle(activeBoard.title);
                    setRenamingBoard(true);
                  }}
                  aria-label="Rename current board"
                  title="Rename current board"
                  className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 transition hover:border-indigo-500 hover:text-white"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}

          {creatingBoard ? (
            <form onSubmit={(e) => void handleCreateBoard(e)} className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="New board title..."
                value={newBoardTitle}
                onChange={(e) => setNewBoardTitle(e.target.value)}
                autoFocus
                className="w-40 rounded-lg border border-indigo-500 bg-slate-800 px-2 py-1 text-xs text-white outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreatingBoard(false)}
                className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingBoard(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-indigo-500 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              New Board
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          role="tablist"
          aria-label="View mode"
          className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'graph'}
            onClick={() => setViewMode('graph')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
              viewMode === 'graph'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Graph
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'timeline'}
            onClick={() => setViewMode('timeline')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
              viewMode === 'timeline'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            Timeline
          </button>
        </div>

        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusConfig.cls}`}
          title="ariadeck-mcp real-time bridge status"
        >
          <Radio className="h-3 w-3" />
          <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
          <span>{statusConfig.text}</span>
        </div>
      </div>
    </header>
  );
}
