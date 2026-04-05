import { NextResponse } from 'next/server';
import { getLatestManifest } from '../../../lib/downloads';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const manifest = await getLatestManifest();
        if (!manifest) {
            return NextResponse.json({
                ready: false,
                manifest: null,
            });
        }

        return NextResponse.json({
            ready: true,
            manifest,
        });
    } catch (error) {
        return NextResponse.json({
            ready: false,
            error: error instanceof Error ? error.message : 'Failed to load latest downloads manifest',
        }, { status: 500 });
    }
}
