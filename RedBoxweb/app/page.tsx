import {
    Boxes,
    FilePenLine,
    ImagePlus,
    Lightbulb,
    Video,
} from 'lucide-react';
import { SiteHeader } from './components/SiteHeader';

export const dynamic = 'force-dynamic';

const heroSignals = ['素材 → 成稿 → 视频 → 封面', '同一个空间完成', '为持续创作设计'];

const studioAreas = [
    {
        title: '素材区',
        summary: '收藏的笔记、文章、截图、上传的内容，都在这里沉淀下来。它们不是被存放，而是会被重新理解和调用。',
        icon: Boxes,
    },
    {
        title: '灵感区',
        summary: '它会在素材之间建立联系。有时是你主动寻找，有时是它随机带你漫步。三个看似无关的内容，也可以长出一个新的选题。',
        icon: Lightbulb,
    },
    {
        title: '创作区',
        summary: '一个想法，在这里直接变成一篇完整稿子。不需要反复复制粘贴，也不会停在“我先记一下”。',
        icon: FilePenLine,
    },
    {
        title: '延展区',
        summary: '同一个主题，会自然延展成视频、播客和封面。不是重新做一遍，而是顺着这条内容继续走下去。',
        icon: Video,
    },
];

const oldWay = [
    '灵感在收藏夹',
    '写作在聊天工具',
    '视频在剪辑软件',
    '封面在设计工具',
];

const redBoxWay = [
    '素材在这里沉淀',
    '灵感在这里生成',
    '内容在这里完成',
    '一条线走到底',
];

const dayFlow = [
    {
        label: '早上',
        title: '把看到的内容丢进来',
        summary: '不需要整理，它会被理解。',
    },
    {
        label: '下午',
        title: '从素材里长出一篇稿子',
        summary: '不是写出来，是被推进出来。',
    },
    {
        label: '晚上',
        title: '顺着这条内容，变成视频和封面',
        summary: '一切都还在同一个地方。',
    },
];

const faqs = [
    {
        question: '如果我只是偶尔写点东西？',
        answer: '这个编辑室可能不适合你。它更适合持续创作的人。',
    },
    {
        question: '它和普通 AI 写作有什么不同？',
        answer: '它不是帮你写一段话，而是让一条内容从素材开始，一路完成。',
    },
    {
        question: '为什么叫编辑室？',
        answer: '因为这里不是工具集合，而是一个持续发生创作的空间。',
    },
];

export default function HomePage() {
    return (
        <main className="min-h-screen pt-36 text-[#22170f] md:pt-32">
            <SiteHeader />

            <section className="relative overflow-hidden px-4 pb-20 pt-6 md:pb-28">
                <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[620px] max-w-6xl">
                    <div className="absolute -left-8 top-12 h-56 w-56 rounded-full bg-[#d75d31]/12 blur-3xl" />
                    <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-[#0d6c68]/10 blur-3xl" />
                </div>

                <div className="mx-auto grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[1fr_0.96fr]">
                    <div className="max-w-[640px]">
                        <span className="inline-flex rounded-full border border-[#32231714] bg-white/72 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#6d5a4f]">
                            AI-Driven Editorial Studio
                        </span>
                        <h1 className="mt-5 max-w-[9.6ch] font-serif text-[clamp(3.35rem,7vw,6.4rem)] leading-[0.88] tracking-[-0.06em] text-[#1f140d]">
                            AI驱动的
                            <span className="block text-[#a43816]">自媒体编辑室</span>
                        </h1>
                        <p className="mt-6 max-w-[38rem] text-[1.03rem] leading-8 text-[#6b5b4d]">
                            从素材到成稿，再到视频与封面，创作在这里自然发生。
                        </p>
                        <p className="mt-3 max-w-[38rem] text-base leading-8 text-[#5f4a3c]">
                            不再在不同工具之间来回切，一切都在同一个空间完成。
                        </p>

                        <div className="mt-8 flex flex-wrap gap-3">
                            {heroSignals.map((item) => (
                                <span
                                    key={item}
                                    className="inline-flex rounded-full border border-[#32231714] bg-white/66 px-4 py-2.5 text-[13px] font-bold text-[#5f4a3c] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                                >
                                    {item}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="relative">
                        <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(31,24,19,0.98),rgba(24,20,18,0.96))] p-4 text-white shadow-[0_34px_70px_rgba(47,28,16,0.18)] md:p-5">
                            <div className="rounded-[22px] border border-white/8 bg-white/5 p-5">
                                <span className="inline-flex rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/75">
                                    一个让内容自己生长的编辑空间
                                </span>
                                <div className="mt-5 space-y-4">
                                    <p className="text-[15px] leading-8 text-white/74">
                                        把素材放进来，灵感会在这里被看见、被连接、被延展。
                                    </p>
                                    <p className="text-[15px] leading-8 text-white/74">
                                        一篇稿子不会停在草稿，它会继续变成视频、播客和封面。
                                    </p>
                                    <p className="text-[15px] leading-8 text-white/74">
                                        你不需要一步步推进，它会自己往下走。
                                    </p>
                                </div>

                                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                    {studioAreas.map((item) => {
                                        const Icon = item.icon;

                                        return (
                                            <article
                                                key={item.title}
                                                className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-white/5 px-3.5 py-3"
                                            >
                                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[linear-gradient(145deg,rgba(223,96,49,0.26),rgba(13,108,104,0.14))] text-[#ffd9cc]">
                                                    <Icon className="h-4 w-4" />
                                                </span>
                                                <strong className="text-sm font-bold text-white/88">{item.title}</strong>
                                            </article>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3 lg:absolute lg:-bottom-5 lg:-left-5 lg:mt-0">
                            <div className="rounded-[20px] border border-[#32231714] bg-white/78 px-4 py-3 text-sm font-bold text-[#3f2b20] shadow-[0_16px_28px_rgba(47,28,16,0.1)] backdrop-blur-xl">
                                <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#816655]">
                                    核心价值
                                </span>
                                创作，不再被打断
                            </div>
                            <div className="rounded-[20px] border border-[#32231714] bg-white/78 px-4 py-3 text-sm font-bold text-[#3f2b20] shadow-[0_16px_28px_rgba(47,28,16,0.1)] backdrop-blur-xl">
                                <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#816655]">
                                    适合对象
                                </span>
                                持续创作的人
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="capabilities" className="px-4 py-10">
                <div className="mx-auto w-full max-w-6xl">
                    <div className="max-w-[760px]">
                        <span className="inline-flex rounded-full border border-[#32231714] bg-white/72 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#6d5a4f]">
                            Studio Areas
                        </span>
                        <h2 className="mt-5 max-w-[11ch] font-serif text-[clamp(2.5rem,5vw,4.2rem)] leading-[0.95] tracking-[-0.05em] text-[#20150f]">
                            这不是功能模块，
                            <span className="block text-[#a43816]">而是四个连续发生创作的空间。</span>
                        </h2>
                    </div>

                    <div className="mt-8 grid gap-4 md:grid-cols-2">
                        {studioAreas.map((item) => {
                            const Icon = item.icon;

                            return (
                                <article
                                    key={item.title}
                                    className="relative overflow-hidden rounded-[30px] border border-[#32231714] bg-white/72 p-6 shadow-[0_18px_40px_rgba(47,28,16,0.08)]"
                                >
                                    <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgba(215,93,49,0.82),rgba(13,108,104,0.4))]" />
                                    <div className="flex items-center justify-between gap-4">
                                        <h3 className="text-xl font-bold text-[#22170f]">{item.title}</h3>
                                        <span className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#d75d31]/10 text-[#a43816]">
                                            <Icon className="h-5 w-5" />
                                        </span>
                                    </div>
                                    <p className="mt-4 max-w-[24rem] text-[15px] leading-8 text-[#6b5b4d]">{item.summary}</p>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="px-4 py-10">
                <div className="mx-auto grid w-full max-w-6xl gap-4 rounded-[34px] border border-[#32231714] bg-white/64 p-3 shadow-[0_22px_48px_rgba(47,28,16,0.08)] lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-[28px] bg-[linear-gradient(180deg,rgba(37,29,24,0.96),rgba(26,21,18,0.95))] p-7 text-white">
                        <span className="inline-flex rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/72">
                            Core Value
                        </span>
                        <h2 className="mt-5 max-w-[9ch] font-serif text-[clamp(2.4rem,5vw,4rem)] leading-[0.95] tracking-[-0.05em]">
                            创作，
                            <span className="block text-[#ffd4c6]">不再被打断</span>
                        </h2>
                    </div>

                    <div className="rounded-[28px] bg-white/78 p-7">
                        <p className="max-w-[34rem] text-[17px] leading-9 text-[#4d3b2f]">
                            真正拖慢创作的，从来不是写，而是切换。在不同工具之间来回跳转，让一条内容被不断中断。
                        </p>
                        <p className="mt-4 max-w-[34rem] text-[17px] leading-9 text-[#4d3b2f]">
                            在这个编辑室里，一切都在同一个空间发生。
                        </p>
                    </div>
                </div>
            </section>

            <section className="px-4 py-10">
                <div className="mx-auto w-full max-w-6xl">
                    <div className="max-w-[760px]">
                        <span className="inline-flex rounded-full border border-[#32231714] bg-white/72 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#6d5a4f]">
                            Why RedBox
                        </span>
                        <h2 className="mt-5 max-w-[11ch] font-serif text-[clamp(2.5rem,5vw,4.2rem)] leading-[0.95] tracking-[-0.05em] text-[#20150f]">
                            你不缺工具，
                            <span className="block text-[#0f5d5a]">你缺的是一个连续的创作空间。</span>
                        </h2>
                    </div>

                    <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
                        <article className="rounded-[30px] border border-[#32231714] bg-white/72 p-6 text-[#22170f] shadow-[0_20px_44px_rgba(47,28,16,0.08)]">
                            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8a715d]">现在的方式</span>
                            <ul className="mt-5 grid gap-3">
                                {oldWay.map((item) => (
                                    <li
                                        key={item}
                                        className="rounded-[18px] border border-[#32231714] bg-white/72 px-4 py-3 text-[15px] font-semibold text-[#4d3b2f]"
                                    >
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </article>

                        <div className="hidden items-center justify-center lg:flex">
                            <div className="rounded-full bg-[#a43816] px-4 py-2 text-sm font-bold text-white shadow-[0_14px_28px_rgba(164,56,22,0.2)]">
                                一条线
                            </div>
                        </div>

                        <article className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(37,29,24,0.96),rgba(26,21,18,0.95))] p-6 text-white shadow-[0_24px_48px_rgba(47,28,16,0.14)]">
                            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/48">在 RedBox 里</span>
                            <ul className="mt-5 grid gap-3">
                                {redBoxWay.map((item) => (
                                    <li key={item} className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-[15px] font-semibold text-white/90">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </article>
                    </div>
                </div>
            </section>

            <section id="workflow" className="px-4 py-12">
                <div className="mx-auto grid w-full max-w-6xl gap-4 rounded-[34px] border border-[#32231714] bg-white/64 p-3 shadow-[0_22px_48px_rgba(47,28,16,0.08)] lg:grid-cols-[0.84fr_1.16fr]">
                    <div className="rounded-[28px] bg-[linear-gradient(180deg,rgba(37,29,24,0.96),rgba(26,21,18,0.95))] p-7 text-white">
                        <span className="inline-flex rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/72">
                            A Day In The Studio
                        </span>
                        <h2 className="mt-5 max-w-[10ch] font-serif text-[clamp(2.4rem,5vw,4rem)] leading-[0.95] tracking-[-0.05em]">
                            在这个编辑室的
                            <span className="block text-[#ffd4c6]">一天</span>
                        </h2>
                    </div>

                    <div className="grid gap-4">
                        {dayFlow.map((item) => (
                            <article
                                key={item.label}
                                className="grid gap-4 rounded-[26px] border border-[#32231714] bg-white/78 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] md:grid-cols-[88px_1fr]"
                            >
                                <div className="flex h-[68px] items-center justify-center rounded-[20px] bg-[#d75d31]/10 text-sm font-extrabold tracking-[0.14em] text-[#a43816]">
                                    {item.label}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-[#22170f]">{item.title}</h3>
                                    <p className="mt-2.5 leading-8 text-[#6b5b4d]">{item.summary}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className="px-4 py-12 pb-20">
                <div className="mx-auto w-full max-w-6xl">
                    <div className="max-w-[720px]">
                        <span className="inline-flex rounded-full border border-[#32231714] bg-white/72 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#6d5a4f]">
                            FAQ
                        </span>
                        <h2 className="mt-5 max-w-[11ch] font-serif text-[clamp(2.4rem,4.8vw,4rem)] leading-[0.95] tracking-[-0.05em] text-[#20150f]">
                            这里不是工具集合，
                            <span className="block text-[#0f5d5a]">而是创作发生的空间。</span>
                        </h2>
                    </div>

                    <div className="mt-8 grid gap-4 lg:grid-cols-3">
                        {faqs.map((item) => (
                            <article
                                key={item.question}
                                className="rounded-[28px] border border-[#32231714] bg-white/72 p-6 shadow-[0_18px_40px_rgba(47,28,16,0.08)]"
                            >
                                <h3 className="text-lg font-bold leading-8 text-[#22170f]">{item.question}</h3>
                                <p className="mt-3 leading-8 text-[#6b5b4d]">{item.answer}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>
        </main>
    );
}
