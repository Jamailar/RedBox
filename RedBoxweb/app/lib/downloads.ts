import { getOptionalPublicEnv } from './env';
import { readPublicManifest } from './manifest';
import type { ReleaseAsset, ReleaseManifest } from './types';

export async function getLatestManifest(): Promise<ReleaseManifest | null> {
    const env = getOptionalPublicEnv();
    if (!env) {
        return null;
    }
    return readPublicManifest(env.OSS_PUBLIC_BASE_URL);
}

export function pickPrimaryDownloadAssets(manifest: ReleaseManifest | null) {
    if (!manifest) {
        return {
            macArm64: null,
            macX64: null,
            windowsX64: null,
        };
    }

    const select = (platform: ReleaseAsset['platform'], arch: ReleaseAsset['arch']) => {
        const assets = manifest.assets.filter((asset) => asset.platform === platform && asset.arch === arch);
        const preferred = assets.find((asset) => asset.filename.endsWith('.dmg'))
            || assets.find((asset) => asset.filename.endsWith('.exe'))
            || assets.find((asset) => asset.filename.endsWith('.zip'))
            || null;
        return preferred;
    };

    return {
        macArm64: select('macos', 'arm64'),
        macX64: select('macos', 'x64'),
        windowsX64: select('windows', 'x64'),
    };
}

export function formatBytes(size: number) {
    if (!Number.isFinite(size) || size <= 0) return '未知大小';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatReleaseDate(iso: string) {
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return iso;
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(value);
}
