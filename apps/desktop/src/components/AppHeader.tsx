import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Layers,
  Plus,
  GitBranch,
  Clock,
  Radio,
  FolderKanban,
  Pencil,
  Check,
  X,
  Download,
  Upload,
  FileJson,
  Cloud,
  AlertTriangle,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import type { BoardType } from '@ariadeck/core';
import { useBoardStore } from '../store/useBoardStore.ts';

export function AppHeader() {
  const boards = useBoardStore((s) => s.boards);
  const activeBoardId = useBoardStore((s) => s.activeBoardId);
  const boardListOpen = useBoardStore((s) => s.boardListOpen);
  const conflicts = useBoardStore((s) => s.conflicts);
  const syncConfigured = useBoardStore((s) => s.syncConfigured);
  const syncing = useBoardStore((s) => s.syncing);
  const authRequired = useBoardStore((s) => s.authRequired);
  const authenticated = useBoardStore((s) => s.authenticated);
  const viewMode = useBoardStore((s) => s.viewMode);
  const connectionStatus = useBoardStore((s) => s.connectionStatus);
  const selectBoard = useBoardStore((s) => s.selectBoard);
  const createBoard = useBoardStore((s) => s.createBoard);
  const updateBoard = useBoardStore((s) => s.updateBoard);
  const toggleBoardList = useBoardStore((s) => s.toggleBoardList);
  const setConflictModalOpen = useBoardStore((s) => s.setConflictModalOpen);
  const triggerSync = useBoardStore((s) => s.triggerSync);
  const exportMarkdown = useBoardStore((s) => s.exportMarkdown);
  const exportJson = useBoardStore((s) => s.exportJson);
  const importJson = useBoardStore((s) => s.importJson);
  const logout = useBoardStore((s) => s.logout);
  const setViewMode = useBoardStore((s) => s.setViewMode);

  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newBoardType, setNewBoardType] = useState<BoardType>('flow');
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;
  const activeBoardType: BoardType = activeBoard?.boardType ?? 'flow';
  const isFlatBoard = activeBoardType === 'flat';

  // Close the brand dropdown menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleCreateBoard = async (e: FormEvent) => {
    e.preventDefault();
    const title = newBoardTitle.trim();
    if (!title) return;
    await createBoard(title, '', newBoardType);
    setNewBoardTitle('');
    setNewBoardType('flow');
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

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    await importJson(text);
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
      <div className="flex items-center gap-3">
        {/* Brand Menu Dropdown (Boards, New Board, Export MD) */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-800"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow">
              <Layers className="h-4 w-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">Ariadeck</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                menuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="Ariadeck menu"
              className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 p-1.5 shadow-2xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleBoardList();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <FolderKanban className="h-3.5 w-3.5 text-indigo-400" />
                  Boards
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {boardListOpen ? 'Open' : boards.length}
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setCreatingBoard(true);
                  setRenamingBoard(false);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5 text-emerald-400" />
                New Board
              </button>

              <div className="my-1 h-px bg-slate-800" />

              <button
                type="button"
                role="menuitem"
                disabled={!activeBoardId}
                onClick={() => {
                  setMenuOpen(false);
                  void exportMarkdown();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5 text-sky-400" />
                Export MD
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={!activeBoardId}
                onClick={() => {
                  setMenuOpen(false);
                  void exportJson();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white disabled:opacity-40"
              >
                <FileJson className="h-3.5 w-3.5 text-amber-400" />
                Export JSON
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
              >
                <Upload className="h-3.5 w-3.5 text-violet-400" />
                Import JSON
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Import board JSON file"
            onChange={(e) => void handleImportFileChange(e)}
            className="hidden"
          />
        </div>

        <div className="h-5 w-px bg-slate-800" />

        {/* Compact Active Board Switcher / Inline Rename / Inline Create */}
        <div className="flex items-center gap-2">
          {creatingBoard ? (
            <form onSubmit={(e) => void handleCreateBoard(e)} className="flex items-center gap-1.5">
              <input
                type="text"
                aria-label="New board title"
                placeholder="New board title..."
                value={newBoardTitle}
                onChange={(e) => setNewBoardTitle(e.target.value)}
                autoFocus
                className="w-40 rounded-lg border border-indigo-500 bg-slate-800 px-2.5 py-1 text-xs text-white outline-none"
              />
              <select
                aria-label="New board type"
                value={newBoardType}
                onChange={(e) => setNewBoardType(e.target.value as BoardType)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-indigo-500"
              >
                <option value="flow">Flow</option>
                <option value="flat">Flat</option>
              </select>
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
          ) : renamingBoard && activeBoard ? (
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
                <>
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      isFlatBoard
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                    }`}
                  >
                    {activeBoardType}
                  </span>
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
                </>
              )}
            </>
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
            disabled={isFlatBoard}
            title={
              isFlatBoard
                ? 'Timeline view is available for Flow boards'
                : 'Switch to Timeline view'
            }
            onClick={() => {
              if (!isFlatBoard) setViewMode('timeline');
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
              viewMode === 'timeline'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            Timeline
          </button>
        </div>

        {conflicts.length > 0 ? (
          <button
            type="button"
            onClick={() => setConflictModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {conflicts.length} Conflict(s)
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              syncConfigured ? void triggerSync() : setConflictModalOpen(true)
            }
            disabled={syncing}
            title={
              syncConfigured
                ? 'Sync board with Google Drive (Ariadeck/)'
                : 'Google Drive sync status'
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-indigo-500 hover:text-white disabled:opacity-50"
          >
            <Cloud className={`h-3.5 w-3.5 ${syncing ? 'animate-pulse text-indigo-400' : ''}`} />
            <span>{syncing ? 'Syncing...' : syncConfigured ? 'Sync Drive' : 'Local'}</span>
          </button>
        )}

        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusConfig.cls}`}
          title="ariadeck-mcp real-time bridge status"
        >
          <Radio className="h-3 w-3" />
          <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
          <span>{statusConfig.text}</span>
        </div>

        {authRequired && authenticated && (
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 transition hover:border-rose-500/60 hover:text-rose-200"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </header>
  );
}
