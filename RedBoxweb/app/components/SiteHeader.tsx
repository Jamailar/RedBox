import Link from 'next/link';

interface SiteHeaderProps {
    compact?: boolean;
}

export function SiteHeader({ compact = false }: SiteHeaderProps) {
    return (
        <div className="header-shell">
            <header className={`top-nav${compact ? ' top-nav--compact' : ''}`}>
                <Link href="/" className="brand">
                    <span className="brand__mark">R</span>
                    <span className="brand__label">
                        <strong>RedBox</strong>
                        <small>自媒体 AI 全能工作台</small>
                    </span>
                </Link>

                <nav className="nav-links" aria-label="站点导航">
                    <Link href="/#capabilities">功能</Link>
                    <Link href="/#workflow">流程</Link>
                    <Link href="/download">下载</Link>
                </nav>

                <div className="actions">
                    <a
                        href="https://github.com/Jamailar/RedBox"
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost"
                    >
                        GitHub
                    </a>
                    <Link href="/download" className="btn btn-primary">
                        下载页
                    </Link>
                </div>
            </header>
        </div>
    );
}
