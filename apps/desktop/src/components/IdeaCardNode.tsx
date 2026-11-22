import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Paperclip } from 'lucide-react';
import type { Card, CardStatus, CardType } from '@ariadeck/core';
import { MarkdownContent } from './MarkdownContent.tsx';

export interface IdeaCardNodeData extends Record<string, unknown> {
  card: Card;
  attachmentCount: number;
  onRename: (cardId: string, title: string) => void;
}

export type IdeaCardFlowNode = Node<IdeaCardNodeData, 'ideaCard'>;

const CARD_TYPE_STYLES: Record<CardType, { label: string; badge: string; border: string }> = {
  task: {
    label: 'Task',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    border: 'border-sky-500/40',
  },
  idea: {
    label: 'Idea',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    border: 'border-amber-500/40',
  },
  plot_event: {
    label: 'Plot Event',
    badge: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
    border: 'border-violet-500/40',
  },
  note: {
    label: 'Note',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    border: 'border-emerald-500/40',
  },
};

const STATUS_DOT: Record<CardStatus, string> = {
  todo: 'bg-slate-400',
  in_progress: 'bg-sky-400',
  done: 'bg-emerald-400',
  archived: 'bg-slate-600',
};

export function IdeaCardNode({ data, selected }: NodeProps<IdeaCardFlowNode>) {
  const { card, attachmentCount, onRename } = data;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(card.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTitle(card.title);
  }, [card.title]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitTitle = () => {
    setEditing(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== card.title) {
      onRename(card.id, trimmed);
    } else {
      setDraftTitle(card.title);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraftTitle(card.title);
      setEditing(false);
    }
  };

  const typeStyle = CARD_TYPE_STYLES[card.cardType];

  return (
    <div
      className={`w-64 rounded-xl border bg-slate-900/95 p-3 shadow-lg transition-all ${
        selected
          ? 'border-indigo-400 ring-2 ring-indigo-500/40'
          : `${typeStyle.border} hover:border-slate-500`
      }`}
    >
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        title="Dependency prerequisite (blocks / causes)"
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-indigo-400"
      />
      <Handle
        id="top"
        type="source"
        position={Position.Top}
        title="Related link (relates_to)"
        className="!h-2.5 !w-2.5 !border-2 !border-slate-900 !bg-teal-400"
      />

      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeStyle.badge}`}
        >
          {typeStyle.label}
        </span>

        <div className="flex items-center gap-1.5">
          {attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] text-slate-400"
              title={`${attachmentCount} attachment(s)`}
            >
              <Paperclip className="h-3 w-3" />
              {attachmentCount}
            </span>
          )}
          <span
            className={`h-2 w-2 rounded-full ${STATUS_DOT[card.status]}`}
            title={`Status: ${card.status}`}
          />
        </div>
      </div>

      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Edit card title"
          className="nodrag w-full rounded border border-indigo-400 bg-slate-800 px-1.5 py-0.5 text-sm font-semibold text-white outline-none"
        />
      ) : (
        <h3
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          title="Double-click to rename"
          className="cursor-text truncate text-sm font-semibold text-slate-100"
        >
          {card.title}
        </h3>
      )}

      {card.content && (
        <div className="mt-1.5 max-h-24 overflow-hidden">
          <MarkdownContent content={card.content} compact />
        </div>
      )}

      {card.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <Handle
        id="right"
        type="source"
        position={Position.Right}
        title="Dependency dependent (blocks / causes)"
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-indigo-400"
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        title="Related link (relates_to)"
        className="!h-2.5 !w-2.5 !border-2 !border-slate-900 !bg-teal-400"
      />
    </div>
  );
}
