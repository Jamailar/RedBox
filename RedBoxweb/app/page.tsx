import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Bot, Download, FolderArchive, ImagePlus, MessageSquarePlus, Sparkles, Workflow } from 'lucide-react';
import { formatBytes, formatReleaseDate, getLatestManifest, pickPrimaryDownloadAssets } from './lib/downloads';

export const dynamic = 'force-dynamic';

const workflowSteps = [
    {
        index: '01',
        title: '先采集，再沉淀',
        description: '通过浏览器插件把小红书、YouTube、网页链接和选中文字沉淀进本地知识库。',
        icon: FolderArchive,
    },
    {
        index: '02',
        title: '漫步找选题',
        description: '从知识库随机抽取素材，重组隐秘关联，把卡住的选题重新拉起来。',
        icon: Sparkles,
    },
    {
        index: '03',
        title: 'RedClaw 执行',
        description: '把创作、改写、配图、复盘交给单会话执行台，在一个线程内推进结果落盘。',
        icon: Bot,
    },
];

const featureCards = [
    {
        title: '知识库与稿件一体',
        summary: '采集、检索、起草、补素材都在本地完成，减少“素材在一个地方、输出在另一个地方”的割裂。',
        icon: Workflow,
    },
    {
        title: '多角色协作',
        summary: '聊天室、智囊团、RedClaw 分别承接脑暴、讨论与执行，不再把所有任务都塞进一个聊天框。',
        icon: MessageSquarePlus,
    },
    {
        title: '封面与配图联动',
        summary: '稿件和媒体素材一起管理，适合需要小红书封面、配图、发布包联动的创作流程。',
        icon: ImagePlus,
    },
];

const screenshots = [
    {
        src: '/screenshots/knowledge.png',
        title: '知识库',
        label: '采集后沉淀',
    },
    {
        src: '/screenshots/wander.png',
        title: '漫步',
        label: '卡题时找灵感',
    },
    {
        src: '/screenshots/redclaw.png',
        title: 'RedClaw',
        label: '下任务执行',
    },
    {
        src: '/screenshots/manuscripts.png',
        title: '稿件工作台',
        label: '内容与媒体一起走',
    },
    {
        src: '/screenshots/groupchat.png',
        title: '聊天室',
        label: '多人脑暴',
    },
    {
        src: '/screenshots/cover.jpg',
        title: '封面生成',
        label: '视觉资产联动',
    },
];

const faqs = [
    {
        question: '下载为什么不是 GitHub 链接？',
        answer: 'RedBoxweb 会把最新稳定版镜像到阿里云 OSS，再通过 OSS/CDN 提供下载，目的是在无法稳定访问 GitHub 的网络环境里也能拿到安装包。',
    },
    {
        question: '官网会复刻桌面端功能吗？',
        answer: '不会。这个站点只负责介绍产品与提供下载，真正的知识库、RedClaw、漫步和稿件工作流都仍在桌面端完成。',
    },
    {
        question: '现在支持哪些平台？',
        answer: '首版下载区固定展示 macOS Apple Silicon、macOS Intel 和 Windows x64 的最新稳定版安装包。',
    },
];

export default async function HomePage() {
    const manifest = await getLatestManifest();
    const downloads = pickPrimaryDownloadAssets(manifest);

    return (
        <main className="relative overflow-hidden">
            <div className="grain" />

            <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-12 px-5 pb-16 pt-6 md:px-8 md:pt-8">
                <header className="fade-up flex items-center justify-between rounded-full border border-[var(--line)] bg-[rgba(255,248,239,0.6)] px-4 py-3 backdrop-blur">
                    <Link href="/" className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(33,23,15,0.14)] bg-[rgba(255,252,246,0.95)] text-lg font-semibold text-[var(--accent-deep)]">
                            R
                        </span>
                        <div>
                            <div className="font-[family:var(--font-ui)] text-sm font-semibold tracking-[0.16em] text-[var(--accent-deep)] uppercase">
                                RedBox
                            </div>
                            <div className="text-xs text-[var(--muted)]">官网与下载镜像站</div>
                        </div>
                    </Link>

                    <a
                        href="#downloads"
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-deep)]"
                    >
                        <Download className="h-4 w-4" />
                        立即下载
                    </a>
                </header>

                <div className="grid gap-7 lg:grid-cols-[1.08fr_0.92fr] lg:items-stretch">
                    <div className="fade-up section-card soft-grid relative overflow-hidden rounded-[2rem] px-6 py-8 md:px-9 md:py-10">
                        <div className="absolute -right-16 top-0 h-44 w-44 rounded-full bg-[rgba(217,72,31,0.16)] blur-3xl" />
                        <div className="absolute bottom-0 left-8 h-36 w-36 rounded-full bg-[rgba(15,108,104,0.18)] blur-3xl" />
                        <span className="eyebrow mb-5">
                            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                            Local-first AI content workstation
                        </span>

                        <div className="max-w-3xl">
                            <h1 className="editorial-title text-[3.2rem] font-semibold text-[var(--ink)] sm:text-[4.3rem] lg:text-[5.6rem]">
                                给小红书创作者的
                                <span className="block text-[var(--accent-deep)]">本地 AI 工作台</span>
                            </h1>
                            <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--muted)] md:text-lg">
                                RedBox 把插件采集、知识库、漫步、RedClaw、稿件与配图协作串成一条本地创作链路。
                                这个官网不复刻工作流，只做一件更务实的事：把最新版安装包稳定送到你手里。
                            </p>
                        </div>

                        <div className="mt-9 flex flex-wrap items-center gap-4">
                            <a
                                href="#downloads"
                                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition hover:translate-y-[-1px]"
                            >
                                查看最新稳定版
                                <ArrowRight className="h-4 w-4" />
                            </a>
                            <a
                                href="https://github.com/Jamailar/RedBox"
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-5 py-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[rgba(255,248,240,0.8)]"
                            >
                                GitHub 仓库
                            </a>
                        </div>

                        <div className="mt-10 grid gap-4 sm:grid-cols-3">
                            {workflowSteps.map((item, index) => {
                                const Icon = item.icon;
                                return (
                                    <article
                                        key={item.title}
                                        className={`fade-up delay-${Math.min(index + 1, 3)} rounded-[1.6rem] border border-[rgba(33,23,15,0.1)] bg-[rgba(255,250,244,0.78)] p-4`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-[family:var(--font-ui)] text-xs font-bold tracking-[0.2em] text-[var(--accent-deep)] uppercase">
                                                {item.index}
                                            </span>
                                            <span className="rounded-full bg-[rgba(15,108,104,0.12)] p-2 text-[var(--teal)]">
                                                <Icon className="h-4 w-4" />
                                            </span>
                                        </div>
                                        <h2 className="mt-4 text-lg font-semibold">{item.title}</h2>
                                        <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{item.description}</p>
                                    </article>
                                );
                            })}
                        </div>
                    </div>

                    <aside className="fade-up delay-1 section-card relative rounded-[2rem] p-5 md:p-6">
                        <div className="absolute inset-x-6 top-6 flex items-center justify-between">
                            <span className="eyebrow">Latest Stable</span>
                            <span className="rounded-full border border-[rgba(33,23,15,0.12)] px-3 py-1 text-xs text-[var(--muted)]">
                                镜像下载
                            </span>
                        </div>

                        <div className="mt-20 rounded-[1.75rem] border border-[rgba(33,23,15,0.1)] bg-[rgba(255,250,244,0.9)] p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="font-[family:var(--font-ui)] text-xs font-bold tracking-[0.18em] text-[var(--accent-deep)] uppercase">
                                        当前版本
                                    </div>
                                    <div className="mt-2 text-3xl font-semibold">
                                        {manifest?.tag || '镜像准备中'}
                                    </div>
                                </div>
                                <Image
                                    src="/redbox.jpg"
                                    alt="RedBox"
                                    width={84}
                                    height={84}
                                    className="rounded-[1.25rem] border border-[rgba(33,23,15,0.1)]"
                                />
                            </div>

                            <div className="mt-5 grid gap-3 text-sm text-[var(--muted)] sm:grid-cols-2">
                                <div>
                                    <div className="text-xs uppercase tracking-[0.16em]">发布日期</div>
                                    <div className="mt-1 text-base text-[var(--ink)]">
                                        {manifest ? formatReleaseDate(manifest.publishedAt) : '等待首次同步'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs uppercase tracking-[0.16em]">下载来源</div>
                                    <div className="mt-1 text-base text-[var(--ink)]">阿里云 OSS / CDN</div>
                                </div>
                            </div>

                            <div id="downloads" className="mt-6 space-y-3">
                                {[
                                    {
                                        label: 'macOS Apple Silicon',
                                        meta: downloads.macArm64 ? formatBytes(downloads.macArm64.size) : '镜像准备中',
                                        asset: downloads.macArm64,
                                    },
                                    {
                                        label: 'macOS Intel',
                                        meta: downloads.macX64 ? formatBytes(downloads.macX64.size) : '镜像准备中',
                                        asset: downloads.macX64,
                                    },
                                    {
                                        label: 'Windows x64',
                                        meta: downloads.windowsX64 ? formatBytes(downloads.windowsX64.size) : '镜像准备中',
                                        asset: downloads.windowsX64,
                                    },
                                ].map((item) => (
                                    item.asset ? (
                                        <a
                                            key={item.label}
                                            href={item.asset.publicUrl}
                                            className="download-pill"
                                        >
                                            <span>
                                                <span className="block text-base font-semibold">{item.label}</span>
                                                <span className="mt-1 block text-sm text-[var(--muted)]">{item.asset.filename}</span>
                                            </span>
                                            <span className="text-right">
                                                <span className="block text-sm font-semibold text-[var(--accent-deep)]">{item.meta}</span>
                                                <span className="mt-1 inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                                                    直连下载
                                                    <ArrowRight className="h-3.5 w-3.5" />
                                                </span>
                                            </span>
                                        </a>
                                    ) : (
                                        <div key={item.label} className="download-pill opacity-70">
                                            <span>
                                                <span className="block text-base font-semibold">{item.label}</span>
                                                <span className="mt-1 block text-sm text-[var(--muted)]">同步完成后这里会出现直链</span>
                                            </span>
                                            <span className="text-sm font-semibold text-[var(--muted)]">{item.meta}</span>
                                        </div>
                                    )
                                ))}
                            </div>

                            <div className="mt-6 rounded-[1.35rem] bg-[rgba(33,23,15,0.04)] px-4 py-3 text-sm leading-7 text-[var(--muted)]">
                                {manifest
                                    ? `当前站点只展示最新稳定版 ${manifest.tag}。点击按钮后会直接进入 OSS/CDN 下载，不经过网站服务器中转。`
                                    : '当前还没有可用镜像。服务端会在启动后立即检查 GitHub Release，并每 10 分钟轮询一次。'}
                            </div>
                        </div>

                        <div className="mt-6 rounded-[1.75rem] border border-[rgba(33,23,15,0.1)] bg-[rgba(255,250,244,0.72)] p-5">
                            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-deep)]">
                                更新摘要
                            </div>
                            <div className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--muted)]">
                                {manifest?.notes || '镜像生成后，这里会显示 GitHub 最新稳定版 release notes。'}
                            </div>
                        </div>
                    </aside>
                </div>
            </section>

            <section className="mx-auto mt-2 w-full max-w-7xl px-5 pb-12 md:px-8">
                <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
                    <div className="section-card rounded-[2rem] p-6 md:p-8">
                        <span className="eyebrow">Why RedBox</span>
                        <h2 className="editorial-title mt-5 text-[2.25rem] font-semibold md:text-[3rem]">
                            它不是“又一个 AI 聊天工具”
                        </h2>
                        <p className="mt-4 max-w-xl text-base leading-8 text-[var(--muted)]">
                            RedBox 的重点不是把模型堆满，而是把创作者真正会反复切换的步骤接起来：素材采集、知识沉淀、选题发散、执行创作、封面配图与发布准备。
                        </p>

                        <div className="mt-7 space-y-4">
                            {featureCards.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <article key={item.title} className="rounded-[1.5rem] border border-[rgba(33,23,15,0.1)] bg-[rgba(255,250,244,0.82)] p-4">
                                        <div className="flex items-center gap-3">
                                            <span className="rounded-full bg-[rgba(217,72,31,0.12)] p-2 text-[var(--accent-deep)]">
                                                <Icon className="h-4 w-4" />
                                            </span>
                                            <h3 className="text-lg font-semibold">{item.title}</h3>
                                        </div>
                                        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{item.summary}</p>
                                    </article>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {screenshots.map((item, index) => (
                            <article
                                key={item.title}
                                className={`screenshot-card fade-up delay-${Math.min(index % 3, 3)}`}
                            >
                                <div className="relative aspect-[4/3]">
                                    <Image src={item.src} alt={item.title} fill sizes="(max-width: 768px) 100vw, 33vw" />
                                </div>
                                <div className="px-4 py-4">
                                    <div className="text-xs uppercase tracking-[0.16em] text-[var(--accent-deep)]">{item.label}</div>
                                    <div className="mt-2 text-lg font-semibold">{item.title}</div>
                                </div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className="mx-auto w-full max-w-7xl px-5 pb-18 md:px-8">
                <div className="section-card grid gap-7 rounded-[2rem] px-6 py-8 md:px-8 lg:grid-cols-[0.8fr_1.2fr]">
                    <div>
                        <span className="eyebrow">FAQ</span>
                        <h2 className="editorial-title mt-5 text-[2.2rem] font-semibold md:text-[3rem]">
                            先把下载问题讲清楚
                        </h2>
                        <p className="mt-4 max-w-md text-base leading-8 text-[var(--muted)]">
                            这个站点的核心职责就是“介绍产品”和“把安装包稳定交付出去”，所以 FAQ 也只围绕这两件事展开。
                        </p>
                    </div>

                    <div className="space-y-4">
                        {faqs.map((item) => (
                            <article key={item.question} className="rounded-[1.4rem] border border-[rgba(33,23,15,0.1)] bg-[rgba(255,250,244,0.82)] p-5">
                                <h3 className="text-lg font-semibold">{item.question}</h3>
                                <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{item.answer}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
        </main>
    );
}
