import { getSyncEnv } from './env';

async function createOssClient() {
    const { default: OSS } = await import('ali-oss');
    const env = getSyncEnv();
    return new OSS({
        region: env.OSS_REGION,
        bucket: env.OSS_BUCKET,
        accessKeyId: env.OSS_ACCESS_KEY_ID,
        accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    });
}

export async function uploadBufferToOss(key: string, buffer: Buffer, contentType: string) {
    const client = await createOssClient();
    await client.put(key, buffer, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=300',
        },
    } as any);
}

export async function mirrorRemoteFileToOss(key: string, downloadUrl: string, contentType: string) {
    const { Readable } = await import('node:stream');
    const response = await fetch(downloadUrl, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        throw new Error(`Failed to download asset (${response.status}) ${downloadUrl}: ${body || response.statusText}`);
    }

    const client = await createOssClient();
    const stream = Readable.fromWeb(response.body as any);
    await client.putStream(key, stream, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    } as any);
}
