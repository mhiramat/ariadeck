import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Camera,
  Mic,
  Square,
  Save,
  Trash2,
  Link2,
  X,
  Image as ImageIcon,
  Volume2,
  Eye,
  Pencil,
} from 'lucide-react';
import type { CardStatus, CardType } from '@ariadeck/core';
import {
  captureImageFromCameraOrGallery,
  VoiceMemoRecorder,
} from '../media/mediaCapture.ts';
import { useMobileStore } from '../store/useMobileStore.ts';

export function CardEditorView() {
  const graph = useMobileStore((s) => s.graph);
  const selectedCardId = useMobileStore((s) => s.selectedCardId);
  const updateCard = useMobileStore((s) => s.updateCard);
  const deleteCard = useMobileStore((s) => s.deleteCard);
  const connectCards = useMobileStore((s) => s.connectCards);
  const disconnectCards = useMobileStore((s) => s.disconnectCards);
  const addAttachment = useMobileStore((s) => s.addAttachment);
  const updateAttachmentTranscript = useMobileStore((s) => s.updateAttachmentTranscript);
  const deleteAttachment = useMobileStore((s) => s.deleteAttachment);
  const setActiveMode = useMobileStore((s) => s.setActiveMode);
  const pushToast = useMobileStore((s) => s.pushToast);

  const card =
    selectedCardId && graph
      ? graph.cards.find((c) => c.id === selectedCardId) ?? null
      : null;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [cardType, setCardType] = useState<CardType>('idea');
  const [status, setStatus] = useState<CardStatus>('todo');
  const [tagsInput, setTagsInput] = useState('');
  const [previewMode, setPreviewMode] = useState(false);

  const [prereqTargetId, setPrereqTargetId] = useState('');
  const [dependentTargetId, setDependentTargetId] = useState('');
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<VoiceMemoRecorder | null>(null);

  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setContent(card.content);
      setCardType(card.cardType);
      setStatus(card.status);
      setTagsInput(card.tags.join(', '));
      setPreviewMode(false);
    }
  }, [card]);

  if (!card || !graph) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center">
        <p className="text-sm text-slate-400">Select a card from the List tab to edit it.</p>
        <button
          type="button"
          onClick={() => setActiveMode('list')}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white"
        >
          Go to List
        </button>
      </div>
    );
  }

  const cardById = new Map(graph.cards.map((c) => [c.id, c]));
  const otherCards = graph.cards.filter((c) => c.id !== card.id);
  const incomingEdges = graph.edges.filter((e) => e.targetCardId === card.id);
  const outgoingEdges = graph.edges.filter((e) => e.sourceCardId === card.id);
  const cardAttachments = graph.attachments.filter((a) => a.cardId === card.id);

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    await updateCard(card.id, { title: trimmed, content, cardType, status, tags });
    pushToast('success', 'Card saved.');
  };

  const handleCaptureImage = async () => {
    try {
      const captured = await captureImageFromCameraOrGallery();
      if (!captured) return;
      await addAttachment({
        cardId: card.id,
        kind: 'image',
        localUri: captured.localUri,
        mimeType: captured.mimeType,
        fileSize: captured.fileSize,
        transcript: '',
      });
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : 'Camera capture failed.');
    }
  };

  const handleToggleRecording = async () => {
    try {
      if (!recording) {
        const recorder = new VoiceMemoRecorder();
        await recorder.start();
        recorderRef.current = recorder;
        setRecording(true);
      } else {
        const captured = await recorderRef.current!.stop();
        recorderRef.current = null;
        setRecording(false);
        await addAttachment({
          cardId: card.id,
          kind: 'audio',
          localUri: captured.localUri,
          mimeType: captured.mimeType,
          fileSize: captured.fileSize,
          durationMs: captured.durationMs,
          transcript: captured.transcript,
        });
      }
    } catch (error) {
      setRecording(false);
      pushToast('error', error instanceof Error ? error.message : 'Voice recording failed.');
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-slate-950 p-4">
      <div className="space-y-4 pb-6">
        <div>
          <label htmlFor="mobile-card-title" className="mb-1 block text-xs font-medium text-slate-400">
            Title
          </label>
          <input
            id="mobile-card-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-base font-semibold text-white outline-none focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mobile-card-type" className="mb-1 block text-xs font-medium text-slate-400">
              Type
            </label>
            <select
              id="mobile-card-type"
              value={cardType}
              onChange={(e) => setCardType(e.target.value as CardType)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
            >
              <option value="idea">Idea</option>
              <option value="task">Task</option>
              <option value="plot_event">Plot Event</option>
              <option value="note">Note</option>
            </select>
          </div>
          <div>
            <label htmlFor="mobile-card-status" className="mb-1 block text-xs font-medium text-slate-400">
              Status
            </label>
            <select
              id="mobile-card-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as CardStatus)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
            >
              <option value="todo">Todo</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="mobile-card-tags" className="mb-1 block text-xs font-medium text-slate-400">
            Tags (comma-separated)
          </label>
          <input
            id="mobile-card-tags"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. mobile, idea"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>

        {/* Markdown Body */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="mobile-card-content" className="text-xs font-medium text-slate-400">
              Markdown Body
            </label>
            <button
              type="button"
              onClick={() => setPreviewMode((p) => !p)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-indigo-300"
            >
              {previewMode ? <Pencil className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {previewMode ? 'Edit' : 'Preview'}
            </button>
          </div>

          {previewMode ? (
            <div className="min-h-[8rem] rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || '_Empty body_'}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              id="mobile-card-content"
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write notes in Markdown..."
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-white outline-none focus:border-indigo-500"
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white active:bg-indigo-500"
        >
          <Save className="h-4 w-4" />
          Save Card
        </button>

        {/* Multimodal Attachments (Camera & Voice Memo) */}
        <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Media Attachments ({cardAttachments.length})
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCaptureImage()}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200"
              >
                <Camera className="h-3.5 w-3.5 text-sky-400" />
                Photo
              </button>
              <button
                type="button"
                onClick={() => void handleToggleRecording()}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  recording
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-800 text-slate-200'
                }`}
              >
                {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5 text-amber-400" />}
                {recording ? 'Stop' : 'Voice'}
              </button>
            </div>
          </div>

          {cardAttachments.map((att) => (
            <div
              key={att.id}
              className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
                  {att.kind === 'image' ? (
                    <ImageIcon className="h-3.5 w-3.5 text-sky-400" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  {att.kind === 'image' ? 'Image Attachment' : 'Voice Memo'}
                </span>
                <button
                  type="button"
                  aria-label="Delete attachment"
                  onClick={() => void deleteAttachment(att.id)}
                  className="rounded p-1 text-slate-400 hover:text-rose-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                type="text"
                aria-label={`Transcript for ${att.id}`}
                defaultValue={att.transcript ?? ''}
                onBlur={(e) =>
                  void updateAttachmentTranscript(
                    att.id,
                    e.target.value.trim() ? e.target.value.trim() : null
                  )
                }
                placeholder="Add searchable caption or voice transcript..."
                className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
              />
            </div>
          ))}
        </section>

        {/* Simple Relation Editor (Prerequisites & Dependents) */}
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
            <Link2 className="h-3.5 w-3.5 text-indigo-400" />
            Relations
          </h3>

          {/* Prerequisites (Parents) */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-slate-400">Prerequisites (Parents)</p>
            {incomingEdges.map((edge) => (
              <div
                key={edge.id}
                className="flex items-center justify-between rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate text-slate-200">
                  {cardById.get(edge.sourceCardId)?.title ?? edge.sourceCardId}
                </span>
                <button
                  type="button"
                  aria-label="Remove prerequisite"
                  onClick={() => void disconnectCards(edge.id)}
                  className="p-1 text-slate-400 hover:text-rose-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <select
                aria-label="Add prerequisite"
                value={prereqTargetId}
                onChange={(e) => setPrereqTargetId(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              >
                <option value="">Select prerequisite...</option>
                {otherCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!prereqTargetId}
                onClick={() => {
                  if (prereqTargetId) {
                    void connectCards(prereqTargetId, card.id, 'blocks');
                    setPrereqTargetId('');
                  }
                }}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-indigo-300 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>

          {/* Dependents (Children) */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-slate-400">Dependents (Children)</p>
            {outgoingEdges.map((edge) => (
              <div
                key={edge.id}
                className="flex items-center justify-between rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate text-slate-200">
                  {cardById.get(edge.targetCardId)?.title ?? edge.targetCardId}
                </span>
                <button
                  type="button"
                  aria-label="Remove dependent"
                  onClick={() => void disconnectCards(edge.id)}
                  className="p-1 text-slate-400 hover:text-rose-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <select
                aria-label="Add dependent"
                value={dependentTargetId}
                onChange={(e) => setDependentTargetId(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              >
                <option value="">Select dependent...</option>
                {otherCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!dependentTargetId}
                onClick={() => {
                  if (dependentTargetId) {
                    void connectCards(card.id, dependentTargetId, 'blocks');
                    setDependentTargetId('');
                  }
                }}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-indigo-300 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={() => void deleteCard(card.id)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-300"
        >
          <Trash2 className="h-4 w-4" />
          Delete Card
        </button>
      </div>
    </div>
  );
}
