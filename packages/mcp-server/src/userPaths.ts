import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { generateSecureAuthToken } from './auth.js';

export interface LoadedAuthToken {
  token: string;
  tokenFilePath: string;
  created: boolean;
  repairedPermissions: boolean;
}

const IS_POSIX = process.platform !== 'win32';

/**
 * Resolves the XDG-compliant user data directory for Ariadeck:
 * `${XDG_DATA_HOME:-~/.local/share}/ariadeck`.
 */
export function resolveDefaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): string {
  const xdgData = env.XDG_DATA_HOME?.trim();
  const base = xdgData ? xdgData : join(homeDir, '.local', 'share');
  return join(base, 'ariadeck');
}

/**
 * Resolves the XDG-compliant user config directory for Ariadeck:
 * `${XDG_CONFIG_HOME:-~/.config}/ariadeck`.
 */
export function resolveDefaultConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): string {
  const xdgConfig = env.XDG_CONFIG_HOME?.trim();
  const base = xdgConfig ? xdgConfig : join(homeDir, '.config');
  return join(base, 'ariadeck');
}

/**
 * Resolves the SQLite database path, defaulting to the XDG user data directory.
 */
export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): string {
  const override = env.ARIADECK_DB_PATH?.trim();
  if (override) return override;
  return join(resolveDefaultDataDir(env, homeDir), 'ariadeck.db');
}

/**
 * Resolves the user-private auth token file path, defaulting to the XDG config directory.
 */
export function resolveTokenFilePath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): string {
  const override = env.ARIADECK_AUTH_TOKEN_FILE?.trim();
  if (override) return override;
  return join(resolveDefaultConfigDir(env, homeDir), 'auth-token');
}

/**
 * Resolves the Content-Addressed Storage (CAS) media root directory, defaulting
 * to `${XDG_DATA_HOME:-~/.local/share}/ariadeck/media`.
 */
export function resolveMediaDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): string {
  const override = env.ARIADECK_MEDIA_DIR?.trim();
  if (override) return override;
  return join(resolveDefaultDataDir(env, homeDir), 'media');
}

/**
 * Parses ARIADECK_ALLOWED_MEDIA_DIRS (delimited by OS path.delimiter) into
 * resolved directory paths. Returns an empty array when unset.
 */
export function parseAllowedMediaDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ARIADECK_ALLOWED_MEDIA_DIRS?.trim();
  if (!raw) return [];
  return raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
}

/**
 * Ensures a directory exists with owner-only (0700) permissions on POSIX systems.
 */
export function ensurePrivateDirectory(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (IS_POSIX) {
    chmodSync(dirPath, 0o700);
  }
}

/**
 * Restricts a file to owner read/write (0600) on POSIX systems if it exists.
 */
export function restrictFilePermissions(filePath: string): void {
  if (!IS_POSIX || !existsSync(filePath)) return;
  chmodSync(filePath, 0o600);
}

/**
 * Restricts a SQLite database file and its WAL/SHM sidecar files to 0600 on POSIX systems.
 */
export function restrictSqliteFilePermissions(dbPath: string): void {
  if (!IS_POSIX || dbPath === ':memory:') return;
  restrictFilePermissions(dbPath);
  restrictFilePermissions(`${dbPath}-wal`);
  restrictFilePermissions(`${dbPath}-shm`);
}

/**
 * Loads an existing user-private access token or generates and persists a new
 * 256-bit token with 0700 directory and 0600 file permissions.
 */
export function loadOrCreateAuthTokenFile(tokenFilePath: string): LoadedAuthToken {
  ensurePrivateDirectory(dirname(tokenFilePath));

  if (existsSync(tokenFilePath)) {
    let repairedPermissions = false;
    if (IS_POSIX) {
      const mode = statSync(tokenFilePath).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        chmodSync(tokenFilePath, 0o600);
        repairedPermissions = true;
      }
    }
    const existing = readFileSync(tokenFilePath, 'utf8').trim();
    if (existing.length > 0) {
      return {
        token: existing,
        tokenFilePath,
        created: false,
        repairedPermissions,
      };
    }
  }

  const token = generateSecureAuthToken();
  writeFileSync(tokenFilePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  if (IS_POSIX) {
    chmodSync(tokenFilePath, 0o600);
  }
  return {
    token,
    tokenFilePath,
    created: true,
    repairedPermissions: false,
  };
}
