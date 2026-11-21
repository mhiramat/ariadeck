import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BoardGraphService, InMemoryStorageAdapter } from '@ariadeck/core';
import { createAriadeckMcpServer } from '../mcpServer.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_DIR, '../../../..');
const SKILL_DIR = resolve(REPO_ROOT, '.agents/skills/ariadeck-mcp');

describe('Ariadeck MCP Agent Skill Parity', () => {
  it('has valid SKILL.md frontmatter and existing relative reference files', () => {
    const skillPath = resolve(SKILL_DIR, 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, 'utf-8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toMatch(/^name:\s*ariadeck-mcp$/m);
    expect(content).toMatch(/^description:/m);

    const relativeLinks = Array.from(content.matchAll(/\]\(\.\/([^)]+)\)/g)).map((m) => m[1]!);
    expect(relativeLinks.length).toBeGreaterThanOrEqual(3);
    for (const rel of relativeLinks) {
      expect(existsSync(resolve(SKILL_DIR, rel))).toBe(true);
    }
  });

  it('documents every registered MCP tool and prompt in references/mcp-reference.md', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    const service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });
    const mcpServer = createAriadeckMcpServer(service);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'skill-parity-test', version: '0.1.0' });
    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const [{ tools }, { prompts }] = await Promise.all([
        client.listTools(),
        client.listPrompts(),
      ]);

      const referenceDoc = readFileSync(
        resolve(SKILL_DIR, 'references/mcp-reference.md'),
        'utf-8'
      );

      for (const tool of tools) {
        expect(referenceDoc).toContain(`\`${tool.name}\``);
      }
      for (const prompt of prompts) {
        expect(referenceDoc).toContain(`\`${prompt.name}`);
      }
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });

  it('contains no personal absolute paths or email addresses across skill documents', () => {
    const files = [
      'SKILL.md',
      'references/mcp-reference.md',
      'references/client-setup.md',
      'examples/workflows.md',
    ];
    const forbiddenPattern = /(\/home\/|\/Users\/|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

    for (const file of files) {
      const text = readFileSync(resolve(SKILL_DIR, file), 'utf-8');
      expect(text).not.toMatch(forbiddenPattern);
    }
  });
});
