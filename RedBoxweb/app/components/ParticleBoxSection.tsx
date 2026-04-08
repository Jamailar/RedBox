'use client';

import Image from 'next/image';
import {
    Clapperboard,
    FilePenLine,
    Headphones,
    ImagePlus,
    type LucideIcon,
    MicVocal,
    Sparkles,
    Sticker,
    Video,
    WandSparkles,
} from 'lucide-react';
import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useRef, useEffect, useMemo } from 'react';

// --- Types ---
type Particle = {
    x: number;
    y: number;
    size: number;
    color: string;
    delay: number;
    phase: number;
    speed: number;
    drift: number;
    type: 'star' | 'mist' | 'dust' | 'magic';
};

type MediaSeed = {
    label: string;
    startX: number;
    startY: number;
    size: number;
    delay: number;
    Icon: LucideIcon;
};

// --- Constants ---
// Clustered tightly at the top to serve as the origin of the funnel
const MEDIA_SEEDS: MediaSeed[] = [
    { label: '稿件', startX: -180, startY: -220, size: 62, delay: 0.1, Icon: FilePenLine },
    { label: '封面', startX: -80, startY: -280, size: 58, delay: 0.15, Icon: ImagePlus },
    { label: '短视频', startX: 120, startY: -250, size: 64, delay: 0.12, Icon: Clapperboard },
    { label: '播客', startX: 200, startY: -180, size: 60, delay: 0.18, Icon: Headphones },
    { label: '灵感', startX: -260, startY: -120, size: 54, delay: 0.22, Icon: Sparkles },
    { label: '音频', startX: 280, startY: -100, size: 56, delay: 0.2, Icon: MicVocal },
    { label: '延展', startX: -160, startY: -40, size: 52, delay: 0.26, Icon: WandSparkles },
    { label: '片段', startX: 180, startY: -10, size: 52, delay: 0.24, Icon: Video },
    { label: '贴纸', startX: -80, startY: 80, size: 48, delay: 0.3, Icon: Sticker },
];

function generateParticles(count: number): Particle[] {
    return Array.from({ length: count }, () => {
        const typeRand = Math.random();
        let type: Particle['type'] = 'dust';
        if (typeRand > 0.95) type = 'magic';
        else if (typeRand > 0.70) type = 'star';
        else if (typeRand > 0.4) type = 'mist';

        // Starry night cluster distribution
        const r1 = Math.random();
        const r2 = Math.random();
        // Wider spread horizontally, densely packed around the center
        const radiusX = (Math.random() - 0.5) * 1200 * Math.pow(r1, 0.5); 
        const radiusY = (Math.random() - 0.5) * 450 * Math.pow(r2, 0.5);
        
        return {
            x: radiusX,
            y: radiusY, // Offset slightly upwards near media icons
            size: type === 'magic' ? 2 + Math.random() * 2 : type === 'star' ? 1 + Math.random() * 1.5 : 0.5 + Math.random() * 1,
            color: type === 'magic' ? '#ffd452' : type === 'star' ? '#ffffff' : '#f4ebd8',
            delay: Math.random() * 0.4, // Staggered start times
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 1.5,
            drift: (Math.random() - 0.5) * 80,
            type
        };
    });
}

// --- Components ---

function CanvasParticles({ progress }: { progress: MotionValue<number> }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // More particles for a starry feeling, since they will cluster
    const particles = useMemo(() => generateParticles(1200), []);
    const requestRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const handleResize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
        };
        handleResize();
        window.addEventListener('resize', handleResize);

        const render = () => {
            const p = progress.get();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const centerX = canvas.width / 2;
            const centerY = canvas.height * 0.20; // Top clustered center
            const targetX = canvas.width / 2;
            const targetY = canvas.height - 180;

            particles.forEach((particle) => {
                const localP = Math.max(0, Math.min(1, (p - particle.delay * 0.5) / (1 - particle.delay * 0.5)));
                
                // Funnel curve calculations: compress X faster than Y falls
                const easeX = Math.pow(localP, 1.5);
                const easeY = Math.pow(localP, 3);
                
                const funnelWidth = 1 - easeX;

                // Rotational/Vortex effect
                const spiralRadius = particle.drift * funnelWidth * 2 + (easeY * 20 * Math.sin(particle.phase));
                const spiralAngle = localP * 15 * particle.speed + particle.phase;
                const spiralX = Math.cos(spiralAngle) * spiralRadius;

                // Start configuration
                const startX = centerX + particle.x;
                const startY = centerY + particle.y;

                // Current position
                const currentX = centerX + (particle.x * funnelWidth) + spiralX;
                const currentY = startY + (targetY - startY) * easeY;

                // Tail position for motion trails
                const tailP = Math.max(0, localP - 0.04); // Length of the trail
                const easeX_tail = Math.pow(tailP, 1.5);
                const easeY_tail = Math.pow(tailP, 3);
                const spiralRadius_tail = particle.drift * (1 - easeX_tail) * 2 + (easeY_tail * 20 * Math.sin(particle.phase));
                const spiralAngle_tail = tailP * 15 * particle.speed + particle.phase;
                const tailX = centerX + (particle.x * (1 - easeX_tail)) + Math.cos(spiralAngle_tail) * spiralRadius_tail;
                const tailY = startY + (targetY - startY) * easeY_tail;

                // Visual Styling
                const flicker = Math.sin(Date.now() * 0.005 + particle.phase) * 0.3 + 0.7;
                const baseOpacity = particle.type === 'magic' ? 0.9 : 0.5;
                
                // Opacity is high when idle at top, spikes during motion, fades as it reaches the box
                const idleOpacity = (1 - localP) * baseOpacity * flicker;
                const motionOpacity = Math.min(1, localP * 6) * (1 - easeY * 0.9) * baseOpacity * flicker;
                const finalOpacity = Math.max(idleOpacity, motionOpacity);
                
                if (finalOpacity <= 0) return;

                const currentSize = Math.max(0.1, particle.size * (1 - easeY * 0.8));

                ctx.beginPath();
                ctx.moveTo(tailX, tailY);
                ctx.lineTo(currentX, currentY);
                
                ctx.globalAlpha = finalOpacity;
                ctx.lineWidth = currentSize;
                ctx.lineCap = 'round';
                ctx.strokeStyle = particle.color;

                if (particle.type === 'magic') {
                    ctx.shadowBlur = 12;
                    ctx.shadowColor = particle.color;
                } else if (particle.type === 'star') {
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = '#fff';
                } else {
                    ctx.shadowBlur = 0;
                }
                
                ctx.stroke();
            });
            ctx.globalAlpha = 1.0;

            requestRef.current = requestAnimationFrame(render);
        };

        requestRef.current = requestAnimationFrame(render);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            window.removeEventListener('resize', handleResize);
        };
    }, [progress, particles]);

    return (
        <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 z-20"
        />
    );
}

function MediaOrb({ progress, seed }: { progress: MotionValue<number>; seed: MediaSeed }) {
    // Smoother sweep into the box
    const x = useTransform(
        progress,
        [0, 0.3 + seed.delay * 0.15, 0.75, 0.95, 1],
        [seed.startX, seed.startX * 0.8, seed.startX * 0.2, 0, 0]
    );
    const y = useTransform(
        progress,
        [0, 0.3 + seed.delay * 0.15, 0.75, 0.95, 1],
        [seed.startY, seed.startY * 0.7 + 10, seed.startY * 0.1 + 180, 520, 560]
    );
    const scale = useTransform(progress, [0, 0.85, 0.98, 1], [1, 1, 0.2, 0]);
    const opacity = useTransform(progress, [0, 0.1, 0.9, 0.98, 1], [0, 1, 1, 0.3, 0]);
    const rotate = useTransform(progress, [0, 1], [seed.startX < 0 ? -6 : 6, seed.startX < 0 ? 30 : -30]);
    
    const Icon = seed.Icon;

    return (
        <motion.div
            className="absolute left-1/2 top-[20%] z-30"
            style={{ x, y, scale, opacity, rotate }}
        >
            <div className="group relative">
                <div className="absolute inset-0 -z-10 bg-[#ffd452]/20 blur-2xl transition-all duration-700 group-hover:bg-[#ffd452]/40" />
                <span
                    className="flex items-center justify-center rounded-2xl border border-white/40 bg-white/10 text-white/90 backdrop-blur-xl transition-all duration-500 hover:scale-110 hover:shadow-[0_0_40px_rgba(255,212,82,0.6)]"
                    style={{ width: seed.size, height: seed.size }}
                >
                    <Icon className="h-[52%] w-[52%]" strokeWidth={1.5} />
                </span>
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.2em] text-[#8e2f16]/70 opacity-0 transition-all duration-500 group-hover:translate-y-[-4px] group-hover:opacity-100">
                    {seed.label}
                </span>
            </div>
        </motion.div>
    );
}

export function ParticleBoxSection() {
    const sectionRef = useRef<HTMLElement | null>(null);
    const { scrollYProgress } = useScroll({
        target: sectionRef,
        offset: ['start start', 'end end'],
    });

    const progress = useSpring(scrollYProgress, {
        stiffness: 40,
        damping: 24,
        mass: 0.6,
    });

    const boxLift = useTransform(progress, [0.75, 1], [60, 0]);
    const boxScale = useTransform(progress, [0, 0.8, 1], [0.85, 0.95, 1.1]);
    const boxGlow = useTransform(progress, [0.7, 0.9, 1], [0, 0.4, 0.9]);
    
    const haloOpacity = useTransform(progress, [0, 0.6, 1], [0.8, 0.4, 0]);
    const haloScale = useTransform(progress, [0, 0.6, 1], [1, 0.9, 0.4]);
    
    const titleY = useTransform(progress, [0, 0.8, 1], ['0vh', '15vh', '45vh']);
    const titleScale = useTransform(progress, [0, 0.8, 1], [1, 0.7, 0.35]);
    const titleOpacity = useTransform(progress, [0, 0.8, 1], [1, 0.6, 0]);

    return (
        <section ref={sectionRef} className="relative h-[650vh]">
            <div className="sticky top-24 h-[calc(100vh-6rem)] w-full overflow-hidden bg-transparent">
                <div className="pointer-events-none absolute inset-0">
                    {/* Soft glowing ambient light at the origin to anchor the cluster */}
                    <motion.div
                        className="absolute left-1/2 top-[10%] h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,243,221,0.5),rgba(255,233,189,0.1),transparent)]"
                        style={{ scale: haloScale, opacity: haloOpacity, filter: 'blur(60px)' }}
                    />
                </div>
                
                <CanvasParticles progress={progress} />

                <div className="relative h-full w-full">
                    {MEDIA_SEEDS.map((seed) => (
                        <MediaOrb key={seed.label} progress={progress} seed={seed} />
                    ))}
                </div>

                <motion.div
                    className="pointer-events-none absolute left-1/2 top-[35%] z-40 w-full -translate-x-1/2 -translate-y-1/2 px-6 text-center"
                    style={{ y: titleY, scale: titleScale, opacity: titleOpacity }}
                >
                    <span className="mb-6 inline-block rounded-full border border-[#8e2f16]/10 bg-white/60 px-4 py-1.5 text-[11px] font-bold tracking-[0.25em] text-[#8e2f16]/70 shadow-sm backdrop-blur-md">
                        REDCONVERT STUDIO
                    </span>
                    <h1 className="mx-auto max-w-4xl bg-[linear-gradient(180deg,#1f140d_0%,#a43816_100%)] bg-clip-text font-serif text-[clamp(2.5rem,6.5vw,6rem)] leading-[1.05] tracking-[-0.05em] text-transparent drop-shadow-sm">
                        AI驱动的<br />
                        <span className="text-[#a43816]">全能自媒体编辑室</span>
                    </h1>
                </motion.div>

                <motion.div
                    className="absolute bottom-16 left-1/2 z-50 -translate-x-1/2"
                    style={{ y: boxLift, scale: boxScale }}
                >
                    <motion.div
                        className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,212,82,0.5),rgba(255,225,169,0.15),transparent)] blur-[60px]"
                        style={{ opacity: boxGlow }}
                    />
                    
                    <div className="relative">
                        <Image
                            src="/Box.png"
                            alt="RedBox"
                            width={450}
                            height={450}
                            className="h-auto w-[300px] drop-shadow-[0_50px_80px_rgba(100,45,28,0.3)] md:w-[380px]"
                            priority
                        />
                        
                        <motion.div
                            className="absolute inset-0 -z-10 animate-spin-slow"
                            style={{ 
                                opacity: useTransform(progress, [0.85, 1], [0, 0.8]),
                                scale: useTransform(progress, [0.85, 1], [0.8, 1.3])
                            }}
                        >
                            <div className="h-full w-full rounded-full border-[2px] border-dashed border-[#ffd452]/40" />
                        </motion.div>
                    </div>
                </motion.div>
            </div>
            
            <style jsx global>{`
                @keyframes spin-slow {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin-slow {
                    animation: spin-slow 15s linear infinite;
                }
            `}</style>
        </section>
    );
}
