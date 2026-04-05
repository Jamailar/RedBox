export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { startReleaseSyncScheduler } = await import('./app/lib/scheduler');
        startReleaseSyncScheduler();
    }
}
