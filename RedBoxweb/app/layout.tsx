import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'RedBox | 本地 AI 创作工作台',
    description: 'RedBox 官网与下载镜像站，提供最新稳定版高速下载，并介绍知识采集、RedClaw、漫步、稿件与配图协作能力。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="zh-CN">
            <body>{children}</body>
        </html>
    );
}
