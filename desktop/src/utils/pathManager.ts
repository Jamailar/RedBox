import { coerceToRedboxAssetUrl, isLocalAssetSource } from '../../shared/localAsset';

const SAFE_RENDERABLE_PROTOCOL = /^(https?:|data:|blob:)/i;

export function resolveAssetUrl(value: string | null | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (SAFE_RENDERABLE_PROTOCOL.test(raw)) return raw;
    if (isLocalAssetSource(raw)) return coerceToRedboxAssetUrl(raw);
    return raw;
}

export function hasRenderableAssetUrl(value: string | null | undefined): boolean {
    const resolved = resolveAssetUrl(value);
    return Boolean(resolved) && !/^javascript:/i.test(resolved);
}

export function isLocalAssetUrl(value: string | null | undefined): boolean {
    return isLocalAssetSource(String(value || '').trim());
}
