import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BoardGraphService, InMemoryStorageAdapter, type Card } from '@ariadeck/core';
import { createAriadeckMcpServer, MCP_DEVICE_ID } from '../mcpServer.js';

function parseToolText(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]?.text ?? '{}');
}

describe('Ariadeck MCP Server (Resources, Tools, Prompts)', () => {
  let service: BoardGraphService;
  let client: Client;
  let closeAll: () => Promise<void>;

  beforeEach(async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });

    const mcpServer = createAriadeckMcpServer(service);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'ariadeck-test-client', version: '0.1.0' });
    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);

    closeAll = async () => {
      await client.close();
      await mcpServer.close();
    };
  });

  afterEach(async () => {
    await closeAll();
  });

  it('exposes board list, board graph, and board summary resources', async () => {
    const board = await service.createBoard({
      title: 'Novel Outline',
      description: 'Three-act structure',
    });
    const c1 = await service.createCard({ boardId: board.id, title: 'Inciting Incident' });
    const c2 = await service.createCard({ boardId: board.id, title: 'Climax' });
    await service.createCard({ boardId: board.id, title: 'Unused Subplot' });
    await service.connectCards(board.id, c1.id, c2.id, 'causes');

    const listRes = await client.readResource({ uri: 'ariadeck://board/list' });
    const boardList = JSON.parse((listRes.contents[0] as { text: string }).text) as Array<{
      id: string;
      title: string;
    }>;
    expect(boardList).toHaveLength(1);
    expect(boardList[0]?.title).toBe('Novel Outline');

    const graphRes = await client.readResource({
      uri: `ariadeck://board/${board.id}/graph`,
    });
    const graph = JSON.parse((graphRes.contents[0] as { text: string }).text) as {
      cards: Card[];
      edges: unknown[];
    };
    expect(graph.cards).toHaveLength(3);
    expect(graph.edges).toHaveLength(1);

    const summaryRes = await client.readResource({
      uri: `ariadeck://board/${board.id}/summary`,
    });
    const summaryText = (summaryRes.contents[0] as { text: string }).text;
    expect(summaryText).toContain('Inciting Incident');
    expect(summaryText).toContain('Unused Subplot');
  });

  it('executes CRUD, connect, split, merge, and insert_intermediate tools with MCP device ID', async () => {
    const createdBoardRes = await client.callTool({
      name: 'create_board',
      arguments: { title: 'Initial Plan', description: 'Draft' },
    });
    const createdBoard = parseToolText(createdBoardRes) as { id: string; title: string };
    expect(createdBoard.title).toBe('Initial Plan');

    const renamedBoardRes = await client.callTool({
      name: 'update_board',
      arguments: { boardId: createdBoard.id, title: 'Engineering Plan' },
    });
    const board = parseToolText(renamedBoardRes) as { id: string; title: string };
    expect(board.title).toBe('Engineering Plan');

    const c1Res = await client.callTool({
      name: 'create_card',
      arguments: { boardId: board.id, title: 'Design & Build', cardType: 'task' },
    });
    const c1 = parseToolText(c1Res) as Card;
    expect(c1.updatedByDeviceId).toBe(MCP_DEVICE_ID);

    const c2Res = await client.callTool({
      name: 'create_card',
      arguments: { boardId: board.id, title: 'Deploy', cardType: 'task' },
    });
    const c2 = parseToolText(c2Res) as Card;

    await client.callTool({
      name: 'connect_cards',
      arguments: {
        boardId: board.id,
        sourceCardId: c1.id,
        targetCardId: c2.id,
        relationType: 'blocks',
      },
    });

    // Reject cyclic edge via MCP tool with clear error
    const cycleRes = await client.callTool({
      name: 'connect_cards',
      arguments: {
        boardId: board.id,
        sourceCardId: c2.id,
        targetCardId: c1.id,
        relationType: 'blocks',
      },
    });
    expect(cycleRes.isError).toBe(true);
    expect((cycleRes.content as Array<{ text: string }>)[0]?.text).toContain(
      'ERR_TEMPORAL_CYCLE_DETECTED'
    );

    // Split c1 into two cards sequentially
    const splitRes = await client.callTool({
      name: 'split_card',
      arguments: {
        targetCardId: c1.id,
        linkMode: 'sequential',
        subCards: [
          { title: 'Design Spec', content: 'Write spec' },
          { title: 'Implement Core', content: 'Write code' },
        ],
      },
    });
    const splitData = parseToolText(splitRes) as { createdCardIds: string[] };
    expect(splitData.createdCardIds).toHaveLength(2);

    // Insert intermediate card between Implement Core and Deploy
    const midRes = await client.callTool({
      name: 'insert_intermediate_card',
      arguments: {
        sourceCardId: splitData.createdCardIds[1]!,
        targetCardId: c2.id,
        title: 'Run QA Suite',
        content: 'Verify regressions',
      },
    });
    const midCard = parseToolText(midRes) as Card;
    expect(midCard.title).toBe('Run QA Suite');

    // Merge Design Spec and Implement Core back into one card
    const mergeRes = await client.callTool({
      name: 'merge_cards',
      arguments: {
        targetCardIds: splitData.createdCardIds,
        mergedTitle: 'Spec & Implementation',
        mergedContent: 'Combined delivery phase',
      },
    });
    const mergedCard = parseToolText(mergeRes) as Card;
    expect(mergedCard.mergedFromCardIds).toEqual(splitData.createdCardIds);
    expect(mergedCard.updatedByDeviceId).toBe(MCP_DEVICE_ID);

    // Compute topological timeline layout via MCP tool
    const timelineRes = await client.callTool({
      name: 'compute_timeline_layout',
      arguments: { boardId: board.id },
    });
    const timeline = parseToolText(timelineRes) as {
      steps: Array<{ step: number; cards: Card[] }>;
      violations: unknown[];
    };
    expect(timeline.steps.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(timeline.violations).toEqual([]);

    // Export board to Markdown via MCP tool
    const mdRes = await client.callTool({
      name: 'export_board_markdown',
      arguments: { boardId: board.id },
    });
    const mdPayload = parseToolText(mdRes) as { filename: string; markdown: string };
    expect(mdPayload.filename).toBe('ariadeck-engineering-plan.md');
    expect(mdPayload.markdown).toContain('generator: Ariadeck');

    // Export and re-import board as JSON via MCP tools
    const jsonRes = await client.callTool({
      name: 'export_board_json',
      arguments: { boardId: board.id },
    });
    const jsonPayload = parseToolText(jsonRes) as { filename: string; json: string };
    expect(jsonPayload.filename).toBe('ariadeck-engineering-plan.json');

    const importedRes = await client.callTool({
      name: 'import_board_json',
      arguments: { json: jsonPayload.json, titleOverride: 'Cloned Plan' },
    });
    const importedGraph = parseToolText(importedRes) as {
      board: { id: string; title: string };
      cards: Card[];
    };
    expect(importedGraph.board.title).toBe('Cloned Plan');
    expect(importedGraph.board.id).not.toBe(board.id);
  });

  it('registers all three workflow prompts', async () => {
    const prompts = await client.listPrompts();
    const names = prompts.prompts.map((p) => p.name).sort();
    expect(names).toEqual([
      'analyze_and_split_complex_cards',
      'check_plot_or_task_gaps',
      'find_and_merge_duplicates',
    ]);

    const prompt = await client.getPrompt({
      name: 'analyze_and_split_complex_cards',
      arguments: { board_id: 'board-123' },
    });
    expect(prompt.messages[0]?.content).toMatchObject({
      type: 'text',
    });
  });

  it('supports Phase 2 flat boards, jump_back edges, update_edge, compute_timeline, and convert_board_type', async () => {
    // 1. Create a flat board with bidirectional/undirected edges and cycle
    const flatBoardRes = await client.callTool({
      name: 'create_board',
      arguments: { title: 'Character Map', boardType: 'flat' },
    });
    const flatBoard = parseToolText(flatBoardRes) as { id: string; boardType: string };
    expect(flatBoard.boardType).toBe('flat');

    const c1 = parseToolText(
      await client.callTool({
        name: 'create_card',
        arguments: { boardId: flatBoard.id, title: 'Alice' },
      })
    ) as Card;
    const c2 = parseToolText(
      await client.callTool({
        name: 'create_card',
        arguments: { boardId: flatBoard.id, title: 'Bob' },
      })
    ) as Card;

    const rivalEdge = parseToolText(
      await client.callTool({
        name: 'connect_cards',
        arguments: {
          boardId: flatBoard.id,
          sourceCardId: c1.id,
          targetCardId: c2.id,
          relationType: 'custom',
          direction: 'bidirectional',
          label: 'Rivals',
          styleVariant: 'dashed',
          color: '#f43f5e',
        },
      })
    ) as { id: string; direction: string; label?: string };
    expect(rivalEdge.direction).toBe('bidirectional');
    expect(rivalEdge.label).toBe('Rivals');

    // Update edge label and style via update_edge
    const updatedEdge = parseToolText(
      await client.callTool({
        name: 'update_edge',
        arguments: { edgeId: rivalEdge.id, label: 'Fierce Rivals', styleVariant: 'dotted' },
      })
    ) as { label?: string; styleVariant?: string };
    expect(updatedEdge.label).toBe('Fierce Rivals');
    expect(updatedEdge.styleVariant).toBe('dotted');

    // Dry-run convert_board_type flat -> flow reports incompatibility
    const dryRun = parseToolText(
      await client.callTool({
        name: 'convert_board_type',
        arguments: { boardId: flatBoard.id, targetType: 'flow', dryRun: true },
      })
    ) as { analysis: { canConvertCleanly: boolean; symmetricEdgeIds: string[] } };
    expect(dryRun.analysis.canConvertCleanly).toBe(false);
    expect(dryRun.analysis.symmetricEdgeIds).toHaveLength(1);

    // Convert with strategy='demote_incompatible'
    const converted = parseToolText(
      await client.callTool({
        name: 'convert_board_type',
        arguments: {
          boardId: flatBoard.id,
          targetType: 'flow',
          strategy: 'demote_incompatible',
        },
      })
    ) as { board: { boardType: string } };
    expect(converted.board.boardType).toBe('flow');

    // Add causal edge + jump_back loop and run compute_timeline
    await client.callTool({
      name: 'connect_cards',
      arguments: {
        boardId: flatBoard.id,
        sourceCardId: c1.id,
        targetCardId: c2.id,
        relationType: 'causes',
      },
    });
    await client.callTool({
      name: 'connect_cards',
      arguments: {
        boardId: flatBoard.id,
        sourceCardId: c2.id,
        targetCardId: c1.id,
        relationType: 'jump_back',
        label: 'Loop back',
      },
    });

    const timeline = parseToolText(
      await client.callTool({
        name: 'compute_timeline',
        arguments: { boardId: flatBoard.id },
      })
    ) as { jumpBackEdges: unknown[]; warnings: unknown[]; hasTemporalCycle: boolean };
    expect(timeline.hasTemporalCycle).toBe(false);
    expect(timeline.jumpBackEdges).toHaveLength(1);
    expect(timeline.warnings).toHaveLength(0);
  });
});
