import { NextRequest, NextResponse } from 'next/server';
import { getOptionalSyncEnv, listMissingSyncEnvKeys } from '../../../lib/env';
import { syncLatestReleaseToOss } from '../../../lib/release-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(request: NextRequest) {
    const env = getOptionalSyncEnv();
    if (!env) {
        return false;
    }
    const authHeader = request.headers.get('authorization') || '';
    const expected = `Bearer ${env.SYNC_AUTH_TOKEN}`;
    return authHeader === expected;
}

export async function POST(request: NextRequest) {
    const env = getOptionalSyncEnv();
    if (!env) {
        return NextResponse.json({
            error: `Sync is not configured. Missing environment variables: ${listMissingSyncEnvKeys().join(', ')}`,
        }, { status: 503 });
    }

    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await syncLatestReleaseToOss();
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Release sync failed',
        }, { status: 500 });
    }
}
