import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const SESSION_COOKIE_NAME = 'ariadeck_session';
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SessionRecord {
  createdAt: number;
  expiresAt: number;
}

function sha256Buffer(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function constantTimeTokenEqual(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256Buffer(provided), sha256Buffer(expected));
}

export function generateSecureAuthToken(): string {
  return randomBytes(32).toString('hex');
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}

/**
 * Manages token verification and HttpOnly session cookies for @ariadeck/mcp-server.
 */
export class SessionAuthManager {
  private readonly authToken: string | null;
  private readonly sessionTtlMs: number;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(authToken: string | null, sessionTtlMs = DEFAULT_SESSION_TTL_MS) {
    this.authToken = authToken && authToken.trim() ? authToken.trim() : null;
    this.sessionTtlMs = sessionTtlMs;
  }

  isAuthRequired(): boolean {
    return this.authToken !== null;
  }

  verifyToken(candidate: string): boolean {
    if (!this.authToken) return true;
    if (!candidate) return false;
    return constantTimeTokenEqual(candidate, this.authToken);
  }

  createSession(): string {
    const sessionId = randomBytes(32).toString('hex');
    const now = Date.now();
    this.sessions.set(sessionId, {
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
    });
    return sessionId;
  }

  isValidSession(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  revokeSession(sessionId: string | undefined): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  isRequestAuthenticated(req: Request): boolean {
    if (!this.authToken) {
      return true;
    }

    const authHeader = req.header('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      if (this.verifyToken(token)) {
        return true;
      }
    }

    const cookies = parseCookies(req.header('cookie'));
    return this.isValidSession(cookies[SESSION_COOKIE_NAME]);
  }

  setSessionCookie(req: Request, res: Response, sessionId: string): void {
    const maxAgeSec = Math.floor(this.sessionTtlMs / 1000);
    const parts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      `Max-Age=${maxAgeSec}`,
    ];
    if (req.secure || req.header('x-forwarded-proto') === 'https') {
      parts.push('Secure');
    }
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  clearSessionCookie(res: Response): void {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
    );
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (this.isRequestAuthenticated(req)) {
        next();
        return;
      }
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Sign in with your Ariadeck access token.',
        },
      });
    };
  }
}
