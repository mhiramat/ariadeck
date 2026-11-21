import { useEffect, useState } from 'react';
import { X, Trash2, Split, Save, Eye, Pencil } from 'lucide-react';
import type { CardStatus, CardType } from '@ariadeck/core';
import { useBoardStore } from '../store/useBoardStore.ts';
import { MarkdownContent } from './MarkdownContent.tsx';

export function InspectorPanel() {
  const graph = useBoardStore((s) => s.graph);
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const selectCard = useBoardStore((s) => s.selectCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const deleteCard = useBoardStore((s) => s.deleteCard);
  const splitCard = useBoardStore((s) => s.splitCard);

  const selectedCard =
    selectedCardId && graph
      ? graph.cards.find((c) => c.id === selectedCardId) ?? null
      : null;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [cardType, setCardType] = useState<CardType>('idea');
  const [status, setStatus] = useState<CardStatus>('todo');
  const [tagsInput, setTagsInput] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [contentTab, setContentTab] = useState<'write' | 'preview'>('write');

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitLines, setSplitLines] = useState('');
  const [splitMode, setSplitMode] = useState<'sequential' | 'parallel'>('sequential');

  useEffect(() => {
    if (selectedCard) {
      setTitle(selectedCard.title);
      setContent(selectedCard.content);
      setCardType(selectedCard.cardType);
      setStatus(selectedCard.status);
      setTagsInput(selectedCard.tags.join(', '));
      setStartAt(selectedCard.startAt ?? '');
      setEndAt(selectedCard.endAt ?? '');
      setSplitOpen(false);
      setSplitLines('');
    }
  }, [selectedCard]);

  if (!selectedCard) {
    return null;
  }

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    await updateCard(selectedCard.id, {
      title: trimmed,
      content,
      cardType,
      status,
      tags,
      startAt: startAt.trim() ? startAt.trim() : null,
      endAt: endAt.trim() ? endAt.trim() : null,
    });
  };

  const handleSplit = async () => {
    const subTitles = splitLines
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (subTitles.length < 2) return;
    await splitCard(
      selectedCard.id,
      subTitles.map((t) => ({ title: t, content: '' })),
      splitMode
    );
    setSplitOpen(false);
    setSplitLines('');
  };

  return (
    <aside
      aria-label="Card inspector"
      className="flex h-full w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-900/95 text-slate-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Card Inspector
        </span>
        <button
          type="button"
          onClick={() => selectCard(null)}
          aria-label="Close inspector"
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <label htmlFor="inspector-title" className="mb-1 block text-xs font-medium text-slate-400">
            Title
          </label>
          <input
            id="inspector-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="inspector-type" className="mb-1 block text-xs font-medium text-slate-400">
              Type
            </label>
            <select
              id="inspector-type"
              value={cardType}
              onChange={(e) => setCardType(e.target.value as CardType)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
            >
              <option value="idea">Idea</option>
              <option value="task">Task</option>
              <option value="plot_event">Plot Event</option>
              <option value="note">Note</option>
            </select>
          </div>

          <div>
            <label htmlFor="inspector-status" className="mb-1 block text-xs font-medium text-slate-400">
              Status
            </label>
            <select
              id="inspector-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as CardStatus)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
            >
              <option value="todo">Todo</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="inspector-tags" className="mb-1 block text-xs font-medium text-slate-400">
            Tags (comma-separated)
          </label>
          <input
            id="inspector-tags"
            type="text"
            placeholder="e.g. backend, urgent"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="inspector-start-at" className="mb-1 block text-xs font-medium text-slate-400">
              Start (ISO / Date)
            </label>
            <input
              id="inspector-start-at"
              type="text"
              placeholder="2026-06-01"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="inspector-end-at" className="mb-1 block text-xs font-medium text-slate-400">
              End (ISO / Date)
            </label>
            <input
              id="inspector-end-at"
              type="text"
              placeholder="2026-06-05"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="inspector-content" className="block text-xs font-medium text-slate-400">
              Markdown Content
            </label>
            <div className="flex items-center rounded-md border border-slate-700 bg-slate-950 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setContentTab('write')}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition ${
                  contentTab === 'write'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Pencil className="h-2.5 w-2.5" />
                Write
              </button>
              <button
                type="button"
                onClick={() => setContentTab('preview')}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition ${
                  contentTab === 'preview'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="h-2.5 w-2.5" />
                Preview
              </button>
            </div>
          </div>

          {contentTab === 'write' ? (
            <textarea
              id="inspector-content"
              rows={7}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write details in Markdown..."
              className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800 p-2.5 font-mono text-xs text-slate-100 outline-none focus:border-indigo-500"
            />
          ) : (
            <div
              aria-label="Markdown preview"
              className="min-h-[10.5rem] rounded-lg border border-slate-700 bg-slate-950/80 p-3"
            >
              {content.trim() ? (
                <MarkdownContent content={content} />
              ) : (
                <p className="text-xs italic text-slate-500">Nothing to preview yet.</p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
        >
          <Save className="h-3.5 w-3.5" />
          Save Changes
        </button>

        <div className="border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setSplitOpen((prev) => !prev)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-indigo-500 hover:text-white"
          >
            <Split className="h-3.5 w-3.5" />
            Split Card
          </button>

          {splitOpen && (
            <div className="mt-3 space-y-2.5 rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-[11px] text-slate-400">
                Enter at least 2 child card titles (one per line):
              </p>
              <textarea
                aria-label="Child card titles"
                rows={4}
                value={splitLines}
                onChange={(e) => setSplitLines(e.target.value)}
                placeholder={'Step 1\nStep 2'}
                className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-white outline-none focus:border-indigo-500"
              />
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-slate-300">
                  <input
                    type="radio"
                    name="splitMode"
                    checked={splitMode === 'sequential'}
                    onChange={() => setSplitMode('sequential')}
                  />
                  Sequential
                </label>
                <label className="flex items-center gap-1 text-slate-300">
                  <input
                    type="radio"
                    name="splitMode"
                    checked={splitMode === 'parallel'}
                    onChange={() => setSplitMode('parallel')}
                  />
                  Parallel
                </label>
              </div>
              <button
                type="button"
                onClick={() => void handleSplit()}
                className="w-full rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
              >
                Execute Split
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-800 p-4">
        <button
          type="button"
          onClick={() => void deleteCard(selectedCard.id)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Card
        </button>
      </div>
    </aside>
  );
}
