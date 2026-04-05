import { Buffer } from 'node:buffer';
import { getSyncEnv } from './env';
import { fetchLatestGithubRelease } from './github';
import { buildPublicUrl, getManifestKey, readPublicManifest } from './manifest';
import { mirrorRemoteFileToOss, uploadBufferToOss } from './oss';
import type {
    GithubRelease,
    GithubReleaseAsset,
    ParsedReleaseAsset,
    ReleaseManifest,
    ReleaseSyncDependencies,
    SyncResult,
} from './types';

const ALLOWED_EXTENSIONS = new Set(['.dmg', '.zip', '.exe']);
const IGNORED_FILENAMES = new Set(['latest.yml', 'latest-mac.yml']);

function getAssetExtension(filename: string) {
    const match = filename.toLowerCase().match(/\.[^.]+$/);
    return match ? match[0] : '';
}

function inferContentType(filename: string, githubContentType: string) {
    const ext = getAssetExtension(filename);
    if (ext === '.dmg') return 'application/x-apple-diskimage';
    if (ext === '.zip') return 'application/zip';
    if (ext === '.exe') return 'application/vnd.microsoft.portable-executable';
    return githubContentType || 'application/octet-stream';
}

function parsePlatform(asset: GithubReleaseAsset) {
    const filename = asset.name.toLowerCase();
    const ext = getAssetExtension(filename);

    if (!ALLOWED_EXTENSIONS.has(ext)) {
        return null;
    }

    if (filename.endsWith('.blockmap') || IGNORED_FILENAMES.has(filename)) {
        return null;
    }

    if (ext === '.exe') {
        return { platform: 'windows' as const, arch: 'x64' as const };
    }

    if (filename.includes('arm64')) {
        return { platform: 'macos' as const, arch: 'arm64' as const };
    }

    if (filename.includes('x64')) {
        return { platform: 'macos' as const, arch: 'x64' as const };
    }

    return null;
}

export function parseReleaseAssets(release: GithubRelease, publicBaseUrl: string): ParsedReleaseAsset[] {
    return release.assets.flatMap((asset) => {
        const parsed = parsePlatform(asset);
        if (!parsed) {
            return [];
        }

        const ossKey = `releases/${release.tag_name}/${asset.name}`;
        return [{
            platform: parsed.platform,
            arch: parsed.arch,
            filename: asset.name,
            size: asset.size,
            contentType: inferContentType(asset.name, asset.content_type),
            ossKey,
            publicUrl: buildPublicUrl(publicBaseUrl, ossKey),
            downloadUrl: asset.browser_download_url,
        }];
    });
}

function buildManifest(release: GithubRelease, assets: ParsedReleaseAsset[]): ReleaseManifest {
    return {
        tag: release.tag_name,
        publishedAt: release.published_at,
        releaseName: release.name || release.tag_name,
        releaseUrl: release.html_url,
        notes: String(release.body || '').trim(),
        assets: assets.map(({ downloadUrl: _downloadUrl, ...asset }) => asset),
    };
}

export async function syncLatestReleaseWithDependencies(deps: ReleaseSyncDependencies): Promise<SyncResult> {
    const release = await deps.fetchLatestRelease();
    const parsedAssets = parseReleaseAssets(release, deps.buildPublicUrl(''));
    if (parsedAssets.length === 0) {
        throw new Error(`No downloadable assets matched release ${release.tag_name}`);
    }

    const currentManifest = await deps.readCurrentManifest();
    const nextManifest = buildManifest(release, parsedAssets);

    if (currentManifest?.tag === nextManifest.tag) {
        return {
            status: 'skipped',
            reason: `Latest manifest already points to ${nextManifest.tag}`,
            manifest: currentManifest,
        };
    }

    for (const asset of parsedAssets) {
        await deps.uploadRemoteAsset(asset.ossKey, asset.downloadUrl, asset.contentType);
    }

    const manifestBody = Buffer.from(JSON.stringify(nextManifest, null, 2), 'utf8');
    await deps.uploadManifest(getManifestKey(), manifestBody, 'application/json; charset=utf-8');

    return {
        status: 'synced',
        reason: `Mirrored ${nextManifest.tag} to OSS`,
        manifest: nextManifest,
    };
}

export async function syncLatestReleaseToOss(): Promise<SyncResult> {
    const env = getSyncEnv();

    return syncLatestReleaseWithDependencies({
        fetchLatestRelease: () => fetchLatestGithubRelease(env.GITHUB_OWNER, env.GITHUB_REPO, env.GITHUB_TOKEN),
        readCurrentManifest: () => readPublicManifest(env.OSS_PUBLIC_BASE_URL),
        uploadRemoteAsset: (key, downloadUrl, contentType) => mirrorRemoteFileToOss(key, downloadUrl, contentType),
        uploadManifest: (key, body, contentType) => uploadBufferToOss(key, body, contentType),
        buildPublicUrl: (key) => buildPublicUrl(env.OSS_PUBLIC_BASE_URL, key),
    });
}
