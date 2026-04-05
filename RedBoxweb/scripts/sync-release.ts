import { syncLatestReleaseToOss } from '../app/lib/release-sync';

async function main() {
    const result = await syncLatestReleaseToOss();
    console.info(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
