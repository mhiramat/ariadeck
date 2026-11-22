import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOrCreateAuthTokenFile,
  resolveDbPath,
  resolveDefaultConfigDir,
  resolveDefaultDataDir,
  resolveTokenFilePath,
  restrictSqliteFilePermissions,
} from '../userPaths.js';

describe('XDG user paths and private token file management', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ariadeck-paths-test-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('resolves XDG defaults and respects environment overrides', () => {
    const fakeHome = join(tempRoot, 'home');
    expect(resolveDefaultDataDir({}, fakeHome)).toBe(
      join(fakeHome, '.local', 'share', 'ariadeck')
    );
    expect(resolveDefaultConfigDir({}, fakeHome)).toBe(
      join(fakeHome, '.config', 'ariadeck')
    );
    expect(resolveDbPath({}, fakeHome)).toBe(
      join(fakeHome, '.local', 'share', 'ariadeck', 'ariadeck.db')
    );
    expect(resolveTokenFilePath({}, fakeHome)).toBe(
      join(fakeHome, '.config', 'ariadeck', 'auth-token')
    );

    const customEnv = {
      XDG_DATA_HOME: join(tempRoot, 'xdg-data'),
      XDG_CONFIG_HOME: join(tempRoot, 'xdg-config'),
    };
    expect(resolveDbPath(customEnv, fakeHome)).toBe(
      join(tempRoot, 'xdg-data', 'ariadeck', 'ariadeck.db')
    );
    expect(resolveTokenFilePath(customEnv, fakeHome)).toBe(
      join(tempRoot, 'xdg-config', 'ariadeck', 'auth-token')
    );

    expect(
      resolveDbPath({ ARIADECK_DB_PATH: join(tempRoot, 'custom.db') }, fakeHome)
    ).toBe(join(tempRoot, 'custom.db'));
    expect(
      resolveTokenFilePath(
        { ARIADECK_AUTH_TOKEN_FILE: join(tempRoot, 'my-token') },
        fakeHome
      )
    ).toBe(join(tempRoot, 'my-token'));
  });

  it('creates a 0600 token file inside a 0700 directory and reuses it across restarts', () => {
    const configDir = join(tempRoot, 'config', 'ariadeck');
    const tokenFile = join(configDir, 'auth-token');

    const first = loadOrCreateAuthTokenFile(tokenFile);
    expect(first.created).toBe(true);
    expect(first.repairedPermissions).toBe(false);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);

    if (process.platform !== 'win32') {
      expect(statSync(configDir).mode & 0o777).toBe(0o700);
      expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    }

    const second = loadOrCreateAuthTokenFile(tokenFile);
    expect(second.created).toBe(false);
    expect(second.repairedPermissions).toBe(false);
    expect(second.token).toBe(first.token);
  });

  it('tightens overly permissive token file permissions back to 0600', () => {
    if (process.platform === 'win32') return;

    const tokenFile = join(tempRoot, 'loose', 'auth-token');
    const first = loadOrCreateAuthTokenFile(tokenFile);
    chmodSync(tokenFile, 0o644);
    expect(statSync(tokenFile).mode & 0o777).toBe(0o644);

    const reloaded = loadOrCreateAuthTokenFile(tokenFile);
    expect(reloaded.created).toBe(false);
    expect(reloaded.repairedPermissions).toBe(true);
    expect(reloaded.token).toBe(first.token);
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  });

  it('restricts SQLite DB and WAL/SHM sidecar file permissions to 0600', () => {
    if (process.platform === 'win32') return;

    const dbPath = join(tempRoot, 'ariadeck.db');
    writeFileSync(dbPath, 'db');
    writeFileSync(`${dbPath}-wal`, 'wal');
    writeFileSync(`${dbPath}-shm`, 'shm');
    chmodSync(dbPath, 0o644);
    chmodSync(`${dbPath}-wal`, 0o644);
    chmodSync(`${dbPath}-shm`, 0o644);

    restrictSqliteFilePermissions(dbPath);

    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    expect(statSync(`${dbPath}-wal`).mode & 0o777).toBe(0o600);
    expect(statSync(`${dbPath}-shm`).mode & 0o777).toBe(0o600);
  });
});
