export type ModelCapability =
    | 'chat'
    | 'image'
    | 'video'
    | 'audio'
    | 'transcription'
    | 'embedding';

export const MODEL_CAPABILITY_ORDER: ModelCapability[] = [
    'chat',
    'image',
    'video',
    'audio',
    'transcription',
    'embedding',
];

export const MODEL_CAPABILITY_META: Record<ModelCapability, { label: string; shortLabel: string }> = {
    chat: { label: '聊天', shortLabel: '聊天' },
    image: { label: '图片生成', shortLabel: '图片' },
    video: { label: '视频生成', shortLabel: '视频' },
    audio: { label: '音频生成', shortLabel: '音频' },
    transcription: { label: '转录', shortLabel: '转录' },
    embedding: { label: '向量', shortLabel: '向量' },
};

const CAPABILITY_RULES: Array<{ capability: ModelCapability; patterns: RegExp[] }> = [
    { capability: 'embedding', patterns: [/\bembedding\b/i, /\bembed\b/i] },
    { capability: 'transcription', patterns: [/\basr\b/i, /\bwhisper\b/i] },
    { capability: 'audio', patterns: [/\btts\b/i, /\bspeech\b/i] },
    { capability: 'video', patterns: [/\bvideo\b/i, /\bveo\b/i, /\bseedance\b/i, /\bkling\b/i, /\bvidu\b/i, /\bluma\b/i, /\bsora\b/i] },
    { capability: 'image', patterns: [/\bimage\b/i, /\bdall-?e\b/i, /\bimagen\b/i, /\bseedream\b/i, /\bbanana\b/i] },
];

const FORCED_CAPABILITY_RULES: Array<{ capabilities: ModelCapability[]; patterns: RegExp[] }> = [
    { capabilities: ['video'], patterns: [/\bseedance\b/i] },
    { capabilities: ['image'], patterns: [/\bseedream\b/i, /\bbanana\b/i] },
];

export const getForcedModelCapabilities = (modelId: string): ModelCapability[] => {
    const normalized = String(modelId || '').trim().toLowerCase();
    if (!normalized) return [];
    for (const rule of FORCED_CAPABILITY_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(normalized))) {
            return rule.capabilities;
        }
    }
    return [];
};

export const inferModelCapabilities = (modelId: string): ModelCapability[] => {
    const normalized = String(modelId || '').trim().toLowerCase();
    if (!normalized) return ['chat'];

    const forced = getForcedModelCapabilities(normalized);
    if (forced.length > 0) {
        return forced;
    }

    const detected = new Set<ModelCapability>();
    for (const rule of CAPABILITY_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(normalized))) {
            detected.add(rule.capability);
        }
    }

    if (!detected.size) {
        detected.add('chat');
    }

    return MODEL_CAPABILITY_ORDER.filter((capability) => detected.has(capability));
};

export const hasModelCapability = (modelId: string, capability: ModelCapability): boolean => {
    return inferModelCapabilities(modelId).includes(capability);
};

export const normalizeModelCapabilities = (values: Array<ModelCapability | string | null | undefined>): ModelCapability[] => {
    const normalized = new Set<ModelCapability>();
    for (const value of values) {
        const text = String(value || '').trim().toLowerCase();
        if (!text) continue;
        if (MODEL_CAPABILITY_ORDER.includes(text as ModelCapability)) {
            normalized.add(text as ModelCapability);
        }
    }
    return MODEL_CAPABILITY_ORDER.filter((capability) => normalized.has(capability));
};
