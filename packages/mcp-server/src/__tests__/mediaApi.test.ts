import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  BoardGraphService,
  InMemoryStorageAdapter,
  MediaService,
} from '@ariadeck/core';
import { NodeMediaStorageAdapter } from '@ariadeck/core/media-node';
import { createHttpApp } from '../httpServer.js';
import { createAriadeckMcpServer } from '../mcpServer.js';

// Minimal valid 1x1 PNG (67 bytes)
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
);

// Minimal valid 1x1 PNG with a different pixel color for deduplication/multi-image tests
const TINY_PNG_2 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
);

function parseToolText(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]?.text ?? '{}');
}

describe('MCP Image Attachment Tools & Strict file_path Policy', () => {
  let tempDir: string;
  let allowedDir: string;
  let outsideDir: string;
  let service: BoardGraphService;
  let mediaService: MediaService;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ariadeck-mcp-media-'));
    allowedDir = join(tempDir, 'allowed');
    outsideDir = join(tempDir, 'outside');
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });
    const mediaStorage = new NodeMediaStorageAdapter(join(tempDir, 'cas'));
    mediaService = new MediaService(storage, service, mediaStorage, {
      deviceId: 'ariadeck-test',
    });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(allowedDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function connectMcp(allowedMediaDirs: string[] = []) {
    const mcpServer = createAriadeckMcpServer(service, {
      mediaService,
      allowedMediaDirs,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mcp-media-test', version: '0.1.0' });
    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
    return {
      client,
      close: async () => {
        await client.close();
        await mcpServer.close();
      },
    };
  }

  it('rejects file_path when ARIADECK_ALLOWED_MEDIA_DIRS is unset, while allowing base64', async () => {
    const allowedFile = join(allowedDir, 'portrait.png');
    writeFileSync(allowedFile, TINY_PNG);

    const { client, close } = await connectMcp([]);
    try {
      const board = await service.createBoard({ title: 'Strict Mode Board' });
      const card = await service.createCard({ boardId: board.id, title: 'Hero' });

      // file_path must be rejected when allowedMediaDirs is empty
      const deniedRes = await client.callTool({
        name: 'attach_image_to_card',
        arguments: {
          cardId: card.id,
          source: { type: 'file_path', path: allowedFile },
        },
      });
      expect(deniedRes.isError).toBe(true);
      expect((deniedRes.content as Array<{ text: string }>)[0]?.text).toContain(
        'ERR_MEDIA_PATH_NOT_ALLOWED'
      );

      // base64 succeeds and auto-switches card displayMode to image_cover
      const base64Res = await client.callTool({
        name: 'attach_image_to_card',
        arguments: {
          cardId: card.id,
          source: {
            type: 'base64',
            data: Buffer.from(TINY_PNG).toString('base64'),
            mimeType: 'image/png',
          },
          caption: 'Hero concept',
        },
      });
      expect(base64Res.isError).toBeUndefined();
      const attached = parseToolText(base64Res) as {
        card: { displayMode: string };
        attachment: { id: string; width: number; height: number; isCover: boolean; caption: string };
      };
      expect(attached.card.displayMode).toBe('image_cover');
      expect(attached.attachment.width).toBe(1);
      expect(attached.attachment.height).toBe(1);
      expect(attached.attachment.isCover).toBe(true);
      expect(attached.attachment.caption).toBe('Hero concept');
    } finally {
      await close();
    }
  });

  it('allows file_path inside allowedMediaDirs, blocks outside/symlink escapes, and exposes compact graph metadata', async () => {
    const insideFile = join(allowedDir, 'scene.png');
    const outsideFile = join(outsideDir, 'secret.png');
    const escapeSymlink = join(allowedDir, 'escape.png');
    writeFileSync(insideFile, TINY_PNG);
    writeFileSync(outsideFile, TINY_PNG_2);
    symlinkSync(outsideFile, escapeSymlink);

    const { client, close } = await connectMcp([allowedDir]);
    try {
      const board = await service.createBoard({ title: 'Storyboard' });

      // Outside file rejected
      const outsideRes = await client.callTool({
        name: 'create_image_card',
        arguments: {
          boardId: board.id,
          title: 'Blocked Outside',
          source: { type: 'file_path', path: outsideFile },
        },
      });
      expect(outsideRes.isError).toBe(true);
      expect((outsideRes.content as Array<{ text: string }>)[0]?.text).toContain(
        'ERR_MEDIA_PATH_NOT_ALLOWED'
      );

      // Symlink escaping allowed dir rejected
      const symlinkRes = await client.callTool({
        name: 'create_image_card',
        arguments: {
          boardId: board.id,
          title: 'Blocked Symlink',
          source: { type: 'file_path', path: escapeSymlink },
        },
      });
      expect(symlinkRes.isError).toBe(true);
      expect((symlinkRes.content as Array<{ text: string }>)[0]?.text).toContain(
        'ERR_MEDIA_PATH_NOT_ALLOWED'
      );

      // Allowed local file succeeds via create_image_card
      const createdRes = await client.callTool({
        name: 'create_image_card',
        arguments: {
          boardId: board.id,
          title: 'Scene 1',
          source: { type: 'file_path', path: insideFile },
          caption: 'Opening shot',
          displayMode: 'image_only',
        },
      });
      expect(createdRes.isError).toBeUndefined();
      const created = parseToolText(createdRes) as {
        card: { id: string; displayMode: string };
        attachment: { id: string; isCover: boolean };
      };
      expect(created.card.displayMode).toBe('image_only');
      expect(created.attachment.isCover).toBe(true);

      // Attach second image via base64, switch cover, update caption
      const secondRes = await client.callTool({
        name: 'attach_image_to_card',
        arguments: {
          cardId: created.card.id,
          source: {
            type: 'base64',
            data: Buffer.from(TINY_PNG_2).toString('base64'),
            mimeType: 'image/png',
          },
          setAsCover: false,
        },
      });
      const second = parseToolText(secondRes) as { attachment: { id: string; isCover: boolean } };
      expect(second.attachment.isCover).toBe(false);

      const coverRes = await client.callTool({
        name: 'set_cover_image',
        arguments: { cardId: created.card.id, attachmentId: second.attachment.id },
      });
      const cover = parseToolText(coverRes) as { attachment: { isCover: boolean } };
      expect(cover.attachment.isCover).toBe(true);

      const captionRes = await client.callTool({
        name: 'update_card_attachment',
        arguments: { attachmentId: second.attachment.id, caption: 'Alt angle' },
      });
      const captioned = parseToolText(captionRes) as { attachment: { caption: string } };
      expect(captioned.attachment.caption).toBe('Alt angle');

      // Update displayMode via update_card
      const modeRes = await client.callTool({
        name: 'update_card',
        arguments: { cardId: created.card.id, displayMode: 'image_cover' },
      });
      expect((parseToolText(modeRes) as { displayMode: string }).displayMode).toBe('image_cover');

      // Inspect board graph resource: metadata-only, no base64, no host path
      const graphRes = await client.readResource({
        uri: `ariadeck://board/${board.id}/graph`,
      });
      const graphText = (graphRes.contents[0] as { text: string }).text;
      expect(graphText).not.toContain(tempDir);
      const graphJson = JSON.parse(graphText) as {
        cards: Array<{
          id: string;
          displayMode: string;
          attachments: Array<{ id: string; isCover: boolean; caption: string | null }>;
        }>;
      };
      expect(graphJson.cards[0]?.displayMode).toBe('image_cover');
      expect(graphJson.cards[0]?.attachments).toHaveLength(2);

      // Remove both attachments -> displayMode resets to standard
      await client.callTool({
        name: 'remove_card_attachment',
        arguments: { attachmentId: second.attachment.id },
      });
      await client.callTool({
        name: 'remove_card_attachment',
        arguments: { attachmentId: created.attachment.id },
      });
      const updatedCard = await service.getBoardGraph(board.id);
      expect(updatedCard.cards[0]?.displayMode).toBe('standard');
      expect(updatedCard.attachments).toHaveLength(0);
    } finally {
      await close();
    }
  });
});

describe('HTTP Media Upload, Serving, Reorder, GC & Auth', () => {
  let tempDir: string;
  let server: Server;
  let baseUrl: string;
  let service: BoardGraphService;
  const AUTH_TOKEN = 'test-secret-token-123';

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ariadeck-http-media-'));
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });
    const mediaStorage = new NodeMediaStorageAdapter(join(tempDir, 'media'));
    const mediaService = new MediaService(storage, service, mediaStorage, {
      deviceId: 'ariadeck-test',
    });

    const app = createHttpApp(service, { mediaService, authToken: AUTH_TOKEN });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('protects media routes with auth and supports binary upload, serving, reorder, and GC', async () => {
    const authHeader = { Authorization: `Bearer ${AUTH_TOKEN}` };
    const board = await service.createBoard({ title: 'Visual Board' });

    // Unauthenticated create image card is rejected
    const unauthRes = await fetch(
      `${baseUrl}/api/cards/image?boardId=${encodeURIComponent(board.id)}&title=Unauth`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: TINY_PNG,
      }
    );
    expect(unauthRes.status).toBe(401);

    // Authenticated raw binary create image card succeeds
    const createRes = await fetch(
      `${baseUrl}/api/cards/image?boardId=${encodeURIComponent(board.id)}&title=Cover+Card&posX=120&posY=240`,
      {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'image/png' },
        body: TINY_PNG,
      }
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      card: { id: string; displayMode: string; posX: number; posY: number };
      attachment: { id: string; mimeType: string; isCover: boolean };
    };
    expect(created.card.displayMode).toBe('image_cover');
    expect(created.card.posX).toBe(120);
    expect(created.card.posY).toBe(240);

    // Attach second image via raw binary endpoint
    const attachRes = await fetch(
      `${baseUrl}/api/cards/${created.card.id}/attachments/image?setAsCover=false&caption=Detail`,
      {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'image/png' },
        body: TINY_PNG_2,
      }
    );
    expect(attachRes.status).toBe(201);
    const second = (await attachRes.json()) as {
      attachment: { id: string; isCover: boolean; caption: string };
    };
    expect(second.attachment.isCover).toBe(false);
    expect(second.attachment.caption).toBe('Detail');

    // Unauthenticated thumbnail fetch is rejected; authenticated returns WebP
    const unauthThumb = await fetch(
      `${baseUrl}/api/media/attachments/${created.attachment.id}/thumb`
    );
    expect(unauthThumb.status).toBe(401);

    const thumbRes = await fetch(
      `${baseUrl}/api/media/attachments/${created.attachment.id}/thumb`,
      { headers: authHeader }
    );
    expect(thumbRes.status).toBe(200);
    expect(thumbRes.headers.get('content-type')).toBe('image/webp');
    expect(thumbRes.headers.get('x-content-type-options')).toBe('nosniff');

    const origRes = await fetch(
      `${baseUrl}/api/media/attachments/${created.attachment.id}/original`,
      { headers: authHeader }
    );
    expect(origRes.status).toBe(200);
    expect(origRes.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await origRes.arrayBuffer())).toEqual(TINY_PNG);

    // Reorder attachments
    const reorderRes = await fetch(
      `${baseUrl}/api/cards/${created.card.id}/attachments/reorder`,
      {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentIds: [second.attachment.id, created.attachment.id] }),
      }
    );
    expect(reorderRes.status).toBe(200);
    const reordered = (await reorderRes.json()) as {
      attachments: Array<{ id: string; sortOrder: number }>;
    };
    expect(reordered.attachments.map((a) => a.id)).toEqual([
      second.attachment.id,
      created.attachment.id,
    ]);

    // Update caption & cover via PATCH
    const patchRes = await fetch(`${baseUrl}/api/attachments/${second.attachment.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: 'Main Cover', isCover: true }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      attachment: { caption: string; isCover: boolean };
    };
    expect(patched.attachment.caption).toBe('Main Cover');
    expect(patched.attachment.isCover).toBe(true);

    // Delete attachment & invoke GC endpoint
    const delRes = await fetch(`${baseUrl}/api/attachments/${created.attachment.id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(delRes.status).toBe(204);

    const gcRes = await fetch(`${baseUrl}/api/media/gc`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: 30 }),
    });
    expect(gcRes.status).toBe(200);
    const gcPayload = (await gcRes.json()) as { deletedHashes: string[] };
    expect(gcPayload.deletedHashes).toEqual([]);
  });
});
