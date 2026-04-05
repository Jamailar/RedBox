import type { GithubRelease } from './types';

export async function fetchLatestGithubRelease(owner: string, repo: string, token?: string): Promise<GithubRelease> {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub latest release request failed (${response.status}): ${body || response.statusText}`);
    }

    const release = await response.json() as GithubRelease;
    if (release.draft || release.prerelease) {
        throw new Error(`Latest GitHub release is not a stable release: ${release.tag_name}`);
    }

    return release;
}
