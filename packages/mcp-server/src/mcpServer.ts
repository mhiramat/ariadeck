import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AriadeckError,
  BoardGraphService,
  computeTopologicalSteps,
  type BoardGraph,
  type MutationContext,
} from '@ariadeck/core';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './httpServer.js';

export const MCP_DEVICE_ID = 'ariadeck-mcp-server';

const MCP_MUTATION_CTX: MutationContext = {
  deviceId: MCP_DEVICE_ID,
};

const BoardTypeSchema = z.enum(['flow', 'flat']);
const CardTypeSchema = z.enum(['task', 'idea', 'plot_event', 'note']);
const CardStatusSchema = z.enum(['todo', 'in_progress', 'done', 'archived']);
const RelationTypeSchema = z.enum(['blocks', 'causes', 'relates_to', 'jump_back', 'custom']);
const EdgeDirectionSchema = z.enum(['directed', 'bidirectional', 'undirected']);
const EdgeStyleVariantSchema = z.enum(['solid', 'dashed', 'dotted']);
const SplitEdgeInheritanceSchema = z.enum(['sequential', 'broadcast', 'none']);

function formatBoardSummaryMarkdown(graph: BoardGraph): string {
  const cardById = new Map(graph.cards.map((c) => [c.id, c]));
  const connectedIds = new Set<string>();
  const conflictedEdges = graph.edges.filter((e) => e.isConflicted);

  const lines: string[] = [
    `# Ariadeck Board Summary: ${graph.board.title}`,
    '',
    graph.board.description ? `${graph.board.description}\n` : '',
    `- **Board ID**: \`${graph.board.id}\``,
    `- **Board Type**: \`${graph.board.boardType ?? 'flow'}\``,
    `- **Active Cards**: ${graph.cards.length}`,
    `- **Active Edges**: ${graph.edges.length}`,
    `- **Conflicted Edges**: ${conflictedEdges.length}`,
    '',
    '## Dependency Edges',
  ];

  if (graph.edges.length === 0) {
    lines.push('_No dependencies defined yet._');
  } else {
    for (const edge of graph.edges) {
      connectedIds.add(edge.sourceCardId);
      connectedIds.add(edge.targetCardId);
      const srcTitle = cardById.get(edge.sourceCardId)?.title ?? edge.sourceCardId;
      const tgtTitle = cardById.get(edge.targetCardId)?.title ?? edge.targetCardId;
      const conflictTag = edge.isConflicted ? ' [CONFLICTED]' : '';
      lines.push(
        `- **${srcTitle}** (\`${edge.sourceCardId}\`) --[${edge.relationType}]--> **${tgtTitle}** (\`${edge.targetCardId}\`)${conflictTag}`
      );
    }
  }

  const orphans = graph.cards.filter((c) => !connectedIds.has(c.id));
  lines.push('', '## Orphan Cards (No Dependencies)');
  if (orphans.length === 0) {
    lines.push('_None._');
  } else {
    for (const card of orphans) {
      lines.push(`- **${card.title}** (\`${card.id}\`, ${card.cardType}, ${card.status})`);
    }
  }

  if (conflictedEdges.length > 0) {
    lines.push('', '## Unresolved Conflicts');
    for (const edge of conflictedEdges) {
      lines.push(
        `- Edge \`${edge.id}\` (${edge.sourceCardId} -> ${edge.targetCardId}): ${edge.conflictReason ?? 'cyclic_dependency'}`
      );
    }
  }

  return lines.filter((line, idx, arr) => !(line === '' && arr[idx - 1] === '')).join('\n');
}

function toolSuccess(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function toolError(error: unknown) {
  const message =
    error instanceof AriadeckError
      ? `[${error.code}] ${error.message}`
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred while updating the Ariadeck board.';
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: message,
      },
    ],
  };
}

/**
 * Creates and configures an Ariadeck MCP server instance exposing all
 * resources, tools, and prompts defined in DESIGN_MCP.md.
 */
export function createAriadeckMcpServer(service: BoardGraphService): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  // ---------------------------------------------------------------------------
  // MCP Resources (Read-Only Context)
  // ---------------------------------------------------------------------------

  server.registerResource(
    'board-list',
    'ariadeck://board/list',
    {
      title: 'Ariadeck Board List',
      description: 'JSON list of all active Ariadeck boards.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const boards = await service.listBoards();
      const summary = boards.map((b) => ({
        id: b.id,
        title: b.title,
        description: b.description,
        boardType: b.boardType ?? 'flow',
        updatedAt: b.updatedAt,
      }));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    'board-graph',
    new ResourceTemplate('ariadeck://board/{board_id}/graph', {
      list: async () => {
        const boards = await service.listBoards();
        return {
          resources: boards.map((b) => ({
            uri: `ariadeck://board/${b.id}/graph`,
            name: `${b.title} (Graph)`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Ariadeck Board Graph',
      description:
        'Full structured JSON graph of the specified Ariadeck board including active cards, directed edges, conflict flags, and attachment transcripts.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const boardId = String(variables.board_id ?? '');
      const graph = await service.getBoardGraph(boardId);
      const boardType = graph.board.boardType ?? 'flow';
      const ranks =
        boardType === 'flow' ? computeTopologicalSteps(graph.cards, graph.edges) : null;
      const enriched = {
        ...graph,
        board: { ...graph.board, boardType },
        cards: graph.cards.map((c) => ({
          ...c,
          ...(ranks ? { timelineRank: ranks.get(c.id) ?? 0 } : {}),
        })),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(enriched, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    'board-summary',
    new ResourceTemplate('ariadeck://board/{board_id}/summary', {
      list: async () => {
        const boards = await service.listBoards();
        return {
          resources: boards.map((b) => ({
            uri: `ariadeck://board/${b.id}/summary`,
            name: `${b.title} (Summary)`,
            mimeType: 'text/markdown',
          })),
        };
      },
    }),
    {
      title: 'Ariadeck Board Summary',
      description:
        'Concise Markdown overview of an Ariadeck board dependency chains, orphan cards, and unresolved conflicts.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const boardId = String(variables.board_id ?? '');
      const graph = await service.getBoardGraph(boardId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: formatBoardSummaryMarkdown(graph),
          },
        ],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // MCP Tools (Graph Mutations & AI Assistance)
  // ---------------------------------------------------------------------------

  server.registerTool(
    'create_board',
    {
      description:
        'Create a new Ariadeck board. Choose boardType "flow" (default) for task dependencies, workflows, and timelines, or "flat" for relationship diagrams, character maps, and component networks where cycles and bidirectional/undirected edges are allowed.',
      inputSchema: {
        title: z.string().describe('Title of the new Ariadeck board'),
        description: z.string().optional().describe('Optional board description'),
        boardType: BoardTypeSchema.optional().describe(
          'Board mode: "flow" (temporal DAG + timeline, default) or "flat" (non-temporal relationship network)'
        ),
      },
    },
    async (args) => {
      try {
        const board = await service.createBoard(
          {
            title: args.title,
            description: args.description,
            boardType: args.boardType,
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(board);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'update_board',
    {
      description: 'Rename or update the description of an existing Ariadeck board.',
      inputSchema: {
        boardId: z.string().describe('ID of the Ariadeck board to update'),
        title: z.string().optional().describe('Updated board title'),
        description: z.string().optional().describe('Updated board description'),
      },
    },
    async (args) => {
      try {
        const board = await service.updateBoard(
          args.boardId,
          {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(board);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'create_card',
    {
      description: 'Create a new card on an Ariadeck board.',
      inputSchema: {
        boardId: z.string().describe('ID of the target Ariadeck board'),
        title: z.string().describe('Title of the new card'),
        content: z.string().optional().describe('Optional Markdown body content'),
        cardType: CardTypeSchema.optional().describe(
          'Card type: task, idea, plot_event, or note (default: idea)'
        ),
        tags: z.array(z.string()).optional().describe('Optional list of tags'),
      },
    },
    async (args) => {
      try {
        const card = await service.createCard(
          {
            boardId: args.boardId,
            title: args.title,
            content: args.content,
            cardType: args.cardType,
            tags: args.tags,
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(card);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'update_card',
    {
      description:
        'Update the title, Markdown content, status, or tags of an existing card on an Ariadeck board.',
      inputSchema: {
        cardId: z.string().describe('ID of the card to update'),
        title: z.string().optional().describe('Updated card title'),
        content: z.string().optional().describe('Updated Markdown body content'),
        status: CardStatusSchema.optional().describe(
          'Updated status: todo, in_progress, done, or archived'
        ),
        tags: z.array(z.string()).optional().describe('Updated list of tags'),
      },
    },
    async (args) => {
      try {
        const card = await service.updateCard(
          args.cardId,
          {
            title: args.title,
            content: args.content,
            status: args.status,
            tags: args.tags,
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(card);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'delete_card',
    {
      description:
        'Soft-delete a card on an Ariadeck board and cascade soft-deletion to its incident edges.',
      inputSchema: {
        cardId: z.string().describe('ID of the card to soft-delete'),
      },
    },
    async (args) => {
      try {
        await service.deleteCard(args.cardId, MCP_MUTATION_CTX);
        return toolSuccess({ deletedCardId: args.cardId, status: 'deleted' });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'connect_cards',
    {
      description:
        'Create an edge between two cards on an Ariadeck board. On flow boards, blocks/causes enforce DAG acyclicity while jump_back expresses backward loops/retries. On flat boards, cycles as well as bidirectional and undirected edges are allowed.',
      inputSchema: {
        boardId: z.string().describe('ID of the Ariadeck board'),
        sourceCardId: z.string().describe('Source (prerequisite/cause) card ID'),
        targetCardId: z.string().describe('Target (dependent/effect) card ID'),
        relationType: RelationTypeSchema.optional().describe(
          'Relation type: blocks, causes, relates_to, jump_back (flow only), or custom (flat only)'
        ),
        direction: EdgeDirectionSchema.optional().describe(
          'Edge direction: directed (default), bidirectional (flat only), or undirected (flat only)'
        ),
        label: z.string().optional().describe('Optional edge annotation label'),
        styleVariant: EdgeStyleVariantSchema.optional().describe(
          'Line style: solid, dashed, or dotted'
        ),
        color: z.string().optional().describe('Optional hex/CSS color for edge rendering'),
      },
    },
    async (args) => {
      try {
        const edge = await service.connectCards(
          args.boardId,
          args.sourceCardId,
          args.targetCardId,
          args.relationType ?? 'blocks',
          {
            direction: args.direction,
            label: args.label,
            styleVariant: args.styleVariant,
            color: args.color,
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(edge);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'update_edge',
    {
      description:
        'Update relationType, direction, label, styleVariant, or color on an existing edge with full board-type and DAG validation.',
      inputSchema: {
        edgeId: z.string().describe('ID of the edge to update'),
        relationType: RelationTypeSchema.optional().describe('Updated relation type'),
        direction: EdgeDirectionSchema.optional().describe(
          'Updated direction: directed, bidirectional, or undirected'
        ),
        label: z
          .string()
          .nullable()
          .optional()
          .describe('Updated edge label (pass null or empty string to clear)'),
        styleVariant: EdgeStyleVariantSchema.optional().describe(
          'Updated line style: solid, dashed, or dotted'
        ),
        color: z
          .string()
          .nullable()
          .optional()
          .describe('Updated edge color (pass null to reset)'),
      },
    },
    async (args) => {
      try {
        const edge = await service.updateEdge(
          args.edgeId,
          {
            relationType: args.relationType,
            direction: args.direction,
            label: args.label,
            styleVariant: args.styleVariant,
            color: args.color,
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(edge);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'disconnect_cards',
    {
      description: 'Soft-delete a dependency edge on an Ariadeck board.',
      inputSchema: {
        edgeId: z.string().describe('ID of the edge to soft-delete'),
      },
    },
    async (args) => {
      try {
        await service.disconnectCards(args.edgeId, MCP_MUTATION_CTX);
        return toolSuccess({ deletedEdgeId: args.edgeId, status: 'deleted' });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'split_card',
    {
      description:
        'Split an overly broad task, complex idea, or multi-beat story card on an Ariadeck board into multiple granular child cards while preserving dependencies and lineage.',
      inputSchema: {
        targetCardId: z.string().describe('ID of the card to split'),
        subCards: z
          .array(
            z.object({
              title: z.string().describe('Title of the child card'),
              content: z.string().describe('Markdown content of the child card'),
              cardType: CardTypeSchema.optional().describe('Optional card type override'),
            })
          )
          .min(2)
          .describe('Ordered array of at least 2 child cards'),
        linkMode: z
          .enum(['sequential', 'parallel'])
          .optional()
          .describe(
            'Legacy alias for edgeInheritance (sequential or parallel)'
          ),
        edgeInheritance: SplitEdgeInheritanceSchema.optional().describe(
          'How child cards inherit incident edges: sequential (default on flow), broadcast (default on flat), or none'
        ),
      },
    },
    async (args) => {
      try {
        const result = await service.splitCard(
          {
            targetCardId: args.targetCardId,
            subCards: args.subCards,
            linkMode: args.linkMode,
            edgeInheritance: args.edgeInheritance,
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess({
          parentCardId: result.parentCard.id,
          createdCardIds: result.createdCards.map((c) => c.id),
          createdCards: result.createdCards,
          createdEdgeCount: result.createdEdges.length,
          removedEdgeCount: result.removedEdgeIds.length,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'merge_cards',
    {
      description:
        'Merge two or more duplicate or closely related cards on an Ariadeck board into a single consolidated card, re-routing external dependencies and recording lineage.',
      inputSchema: {
        targetCardIds: z
          .array(z.string())
          .min(2)
          .describe('IDs of at least 2 cards to merge'),
        mergedTitle: z.string().describe('Title for the consolidated card'),
        mergedContent: z.string().describe('Consolidated Markdown body'),
        cardType: CardTypeSchema.optional().describe('Optional card type override'),
      },
    },
    async (args) => {
      try {
        const card = await service.mergeCards(
          {
            targetCardIds: args.targetCardIds,
            mergedCard: {
              title: args.mergedTitle,
              content: args.mergedContent,
              cardType: args.cardType,
            },
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(card);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'insert_intermediate_card',
    {
      description:
        'Insert a missing prerequisite step or intermediate event (A -> C -> B) between two already-connected cards (A -> B) on an Ariadeck board.',
      inputSchema: {
        sourceCardId: z.string().describe('Upstream card ID (A)'),
        targetCardId: z.string().describe('Downstream card ID (B)'),
        title: z.string().describe('Title of the intermediate card (C)'),
        content: z.string().optional().describe('Optional Markdown content of the intermediate card'),
      },
    },
    async (args) => {
      try {
        const card = await service.insertIntermediateCard(
          args.sourceCardId,
          args.targetCardId,
          {
            title: args.title,
            content: args.content,
          },
          MCP_MUTATION_CTX
        );
        return toolSuccess(card);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'compute_timeline_layout',
    {
      description:
        'Compute topological timeline step indices for all cards on a flow board using longest-path layering and persist each card timelineOrder.',
      inputSchema: {
        boardId: z.string().describe('ID of the Ariadeck flow board to sort'),
        applyToCards: z
          .boolean()
          .optional()
          .describe('Whether to persist computed ranks to card timelineOrder (default: true)'),
      },
    },
    async (args) => {
      try {
        const result = await service.computeTimelineLayout(
          args.boardId,
          MCP_MUTATION_CTX,
          { applyToCards: args.applyToCards }
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'compute_timeline',
    {
      description:
        'Compute topological timeline ranks, contradiction violations, jump_back return edges, and forward-pointing jump_back warnings for a flow board.',
      inputSchema: {
        boardId: z.string().describe('ID of the Ariadeck flow board'),
        applyToCards: z
          .boolean()
          .optional()
          .describe('Whether to persist computed ranks to card timelineOrder (default: true)'),
      },
    },
    async (args) => {
      try {
        const result = await service.computeTimelineLayout(
          args.boardId,
          MCP_MUTATION_CTX,
          { applyToCards: args.applyToCards }
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'convert_board_type',
    {
      description:
        'Analyze (dryRun: true) or execute conversion of an Ariadeck board between "flow" and "flat" modes.',
      inputSchema: {
        boardId: z.string().describe('ID of the Ariadeck board to convert'),
        targetType: BoardTypeSchema.describe('Target board type: "flow" or "flat"'),
        dryRun: z
          .boolean()
          .optional()
          .describe('If true, return conversion analysis without modifying the board'),
        strategy: z
          .enum(['abort', 'demote_incompatible'])
          .optional()
          .describe(
            'Strategy when converting flat -> flow with incompatible edges (default: abort)'
          ),
      },
    },
    async (args) => {
      try {
        if (args.dryRun) {
          const analysis = await service.analyzeBoardTypeConversion(
            args.boardId,
            args.targetType
          );
          return toolSuccess({ analysis });
        }
        const result = await service.convertBoardType(
          args.boardId,
          args.targetType,
          args.strategy ?? 'abort',
          MCP_MUTATION_CTX
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'export_board_markdown',
    {
      description:
        'Export an Ariadeck board into a single timeline-ordered Markdown document with YAML frontmatter, dependency links, and optional attachment transcripts.',
      inputSchema: {
        boardId: z.string().describe('ID of the Ariadeck board to export'),
        includeTranscripts: z
          .boolean()
          .optional()
          .describe('Include attachment transcripts as blockquotes (default: true)'),
      },
    },
    async (args) => {
      try {
        const result = await service.exportBoardToMarkdown(args.boardId, {
          includeTranscripts: args.includeTranscripts ?? true,
        });
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'export_board_json',
    {
      description:
        'Export an Ariadeck board into the lossless versioned ariadeck-board v1 JSON format suitable for backups and re-importing.',
      inputSchema: {
        boardId: z.string().describe('ID of the Ariadeck board to export'),
      },
    },
    async (args) => {
      try {
        const result = await service.exportBoardToJson(args.boardId);
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'import_board_json',
    {
      description:
        'Validate and import an ariadeck-board v1 JSON string as a new Ariadeck board with freshly remapped UUIDs.',
      inputSchema: {
        json: z.string().describe('Serialized ariadeck-board v1 JSON document'),
        titleOverride: z
          .string()
          .optional()
          .describe('Optional title override for the newly imported board'),
      },
    },
    async (args) => {
      try {
        const graph = await service.importBoardFromJson(
          args.json,
          { titleOverride: args.titleOverride },
          MCP_MUTATION_CTX
        );
        return toolSuccess(graph);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // MCP Prompts (Reusable AI Workflows)
  // ---------------------------------------------------------------------------

  server.registerPrompt(
    'analyze_and_split_complex_cards',
    {
      description:
        'Inspect an Ariadeck board graph, identify overly broad cards, and split them into actionable steps using split_card.',
      argsSchema: {
        board_id: z.string().describe('ID of the Ariadeck board to analyze'),
      },
    },
    ({ board_id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Read the Ariadeck board graph at ariadeck://board/${board_id}/graph. Identify oversized tasks or multi-beat story cards that combine multiple distinct actions or scenes, and decompose them into granular cards using the split_card tool while preserving dependencies.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'find_and_merge_duplicates',
    {
      description:
        'Scan an Ariadeck board for semantically overlapping or duplicate cards and consolidate them using merge_cards.',
      argsSchema: {
        board_id: z.string().describe('ID of the Ariadeck board to scan'),
      },
    },
    ({ board_id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Read the Ariadeck board graph at ariadeck://board/${board_id}/graph. Identify redundant or semantically overlapping cards, propose consolidations, and execute merge_cards so no notes or external dependencies are lost.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'check_plot_or_task_gaps',
    {
      description:
        'Traverse an Ariadeck board from root prerequisites to terminal outcomes to spot missing intermediate steps and insert them via insert_intermediate_card.',
      argsSchema: {
        board_id: z.string().describe('ID of the Ariadeck board to check'),
      },
    },
    ({ board_id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Read the Ariadeck board graph at ariadeck://board/${board_id}/graph and its summary at ariadeck://board/${board_id}/summary. Trace paths from root prerequisites to terminal outcomes to find missing intermediate tasks or plot holes, and bridge them using insert_intermediate_card.`,
          },
        },
      ],
    })
  );

  return server;
}
