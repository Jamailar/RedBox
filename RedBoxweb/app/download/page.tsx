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
        <main className="min-h-screen pt-36 text-[#22170f] md:pt-32">
            <SiteHeader compact />

            <section className="px-4 pb-20 pt-6">
                <div className="mx-auto w-full max-w-4xl">
                    <div className="grid gap-4">
                        {items.map((item) =>
                            item.asset ? (
                                <a
                                    key={item.label}
                                    href={item.asset.publicUrl}
                                    className="flex min-h-[96px] items-center justify-between gap-4 rounded-[28px] border border-[#32231714] bg-white/74 px-6 py-5 text-lg font-bold text-[#22170f] shadow-[0_20px_44px_rgba(47,28,16,0.08)] transition hover:-translate-y-0.5 hover:bg-white/86"
                                >
                                    <span>{item.label}</span>
                                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d75d31]/10 text-[#a43816]">
                                        <ArrowRight className="h-4 w-4" />
                                    </span>
                                </a>
                            ) : (
                                <div
                                    key={item.label}
                                    className="flex min-h-[96px] items-center justify-between gap-4 rounded-[28px] border border-[#32231714] bg-white/48 px-6 py-5 text-lg font-bold text-[#22170f]/72 shadow-[0_18px_38px_rgba(47,28,16,0.06)]"
                                >
                                    <span>{item.label}</span>
                                    <span className="text-sm font-semibold text-[#8a715d]">镜像准备中</span>
                                </div>
                            )
                        )}
                    </div>
                </div>
            </section>
        </main>
    );
}
