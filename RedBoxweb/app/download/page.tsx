import { ArrowRight } from 'lucide-react';
import { SiteHeader } from '../components/SiteHeader';
import { getLatestManifest, pickPrimaryDownloadAssets } from '../lib/downloads';

export const dynamic = 'force-dynamic';

export default async function DownloadPage() {
    const manifest = await getLatestManifest();
    const downloads = pickPrimaryDownloadAssets(manifest);

    const items = [
        {
            label: 'macOS Apple Silicon',
            asset: downloads.macArm64,
        },
        {
            label: 'macOS Intel',
            asset: downloads.macX64,
        },
        {
            label: 'Windows x64',
            asset: downloads.windowsX64,
        },
    ];

    return (
        <main className="app-shell">
            <SiteHeader compact />

            <section className="page-section download-page">
                <div className="container download-page__inner">
                    {items.map((item) => (
                        item.asset ? (
                            <a key={item.label} href={item.asset.publicUrl} className="download-page__button">
                                <span className="download-page__button-label">{item.label}</span>
                                <span className="download-page__button-meta">
                                    <ArrowRight className="h-4 w-4" />
                                </span>
                            </a>
                        ) : (
                            <div key={item.label} className="download-page__button download-page__button--disabled">
                                <span className="download-page__button-label">{item.label}</span>
                                <span className="download-page__button-meta">镜像准备中</span>
                            </div>
                        )
                    ))}
                </div>
            </section>
        </main>
    );
}
