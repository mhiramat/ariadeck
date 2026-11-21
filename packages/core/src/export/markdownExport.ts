import { computeTopologicalSteps, groupCardsByTimelineStep } from '../timeline/timelineLayout.js';
import type { BoardGraph, Card, CardAttachment, Edge } from '../types/models.js';

export interface MarkdownExportOptions {
  includeTranscripts?: boolean;
  includeMetadata?: boolean;
  exportedAt?: string;
}

export interface MarkdownExportResult {
  filename: string;
  markdown: string;
}

/**
 * Generates a URL-safe slug filename matching DESIGN_SPEC.md:
 * ariadeck-{board_slug}.md
 */
export function buildExportFilename(boardTitle: string): string {
  const slug = boardTitle
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `ariadeck-${slug || 'board'}.md`;
}

function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Renders a BoardGraph into a single structured Markdown document ordered by
 * timeline step sequence, with YAML frontmatter, dependency cross-references,
 * and optional attachment transcript blockquotes.
 */
export function renderBoardGraphToMarkdown(
  graph: BoardGraph,
  options: MarkdownExportOptions = {}
): MarkdownExportResult {
  const includeTranscripts = options.includeTranscripts ?? true;
  const includeMetadata = options.includeMetadata ?? true;
  const exportedAt = options.exportedAt ?? new Date().toISOString();

  // If any card lacks an explicit timelineOrder, compute topological steps in-memory.
  const needsFallbackSort = graph.cards.some((c) => c.timelineOrder === null);
  const computedSteps = needsFallbackSort
    ? computeTopologicalSteps(graph.cards, graph.edges)
    : null;

  const normalizedCards: Card[] = graph.cards.map((card) => ({
    ...card,
    timelineOrder: card.timelineOrder ?? computedSteps?.get(card.id) ?? 0,
  }));

  const stepGroups = groupCardsByTimelineStep(normalizedCards);
  const cardById = new Map(normalizedCards.map((c) => [c.id, c]));

  const prereqsByCard = new Map<string, Edge[]>();
  const dependentsByCard = new Map<string, Edge[]>();
  for (const edge of graph.edges) {
    if (edge.deletedAt !== null) continue;
    const incoming = prereqsByCard.get(edge.targetCardId);
    if (incoming) incoming.push(edge);
    else prereqsByCard.set(edge.targetCardId, [edge]);

    const outgoing = dependentsByCard.get(edge.sourceCardId);
    if (outgoing) outgoing.push(edge);
    else dependentsByCard.set(edge.sourceCardId, [edge]);
  }

  const attachmentsByCard = new Map<string, CardAttachment[]>();
  for (const att of graph.attachments) {
    if (att.deletedAt !== null) continue;
    const list = attachmentsByCard.get(att.cardId);
    if (list) list.push(att);
    else attachmentsByCard.set(att.cardId, [att]);
  }

  const lines: string[] = [
    '---',
    `title: ${escapeYamlString(graph.board.title)}`,
    'generator: Ariadeck',
    `board_id: ${escapeYamlString(graph.board.id)}`,
    `exported_at: ${escapeYamlString(exportedAt)}`,
    '---',
    '',
    `# ${graph.board.title}`,
  ];

  if (graph.board.description.trim()) {
    lines.push('', graph.board.description.trim());
  }

  for (const group of stepGroups) {
    const displayStep = group.step + 1;
    for (const card of group.cards) {
      lines.push('', `## [Step ${displayStep}] ${card.title}`);

      if (includeMetadata) {
        const metaParts: string[] = [
          `**Type**: \`${card.cardType}\``,
          `**Status**: \`${card.status}\``,
        ];
        if (card.tags.length > 0) {
          metaParts.push(`**Tags**: ${card.tags.map((t) => `\`#${t}\``).join(', ')}`);
        }
        if (card.startAt) {
          metaParts.push(`**Start**: ${card.startAt}`);
        }
        if (card.endAt) {
          metaParts.push(`**End**: ${card.endAt}`);
        }
        lines.push('', metaParts.join(' | '));
      }

      if (card.content.trim()) {
        lines.push('', card.content.trim());
      }

      const prereqs = prereqsByCard.get(card.id) ?? [];
      if (prereqs.length > 0) {
        const prereqNames = prereqs
          .map((e) => {
            const src = cardById.get(e.sourceCardId);
            return src ? `${src.title} (\`${e.relationType}\`)` : e.sourceCardId;
          })
          .join(', ');
        lines.push('', `**Prerequisites**: ${prereqNames}`);
      }

      const dependents = dependentsByCard.get(card.id) ?? [];
      if (dependents.length > 0) {
        const depNames = dependents
          .map((e) => {
            const tgt = cardById.get(e.targetCardId);
            return tgt ? `${tgt.title} (\`${e.relationType}\`)` : e.targetCardId;
          })
          .join(', ');
        lines.push('', `**Dependents**: ${depNames}`);
      }

      if (includeTranscripts) {
        const cardAtts = (attachmentsByCard.get(card.id) ?? []).filter(
          (a) => a.transcript && a.transcript.trim().length > 0
        );
        for (const att of cardAtts) {
          const kindLabel = att.kind === 'audio' ? 'Audio Transcript' : 'Image Caption';
          lines.push('', `> **${kindLabel}**: ${att.transcript!.trim()}`);
        }
      }
    }
  }

  lines.push('');

  return {
    filename: buildExportFilename(graph.board.title),
    markdown: lines.join('\n'),
  };
}
