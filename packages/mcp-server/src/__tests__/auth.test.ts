import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BoardGraphService, InMemoryStorageAdapter } from '@ariadeck/core';
import { createHttpApp } from '../httpServer.js';
import { SESSION_COOKIE_NAME } from '../auth.js';

describe('Token & Session Cookie Authentication', () => {
  const SECRET_TOKEN = 'test-secret-passphrase-12345';
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.initialize();
    const service = new BoardGraphService(storage, { deviceId: 'ariadeck-test' });
    const app = createHttpApp(service, { authToken: SECRET_TOKEN });
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
  });

  it('blocks unauthenticated requests and authenticates via HttpOnly session cookie', async () => {
    // Health and auth status remain accessible
    const statusRes = await fetch(`${baseUrl}/api/auth/status`);
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ authRequired: true, authenticated: false });

    // Protected endpoints reject unauthenticated calls with 401
    const unauthBoards = await fetch(`${baseUrl}/api/boards`);
    expect(unauthBoards.status).toBe(401);

    // Wrong token is rejected
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token' }),
    });
    expect(badLogin.status).toBe(401);

    // Valid token sets HttpOnly SameSite=Strict session cookie
    const goodLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: SECRET_TOKEN }),
    });
    expect(goodLogin.status).toBe(200);
    const setCookie = goodLogin.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    const cookiePair = setCookie.split(';')[0]!;

    // Session cookie grants access to protected API routes
    const authedBoards = await fetch(`${baseUrl}/api/boards`, {
      headers: { Cookie: cookiePair },
    });
    expect(authedBoards.status).toBe(200);

    // Logout revokes the session
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookiePair },
    });
    expect(logoutRes.status).toBe(200);

    const afterLogout = await fetch(`${baseUrl}/api/boards`, {
      headers: { Cookie: cookiePair },
    });
    expect(afterLogout.status).toBe(401);
  });

  it('accepts Authorization: Bearer <token> header for API/MCP clients', async () => {
    const res = await fetch(`${baseUrl}/api/boards`, {
      headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
    });
    expect(res.status).toBe(200);

    const badBearer = await fetch(`${baseUrl}/api/boards`, {
      headers: { Authorization: 'Bearer invalid' },
    });
    expect(badBearer.status).toBe(401);
  });
});
