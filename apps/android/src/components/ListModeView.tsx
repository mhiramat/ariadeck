import { useMemo } from 'react';
import {
  Search,
  Paperclip,
  CheckSquare,
  Square,
  Trash2,
  GitMerge,
  Plus,
} from 'lucide-react';
import type { CardType } from '@ariadeck/core';
import { useMobileStore } from '../store/useMobileStore.ts';

const FILTER_TYPES: Array<{ value: CardType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'task', label: 'Task' },
  { value: 'idea', label: 'Idea' },
  { value: 'plot_event', label: 'Plot' },
  { value: 'note', label: 'Note' },
];

export function ListModeView() {
  const graph = useMobileStore((s) => s.graph);
  const searchQuery = useMobileStore((s) => s.searchQuery);
  const filterType = useMobileStore((s) => s.filterType);
  const multiSelectIds = useMobileStore((s) => s.multiSelectIds);
  const setSearchQuery = useMobileStore((s) => s.setSearchQuery);
  const setFilterType = useMobileStore((s) => s.setFilterType);
  const openCardEditor = useMobileStore((s) => s.openCardEditor);
  const toggleMultiSelect = useMobileStore((s) => s.toggleMultiSelect);
  const clearMultiSelect = useMobileStore((s) => s.clearMultiSelect);
  const deleteSelectedCards = useMobileStore((s) => s.deleteSelectedCards);
  const mergeSelectedCards = useMobileStore((s) => s.mergeSelectedCards);
  const createCard = useMobileStore((s) => s.createCard);

  const cards = graph?.cards ?? [];
  const attachments = graph?.attachments ?? [];

  const attachmentInfoByCard = useMemo(() => {
    const map = new Map<string, { count: number; transcripts: string[] }>();
    for (const att of attachments) {
      const entry = map.get(att.cardId) ?? { count: 0, transcripts: [] };
      entry.count += 1;
      if (att.transcript) entry.transcripts.push(att.transcript);
      map.set(att.cardId, entry);
    }
    return map;
  }, [attachments]);

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cards.filter((card) => {
      if (filterType !== 'all' && card.cardType !== filterType) {
        return false;
      }
      if (!q) return true;
      if (card.title.toLowerCase().includes(q)) return true;
      if (card.content.toLowerCase().includes(q)) return true;
      if (card.tags.some((t) => t.toLowerCase().includes(q))) return true;
      const attInfo = attachmentInfoByCard.get(card.id);
      if (attInfo?.transcripts.some((tr) => tr.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [cards, filterType, searchQuery, attachmentInfoByCard]);

  const isMultiSelecting = multiSelectIds.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-950">
      {/* Search & Filter Bar */}
      <div className="shrink-0 space-y-2 border-b border-slate-800 bg-slate-900/80 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="Search cards and transcripts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search titles, Markdown, tags, transcripts..."
            className="w-full rounded-xl border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {FILTER_TYPES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilterType(item.value)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                filterType === item.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Multi-Select Action Bar */}
      {isMultiSelecting && (
        <div className="flex shrink-0 items-center justify-between border-b border-indigo-500/40 bg-indigo-950/60 px-3 py-2 text-xs">
          <span className="font-semibold text-indigo-200">
            {multiSelectIds.length} selected
          </span>
          <div className="flex items-center gap-2">
            {multiSelectIds.length >= 2 && (
              <button
                type="button"
                onClick={() => void mergeSelectedCards('Merged Card')}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 font-semibold text-white"
              >
                <GitMerge className="h-3.5 w-3.5" />
                Merge
              </button>
            )}
            <button
              type="button"
              onClick={() => void deleteSelectedCards()}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
            <button
              type="button"
              onClick={clearMultiSelect}
              className="rounded px-2 py-1 text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Card List */}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {filteredCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <p className="text-sm text-slate-400">No matching cards found.</p>
            <button
              type="button"
              onClick={() => void createCard('New Idea', 'idea')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Create First Card
            </button>
          </div>
        ) : (
          filteredCards.map((card) => {
            const selected = multiSelectIds.includes(card.id);
            const attCount = attachmentInfoByCard.get(card.id)?.count ?? 0;

            return (
              <div
                key={card.id}
                onClick={() =>
                  isMultiSelecting ? toggleMultiSelect(card.id) : openCardEditor(card.id)
                }
                className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${
                  selected
                    ? 'border-indigo-400 bg-indigo-950/40'
                    : 'border-slate-800 bg-slate-900 active:bg-slate-800'
                }`}
              >
                <button
                  type="button"
                  aria-label={`Select ${card.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMultiSelect(card.id);
                  }}
                  className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-400"
                >
                  {selected ? (
                    <CheckSquare className="h-5 w-5 text-indigo-400" />
                  ) : (
                    <Square className="h-5 w-5" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-white">{card.title}</h3>
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
                      {card.cardType}
                    </span>
                  </div>
                  {card.content && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{card.content}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span className="capitalize">{card.status.replace('_', ' ')}</span>
                    {attCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-indigo-300">
                        <Paperclip className="h-3 w-3" />
                        {attCount}
                      </span>
                    )}
                    {card.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
