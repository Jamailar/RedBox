import type { ReleaseManifest } from './types';

const MANIFEST_KEY = 'manifests/latest.json';

export function getManifestKey() {
    return MANIFEST_KEY;
}

export function buildPublicUrl(baseUrl: string, key: string) {
    return `${baseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

export async function readPublicManifest(baseUrl: string): Promise<ReleaseManifest | null> {
    const url = buildPublicUrl(baseUrl, MANIFEST_KEY);
    const response = await fetch(url, {
        cache: 'no-store',
    });

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to fetch public manifest (${response.status}): ${body || response.statusText}`);
    }

    return await response.json() as ReleaseManifest;
}
