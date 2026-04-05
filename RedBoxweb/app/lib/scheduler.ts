import { listMissingSyncEnvKeys } from './env';

declare global {
    // eslint-disable-next-line no-var
    var __redboxSchedulerStarted: boolean | undefined;
    // eslint-disable-next-line no-var
    var __redboxSchedulerDisabledLogged: boolean | undefined;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

async function runSync(label: string) {
    try {
        const { syncLatestReleaseToOss } = await import('./release-sync');
        const result = await syncLatestReleaseToOss();
        console.info(`[redboxweb] ${label}: ${result.status} - ${result.reason}`);
    } catch (error) {
        console.error(`[redboxweb] ${label} failed`, error);
    }
}

export function startReleaseSyncScheduler() {
    if (globalThis.__redboxSchedulerStarted) {
        return;
    }

    const missing = listMissingSyncEnvKeys();
    if (missing.length > 0) {
        if (!globalThis.__redboxSchedulerDisabledLogged) {
            globalThis.__redboxSchedulerDisabledLogged = true;
            console.info(`[redboxweb] release sync disabled until env is configured: ${missing.join(', ')}`);
        }
        return;
    }

    globalThis.__redboxSchedulerStarted = true;
    void runSync('startup-sync');
    const timer = setInterval(() => {
        void runSync('interval-sync');
    }, TEN_MINUTES_MS);
    timer.unref?.();
}
