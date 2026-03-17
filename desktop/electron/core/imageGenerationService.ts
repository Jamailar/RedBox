import { getSettings } from '../db';
import { createGeneratedMediaAsset, type MediaAsset } from './mediaLibraryStore';

export interface GenerateImagesInput {
    prompt: string;
    projectId?: string;
    title?: string;
    count?: number;
    size?: string;
    quality?: string;
    model?: string;
    provider?: string;
    endpoint?: string;
    apiKey?: string;
}

export interface GenerateImagesResult {
    provider: string;
    model: string;
    size: string;
    quality: string;
    assets: MediaAsset[];
}

async function fetchImageByUrl(url: string): Promise<{ imageBuffer: Buffer; mimeType?: string }> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch generated image URL: ${response.status} ${response.statusText}`);
    }
    const mimeType = response.headers.get('content-type') || 'image/png';
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    return { imageBuffer, mimeType };
}

async function normalizeGeneratedImages(payload: any): Promise<Array<{ imageBuffer: Buffer; mimeType?: string }>> {
    const outputs: Array<{ imageBuffer: Buffer; mimeType?: string }> = [];
    const pushBase64 = (raw: string, mimeType?: string) => {
        if (!raw || typeof raw !== 'string') return;
        outputs.push({ imageBuffer: Buffer.from(raw, 'base64'), mimeType: mimeType || 'image/png' });
    };

    const readDataArray = async (items: any[]) => {
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
                pushBase64(item.b64_json, item.mime_type || item.mimeType);
                continue;
            }
            if (typeof item.base64 === 'string' && item.base64.trim()) {
                pushBase64(item.base64, item.mime_type || item.mimeType);
                continue;
            }
            if (typeof item.image_base64 === 'string' && item.image_base64.trim()) {
                pushBase64(item.image_base64, item.mime_type || item.mimeType);
                continue;
            }
            if (typeof item.url === 'string' && item.url.trim()) {
                outputs.push(await fetchImageByUrl(item.url.trim()));
            }
        }
    };

    if (Array.isArray(payload?.data)) {
        await readDataArray(payload.data);
    }
    if (Array.isArray(payload?.output?.results)) {
        await readDataArray(payload.output.results);
    }
    if (Array.isArray(payload?.output?.images)) {
        for (const image of payload.output.images) {
            if (typeof image === 'string' && image.trim()) {
                outputs.push(await fetchImageByUrl(image.trim()));
                continue;
            }
            if (image && typeof image === 'object') {
                if (typeof image.url === 'string' && image.url.trim()) {
                    outputs.push(await fetchImageByUrl(image.url.trim()));
                    continue;
                }
                if (typeof image.b64_json === 'string' && image.b64_json.trim()) {
                    pushBase64(image.b64_json, image.mime_type || image.mimeType);
                }
            }
        }
    }
    if (typeof payload?.output?.image === 'string' && payload.output.image.trim()) {
        pushBase64(payload.output.image, payload.output?.mime_type || payload.output?.mimeType || 'image/png');
    }

    return outputs;
}

export async function generateImagesToMediaLibrary(input: GenerateImagesInput): Promise<GenerateImagesResult> {
    const normalizedPrompt = String(input.prompt || '').trim();
    if (!normalizedPrompt) {
        throw new Error('Prompt is required');
    }

    const settings = (getSettings() || {}) as Record<string, unknown>;
    const provider = String(input.provider || settings.image_provider || 'openai-compatible').trim();
    const endpoint = String(input.endpoint || settings.image_endpoint || settings.api_endpoint || '').trim();
    const apiKey = String(input.apiKey || settings.image_api_key || settings.api_key || '').trim();
    const model = String(input.model || settings.image_model || 'gpt-image-1').trim();
    const size = String(input.size || settings.image_size || '1024x1024').trim();
    const quality = String(input.quality || settings.image_quality || 'standard').trim();
    const count = Math.max(1, Math.min(4, Number(input.count) || 1));

    if (!endpoint) {
        throw new Error('Image endpoint is missing. Please configure it in Settings.');
    }
    if (!apiKey) {
        throw new Error('Image API key is missing. Please configure it in Settings.');
    }

    const response = await fetch(`${endpoint.replace(/\/+$/, '')}/images/generations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            prompt: normalizedPrompt,
            n: count,
            size,
            quality,
            response_format: 'b64_json',
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Image generation failed (${response.status}): ${errorText || response.statusText}`);
    }

    const payload = await response.json();
    const images = await normalizeGeneratedImages(payload);
    if (images.length === 0) {
        throw new Error('Image generation returned no valid image payload.');
    }

    const assets: MediaAsset[] = [];
    for (const output of images.slice(0, count)) {
        const asset = await createGeneratedMediaAsset({
            prompt: normalizedPrompt,
            imageBuffer: output.imageBuffer,
            mimeType: output.mimeType,
            projectId: input.projectId?.trim() || undefined,
            provider,
            model,
            size,
            quality,
            title: input.title?.trim() || undefined,
        });
        assets.push(asset);
    }

    return {
        provider,
        model,
        size,
        quality,
        assets,
    };
}
