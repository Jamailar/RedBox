import {
    AudioLines,
    Clapperboard,
    FilePenLine,
    ImagePlus,
    Lightbulb,
    Video,
} from 'lucide-react';
import { SiteHeader } from './components/SiteHeader';

export const dynamic = 'force-dynamic';

const capabilities = [
    {
        title: '灵感采集',
        summary: '把选题、碎片灵感、素材方向和参考信息集中到同一个入口。',
        icon: Lightbulb,
    },
    {
        title: 'AI 创作',
        summary: '从结构、标题到正文与脚本，让内容从想法推进到可发布草稿。',
        icon: FilePenLine,
    },
    {
        title: 'AI 剪视频',
        summary: '围绕短视频生产链做内容整理与加工，减少人工拼接成本。',
        icon: Clapperboard,
    },
    {
        title: 'AI 剪播客',
        summary: '让长音频的提炼、裁切和包装不再停留在纯手工阶段。',
        icon: AudioLines,
    },
    {
        title: 'AI 生图',
        summary: '封面、配图与视觉资产在同一个工作台里补齐，不再跳转多处。',
        icon: ImagePlus,
    },
    {
        title: 'AI 生视频',
        summary: '把动态内容生成正式纳入整条内容工作流，而不是孤立的单点功能。',
        icon: Video,
    },
];

const workflow = [
    '先收集灵感、素材、选题方向',
    '再让 AI 生成文案、脚本和内容骨架',
    '继续扩展到视频、播客、图片与动态内容',
    '最后统一整理、下载并推进交付',
];

const faqs = [
    {
        question: 'RedBox 更像什么产品？',
        answer: '它不是单点的聊天机器人，也不是只做文案的写作器。RedBox 更接近一个面向自媒体创作者的 AI 全能工作台，把灵感、文字、音频、视频和视觉资产放到同一条生产链里。',
    },
    {
        question: '官网负责什么，桌面端负责什么？',
        answer: '官网只负责介绍产品和提供下载。真正的灵感采集、AI 创作、AI 剪视频、AI 剪播客、AI 生图和 AI 生视频都在桌面端工作台内完成。',
    },
    {
        question: '为什么下载链接不是直接 GitHub？',
        answer: '因为很多用户无法稳定访问 GitHub Release。RedBoxweb 会把最新稳定版镜像到阿里云 OSS，再通过更快的链路提供下载。',
    },
];

export default async function HomePage() {
    return (
        <main className="app-shell">
            <SiteHeader />

            <section className="page-section hero-section">
                <div className="container">
                    <div className="hero-copy card">
                        <span className="eyebrow">All-in-one Media Workflow</span>
                        <h1 className="hero-title">
                            从灵感到发布，
                            <span>用一个工作台做完。</span>
                        </h1>
                        <p className="hero-summary">
                            RedBox 面向自媒体创作者，把灵感采集、AI 创作、AI 剪视频、AI 剪播客、AI 生图、AI 生视频放进同一条生产链。
                            你不需要再先找六个工具，再把它们勉强拼起来。
                        </p>

                        <div className="hero-notes">
                            <div className="hero-note">
                                <span>定位</span>
                                <strong>不是单点 AI 工具，而是内容生产工作台</strong>
                            </div>
                            <div className="hero-note">
                                <span>适合对象</span>
                                <strong>个人创作者、工作室、小团队、多媒介内容生产</strong>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="capabilities" className="page-section">
                <div className="container section-heading">
                    <span className="eyebrow">Capabilities</span>
                    <h2>六个 AI 模块，一条完整内容生产线。</h2>
                    <p>
                        RedBox 的重点不是只做文案，也不是只做视频。它解决的是创作者在文字、音频、视频和视觉资产之间频繁切换时，工具链过于分散的问题。
                    </p>
                </div>

                <div className="container capability-grid">
                    {capabilities.map((item) => {
                        const Icon = item.icon;
                        return (
                            <article key={item.title} className="card capability-card">
                                <div className="capability-card__head">
                                    <span className="capability-card__index">{item.title}</span>
                                    <span className="capability-card__icon">
                                        <Icon className="h-5 w-5" />
                                    </span>
                                </div>
                                <p className="capability-card__title">{item.title}</p>
                                <p className="capability-card__summary">{item.summary}</p>
                            </article>
                        );
                    })}
                </div>
            </section>

            <section id="workflow" className="page-section workflow-section">
                <div className="container workflow-layout">
                    <div className="workflow-copy">
                        <span className="eyebrow">Workflow</span>
                        <h2>内容不是单次生成，而是连续加工。</h2>
                        <p>
                            很多产品只覆盖一个步骤。RedBox 更关注整段内容路径，从灵感入口开始，持续推进到创作、媒体加工与交付。
                        </p>
                    </div>

                    <div className="workflow-list">
                        {workflow.map((item, index) => (
                            <article key={item} className="card workflow-item">
                                <div className="workflow-item__index">{String(index + 1).padStart(2, '0')}</div>
                                <div className="workflow-item__text">{item}</div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className="page-section faq-section">
                <div className="container faq-shell card">
                    <div className="section-heading section-heading--compact">
                        <span className="eyebrow">FAQ</span>
                        <h2>先把产品边界讲清楚。</h2>
                    </div>

                    <div className="faq-list">
                        {faqs.map((item) => (
                            <article key={item.question} className="faq-item">
                                <h3>{item.question}</h3>
                                <p>{item.answer}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
        </main>
    );
}
