export type ReleasePlatform = 'macos' | 'windows';
export type ReleaseArch = 'arm64' | 'x64';

export interface ReleaseAsset {
    platform: ReleasePlatform;
    arch: ReleaseArch;
    filename: string;
    size: number;
    contentType: string;
    ossKey: string;
    publicUrl: string;
}

export interface ReleaseManifest {
    tag: string;
    publishedAt: string;
    releaseName: string;
    releaseUrl: string;
    notes: string;
    assets: ReleaseAsset[];
}

export interface GithubReleaseAsset {
    id: number;
    name: string;
    size: number;
    content_type: string;
    browser_download_url: string;
}

export interface GithubRelease {
    tag_name: string;
    name: string;
    html_url: string;
    body: string | null;
    published_at: string;
    draft: boolean;
    prerelease: boolean;
    assets: GithubReleaseAsset[];
}

export interface ParsedReleaseAsset extends ReleaseAsset {
    downloadUrl: string;
}

export interface SyncResult {
    status: 'synced' | 'skipped';
    reason: string;
    manifest: ReleaseManifest;
}

export interface OssLikeClient {
    putObject: (key: string, body: Buffer | NodeJS.ReadableStream, contentType: string) => Promise<void>;
}

export interface ReleaseSyncDependencies {
    fetchLatestRelease: () => Promise<GithubRelease>;
    readCurrentManifest: () => Promise<ReleaseManifest | null>;
    uploadRemoteAsset: (key: string, downloadUrl: string, contentType: string) => Promise<void>;
    uploadManifest: (key: string, body: Buffer, contentType: string) => Promise<void>;
    buildPublicUrl: (key: string) => string;
}
