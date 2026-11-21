import type { BoardSyncSnapshot, RemoteSyncAdapter } from './RemoteSyncAdapter.js';

export interface GoogleDriveSyncAdapterOptions {
  getAccessToken: () => Promise<string>;
  fetchFn?: typeof fetch;
  rootFolderName?: string;
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface DriveFileListResponse {
  files?: Array<{ id: string; name: string }>;
}

/**
 * Google Drive API v3 implementation of RemoteSyncAdapter following the
 * Ariadeck/ directory layout defined in DESIGN_SPEC.md:
 * - Ariadeck/boards/board_{boardId}.json
 * - Ariadeck/media/{attachmentId}_{filename}
 */
export class GoogleDriveSyncAdapter implements RemoteSyncAdapter {
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetchFn: typeof fetch;
  private readonly rootFolderName: string;

  private rootFolderId: string | null = null;
  private boardsFolderId: string | null = null;
  private mediaFolderId: string | null = null;

  constructor(options: GoogleDriveSyncAdapterOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.rootFolderName = options.rootFolderName ?? 'Ariadeck';
  }

  private async authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      ...extra,
    };
  }

  private async findFileByName(
    name: string,
    parentId?: string,
    mimeType?: string
  ): Promise<string | null> {
    const clauses = [`name = '${name.replace(/'/g, "\\'")}'`, 'trashed = false'];
    if (parentId) clauses.push(`'${parentId}' in parents`);
    if (mimeType) clauses.push(`mimeType = '${mimeType}'`);

    const query = encodeURIComponent(clauses.join(' and '));
    const res = await this.fetchFn(
      `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)&spaces=drive`,
      { headers: await this.authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Google Drive search failed (${res.status}).`);
    }
    const data = (await res.json()) as DriveFileListResponse;
    return data.files?.[0]?.id ?? null;
  }

  private async ensureFolder(name: string, parentId?: string): Promise<string> {
    const existing = await this.findFileByName(name, parentId, FOLDER_MIME);
    if (existing) return existing;

    const metadata: Record<string, unknown> = {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    };
    const res = await this.fetchFn(`${DRIVE_API_BASE}/files?fields=id`, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(metadata),
    });
    if (!res.ok) {
      throw new Error(`Google Drive folder creation failed (${res.status}).`);
    }
    const created = (await res.json()) as { id: string };
    return created.id;
  }

  private async ensureFolderLayout(): Promise<{
    rootId: string;
    boardsId: string;
    mediaId: string;
  }> {
    if (!this.rootFolderId) {
      this.rootFolderId = await this.ensureFolder(this.rootFolderName);
    }
    if (!this.boardsFolderId) {
      this.boardsFolderId = await this.ensureFolder('boards', this.rootFolderId);
    }
    if (!this.mediaFolderId) {
      this.mediaFolderId = await this.ensureFolder('media', this.rootFolderId);
    }
    return {
      rootId: this.rootFolderId,
      boardsId: this.boardsFolderId,
      mediaId: this.mediaFolderId,
    };
  }

  async fetchBoardSnapshot(boardId: string): Promise<BoardSyncSnapshot | null> {
    const { boardsId } = await this.ensureFolderLayout();
    const filename = `board_${boardId}.json`;
    const fileId = await this.findFileByName(filename, boardsId);
    if (!fileId) return null;

    const res = await this.fetchFn(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Google Drive snapshot download failed (${res.status}).`);
    }
    return (await res.json()) as BoardSyncSnapshot;
  }

  async uploadBoardSnapshot(snapshot: BoardSyncSnapshot): Promise<void> {
    const { boardsId } = await this.ensureFolderLayout();
    const filename = `board_${snapshot.board.id}.json`;
    const existingId = await this.findFileByName(filename, boardsId);
    const jsonBody = JSON.stringify(snapshot, null, 2);

    if (existingId) {
      const res = await this.fetchFn(
        `${DRIVE_UPLOAD_BASE}/files/${existingId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
          body: jsonBody,
        }
      );
      if (!res.ok) {
        throw new Error(`Google Drive snapshot update failed (${res.status}).`);
      }
      return;
    }

    const boundary = 'ariadeck_sync_boundary';
    const metadata = JSON.stringify({
      name: filename,
      parents: [boardsId],
      mimeType: 'application/json',
    });
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      jsonBody,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await this.fetchFn(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: await this.authHeaders({
        'Content-Type': `multipart/related; boundary=${boundary}`,
      }),
      body: multipartBody,
    });
    if (!res.ok) {
      throw new Error(`Google Drive snapshot upload failed (${res.status}).`);
    }
  }

  async listRemoteBoardIds(): Promise<string[]> {
    const { boardsId } = await this.ensureFolderLayout();
    const query = encodeURIComponent(`'${boardsId}' in parents and trashed = false`);
    const res = await this.fetchFn(
      `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)&spaces=drive`,
      { headers: await this.authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Google Drive board listing failed (${res.status}).`);
    }
    const data = (await res.json()) as DriveFileListResponse;
    const ids: string[] = [];
    for (const file of data.files ?? []) {
      const match = /^board_(.+)\.json$/.exec(file.name);
      if (match?.[1]) {
        ids.push(match[1]);
      }
    }
    return ids;
  }

  async uploadMediaAsset(
    attachmentId: string,
    filename: string,
    data: Uint8Array,
    mimeType: string
  ): Promise<{ remoteFileId: string }> {
    const { mediaId } = await this.ensureFolderLayout();
    const remoteName = `${attachmentId}_${filename}`;
    const existingId = await this.findFileByName(remoteName, mediaId);

    if (existingId) {
      const res = await this.fetchFn(
        `${DRIVE_UPLOAD_BASE}/files/${existingId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: await this.authHeaders({ 'Content-Type': mimeType }),
          body: data,
        }
      );
      if (!res.ok) {
        throw new Error(`Google Drive media update failed (${res.status}).`);
      }
      return { remoteFileId: existingId };
    }

    const res = await this.fetchFn(`${DRIVE_API_BASE}/files?fields=id`, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: remoteName,
        parents: [mediaId],
        mimeType,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google Drive media metadata creation failed (${res.status}).`);
    }
    const created = (await res.json()) as { id: string };

    const uploadRes = await this.fetchFn(
      `${DRIVE_UPLOAD_BASE}/files/${created.id}?uploadType=media`,
      {
        method: 'PATCH',
        headers: await this.authHeaders({ 'Content-Type': mimeType }),
        body: data,
      }
    );
    if (!uploadRes.ok) {
      throw new Error(`Google Drive media content upload failed (${uploadRes.status}).`);
    }
    return { remoteFileId: created.id };
  }

  async downloadMediaAsset(remoteFileId: string): Promise<Uint8Array> {
    const res = await this.fetchFn(`${DRIVE_API_BASE}/files/${remoteFileId}?alt=media`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Google Drive media download failed (${res.status}).`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
