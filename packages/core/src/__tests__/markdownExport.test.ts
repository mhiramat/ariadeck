import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardGraphService } from '../service/BoardGraphService.js';
import { InMemoryStorageAdapter } from '../storage/InMemoryStorageAdapter.js';
import { buildExportFilename } from '../export/markdownExport.js';

describe('Single-File Markdown Export', () => {
  let storage: InMemoryStorageAdapter;
  let service: BoardGraphService;

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter();
    await storage.initialize();
    service = new BoardGraphService(storage, {
      deviceId: 'ariadeck-test',
      now: () => '2026-06-01T12:00:00.000Z',
    });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('builds deterministic slugged export filenames', () => {
    expect(buildExportFilename('Story Plot: Act 1')).toBe('ariadeck-story-plot-act-1.md');
    expect(buildExportFilename('   ')).toBe('ariadeck-board.md');
  });

  it('exports YAML frontmatter, timeline-ordered step headings, dependencies, and transcripts', async () => {
    const board = await service.createBoard({
      title: 'Story Plot',
      description: 'Main narrative sequence.',
    });
    const c1 = await service.createCard({
      boardId: board.id,
      title: 'Inciting Incident',
      content: 'The hero receives the call.',
      cardType: 'plot_event',
      tags: ['act1'],
    });
    const c2 = await service.createCard({
      boardId: board.id,
      title: 'Climax',
      content: 'Final confrontation.',
      cardType: 'plot_event',
      status: 'in_progress',
    });
    await service.connectCards(board.id, c1.id, c2.id, 'causes');

    await storage.saveAttachment({
      id: 'att-voice-1',
      cardId: c1.id,
      boardId: board.id,
      kind: 'audio',
      localUri: 'media/voice-1.m4a',
      remoteFileId: null,
      mimeType: 'audio/mp4',
      fileSize: 2048,
      durationMs: 5000,
      transcript: 'Remember to foreshadow the compass.',
      syncStatus: 'local_only',
      createdAt: c1.createdAt,
      updatedAt: c1.updatedAt,
      updatedByDeviceId: 'ariadeck-test',
      version: 1,
      deletedAt: null,
    });

    const result = await service.exportBoardToMarkdown(board.id);

    expect(result.filename).toBe('ariadeck-story-plot.md');
    expect(result.markdown).toContain('generator: Ariadeck');
    expect(result.markdown).toContain(`board_id: "${board.id}"`);
    expect(result.markdown).toContain('## [Step 1] Inciting Incident');
    expect(result.markdown).toContain('## [Step 2] Climax');
    expect(result.markdown).toContain('**Dependents**: Climax (`causes`)');
    expect(result.markdown).toContain('**Prerequisites**: Inciting Incident (`causes`)');
    expect(result.markdown).toContain('> **Audio Transcript**: Remember to foreshadow the compass.');

    // Verify Step 1 appears before Step 2
    expect(result.markdown.indexOf('## [Step 1]')).toBeLessThan(
      result.markdown.indexOf('## [Step 2]')
    );

    // Optional includeTranscripts: false omits transcript blockquotes
    const withoutTranscripts = await service.exportBoardToMarkdown(board.id, {
      includeTranscripts: false,
    });
    expect(withoutTranscripts.markdown).not.toContain('Audio Transcript');
  });
});
