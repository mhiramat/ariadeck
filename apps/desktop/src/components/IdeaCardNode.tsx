import { useState, useEffect, useRef, type DragEvent, type KeyboardEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Image as ImageIcon, Maximize2, Paperclip } from 'lucide-react';
import type { Card, CardAttachment, CardDisplayMode, CardStatus, CardType } from '@ariadeck/core';
import { buildMediaThumbUrl } from '../api/client.ts';
import { filterSupportedImageFiles } from '../utils/imageFiles.ts';
import { MarkdownContent } from './MarkdownContent.tsx';

export interface IdeaCardNodeData extends Record<string, unknown> {
  card: Card;
  attachmentCount: number;
  imageAttachments?: CardAttachment[];
  onRename: (cardId: string, title: string) => void;
  onOpenLightbox?: (cardId: string, attachmentId: string) => void;
  onDropImageFiles?: (cardId: string, files: File[]) => void;
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
  const {
    card,
    attachmentCount,
    imageAttachments = [],
    onRename,
    onOpenLightbox,
    onDropImageFiles,
  } = data;

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(card.title);
  const [isDragTarget, setIsDragTarget] = useState(false);
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

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragTarget(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) return;
    setIsDragTarget(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragTarget(false);
    const images = filterSupportedImageFiles(e.dataTransfer.files);
    if (images.length > 0 && onDropImageFiles) {
      onDropImageFiles(card.id, images);
    }
  };

  const coverImage =
    imageAttachments.find((att) => att.isCover) ?? imageAttachments[0] ?? null;
  const effectiveMode: CardDisplayMode = coverImage
    ? (card.displayMode ?? 'standard')
    : 'standard';
  const typeStyle = CARD_TYPE_STYLES[card.cardType];

  const openCoverLightbox = () => {
    if (coverImage && onOpenLightbox) {
      onOpenLightbox(card.id, coverImage.id);
    }
  };

  const containerClass = `w-64 rounded-xl border bg-slate-900/95 shadow-lg transition-all ${
    isDragTarget
      ? 'border-sky-400 ring-2 ring-sky-400/60'
      : selected
        ? 'border-indigo-400 ring-2 ring-indigo-500/40'
        : `${typeStyle.border} hover:border-slate-500`
  }`;

  const handles = (
    <>
      <Handle
        id="left"
        type="source"
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
    </>
  );

  // Full-bleed Image Only card mode
  if (effectiveMode === 'image_only' && coverImage) {
    return (
      <div
        data-display-mode="image_only"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group relative overflow-hidden ${containerClass}`}
      >
        {handles}

        <div
          className="relative h-48 w-full overflow-hidden bg-slate-950"
          onDoubleClick={(e) => {
            e.stopPropagation();
            openCoverLightbox();
          }}
        >
          <img
            src={buildMediaThumbUrl(coverImage.id)}
            alt={coverImage.caption || card.title}
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />

          <div className="absolute right-2 top-2 flex items-center gap-1">
            {imageAttachments.length > 1 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 backdrop-blur-sm">
                <ImageIcon className="h-3 w-3 text-sky-300" />
                {imageAttachments.length}
              </span>
            )}
            <button
              type="button"
              aria-label={`Inspect image for ${card.title}`}
              title="Open full-resolution preview"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                openCoverLightbox();
              }}
              className="nodrag rounded-md bg-slate-950/80 p-1 text-slate-200 opacity-0 backdrop-blur-sm transition hover:bg-indigo-600 hover:text-white group-hover:opacity-100 focus:opacity-100"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent px-3 pb-2.5 pt-6">
            {editing ? (
              <input
                ref={inputRef}
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={handleKeyDown}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                aria-label="Edit card title"
                className="nodrag w-full rounded border border-indigo-400 bg-slate-800 px-1.5 py-0.5 text-sm font-semibold text-white outline-none"
              />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <h3
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditing(true);
                  }}
                  title="Double-click to rename"
                  className="cursor-text truncate text-sm font-semibold text-white drop-shadow"
                >
                  {card.title}
                </h3>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[card.status]}`}
                  title={`Status: ${card.status}`}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-display-mode={effectiveMode}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`overflow-hidden ${containerClass}`}
    >
      {handles}

      {/* Top Cover Banner for image_cover mode */}
      {effectiveMode === 'image_cover' && coverImage && (
        <div
          className="group relative h-36 w-full overflow-hidden border-b border-slate-800 bg-slate-950"
          onDoubleClick={(e) => {
            e.stopPropagation();
            openCoverLightbox();
          }}
        >
          <img
            src={buildMediaThumbUrl(coverImage.id)}
            alt={coverImage.caption || card.title}
            draggable={false}
            className="h-full w-full object-cover"
          />
          <div className="absolute right-2 top-2 flex items-center gap-1">
            {imageAttachments.length > 1 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 backdrop-blur-sm">
                <ImageIcon className="h-3 w-3 text-sky-300" />
                {imageAttachments.length}
              </span>
            )}
            <button
              type="button"
              aria-label={`Inspect image for ${card.title}`}
              title="Open full-resolution preview"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                openCoverLightbox();
              }}
              className="nodrag rounded-md bg-slate-950/80 p-1 text-slate-200 opacity-0 backdrop-blur-sm transition hover:bg-indigo-600 hover:text-white group-hover:opacity-100 focus:opacity-100"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeStyle.badge}`}
          >
            {typeStyle.label}
          </span>

          <div className="flex items-center gap-1.5">
            {imageAttachments.length > 0 ? (
              <span
                className="inline-flex items-center gap-0.5 text-[11px] text-sky-300"
                title={`${imageAttachments.length} image(s)`}
              >
                <ImageIcon className="h-3 w-3" />
                {imageAttachments.length}
              </span>
            ) : (
              attachmentCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[11px] text-slate-400"
                  title={`${attachmentCount} attachment(s)`}
                >
                  <Paperclip className="h-3 w-3" />
                  {attachmentCount}
                </span>
              )
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

        {/* Compact Thumbnail Strip for standard mode with images */}
        {effectiveMode === 'standard' && imageAttachments.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            {imageAttachments.slice(0, 4).map((att) => (
              <button
                key={att.id}
                type="button"
                aria-label={`Inspect image ${att.caption || att.id}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenLightbox?.(card.id, att.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onOpenLightbox?.(card.id, att.id);
                }}
                className="nodrag h-10 w-10 overflow-hidden rounded border border-slate-700 bg-slate-950 transition hover:border-indigo-400"
              >
                <img
                  src={buildMediaThumbUrl(att.id)}
                  alt={att.caption || card.title}
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
            {imageAttachments.length > 4 && (
              <span className="text-[10px] font-medium text-slate-400">
                +{imageAttachments.length - 4}
              </span>
            )}
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
      </div>
    </div>
  );
}
