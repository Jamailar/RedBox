import { describe, expect, it, vi } from 'vitest';
import { parseReleaseAssets, syncLatestReleaseWithDependencies } from '../app/lib/release-sync';
import type { GithubRelease, ReleaseManifest } from '../app/lib/types';

const release: GithubRelease = {
    tag_name: 'v1.9.0',
    name: 'v1.9.0',
    html_url: 'https://github.com/Jamailar/RedBox/releases/tag/v1.9.0',
    body: '1. 优化整体 UI 视觉',
    published_at: '2026-04-04T08:59:00Z',
    draft: false,
    prerelease: false,
    assets: [
        {
            id: 1,
            name: 'RedBox-1.9.0-arm64.dmg',
            size: 100,
            content_type: 'application/octet-stream',
            browser_download_url: 'https://github.com/arm64.dmg',
        },
        {
            id: 2,
            name: 'RedBox-1.9.0-arm64.zip',
            size: 200,
            content_type: 'application/zip',
            browser_download_url: 'https://github.com/arm64.zip',
        },
        {
            id: 3,
            name: 'RedBox-1.9.0-x64.dmg',
            size: 300,
            content_type: 'application/octet-stream',
            browser_download_url: 'https://github.com/x64.dmg',
        },
        {
            id: 4,
            name: 'RedBox-1.9.0-x64.exe',
            size: 400,
            content_type: 'application/octet-stream',
            browser_download_url: 'https://github.com/x64.exe',
        },
        {
            id: 5,
            name: 'latest.yml',
            size: 20,
            content_type: 'text/yaml',
            browser_download_url: 'https://github.com/latest.yml',
        },
        {
            id: 6,
            name: 'RedBox-1.9.0-x64.exe.blockmap',
            size: 20,
            content_type: 'application/octet-stream',
            browser_download_url: 'https://github.com/blockmap',
        },
    ],
};

describe('parseReleaseAssets', () => {
    it('keeps only mirrorable desktop installers', () => {
        const assets = parseReleaseAssets(release, 'https://downloads.example.com');
        expect(assets).toHaveLength(4);
        expect(assets.map((asset) => asset.filename)).toEqual([
            'RedBox-1.9.0-arm64.dmg',
            'RedBox-1.9.0-arm64.zip',
            'RedBox-1.9.0-x64.dmg',
            'RedBox-1.9.0-x64.exe',
        ]);
        expect(assets[0]).toMatchObject({
            platform: 'macos',
            arch: 'arm64',
            publicUrl: 'https://downloads.example.com/releases/v1.9.0/RedBox-1.9.0-arm64.dmg',
        });
        expect(assets[3]).toMatchObject({
            platform: 'windows',
            arch: 'x64',
        });
    });
});

describe('syncLatestReleaseWithDependencies', () => {
    it('skips upload when current manifest tag already matches latest release', async () => {
        const uploadObject = vi.fn();
        const currentManifest: ReleaseManifest = {
            tag: 'v1.9.0',
            publishedAt: release.published_at,
            releaseName: release.name,
            releaseUrl: release.html_url,
            notes: release.body || '',
            assets: [],
        };

        const result = await syncLatestReleaseWithDependencies({
            fetchLatestRelease: async () => release,
            readCurrentManifest: async () => currentManifest,
            uploadRemoteAsset: uploadObject,
            uploadManifest: uploadObject,
            buildPublicUrl: (key) => `https://downloads.example.com/${key}`,
        });

        expect(result.status).toBe('skipped');
        expect(uploadObject).not.toHaveBeenCalled();
    });

    it('uploads assets and writes manifest last', async () => {
        const uploadObject = vi.fn(async () => undefined);

        const result = await syncLatestReleaseWithDependencies({
            fetchLatestRelease: async () => release,
            readCurrentManifest: async () => null,
            uploadRemoteAsset: uploadObject,
            uploadManifest: uploadObject,
            buildPublicUrl: (key) => `https://downloads.example.com/${key}`,
        });

        expect(result.status).toBe('synced');
        expect(uploadObject).toHaveBeenCalledTimes(5);
        expect(uploadObject.mock.calls.at(-1)?.[0]).toBe('manifests/latest.json');
    });

    it('does not write manifest if an asset upload fails', async () => {
        const uploadRemoteAsset = vi.fn(async (key: string) => {
            if (key.endsWith('.exe')) {
                throw new Error('upload failed');
            }
        });
        const uploadManifest = vi.fn(async () => undefined);

        await expect(syncLatestReleaseWithDependencies({
            fetchLatestRelease: async () => release,
            readCurrentManifest: async () => null,
            uploadRemoteAsset,
            uploadManifest,
            buildPublicUrl: (key) => `https://downloads.example.com/${key}`,
        })).rejects.toThrow('upload failed');

        expect(uploadManifest).not.toHaveBeenCalled();
    });
});
