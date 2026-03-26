import path from 'node:path';
import fs from 'node:fs/promises';
import { getWorkspacePaths, getUserMemories as getDbUserMemories } from '../db';

export type MemoryType = 'general' | 'preference' | 'fact';

export interface FileUserMemory {
  id: string;
  content: string;
  type: MemoryType;
  tags: string[];
  created_at: number;
  updated_at: number;
  last_accessed?: number;
}

interface MemoryFileData {
  version: number;
  updatedAt: number;
  memories: FileUserMemory[];
}

const MEMORY_DIR = 'memory';
const MEMORY_FILE = 'user-memories.json';
const CURATED_MEMORY_FILE = 'MEMORY.md';
const MAX_MEMORY_ITEMS = 500;

const now = (): number => Date.now();

const normalizeType = (type: unknown): MemoryType => {
  if (type === 'preference' || type === 'fact') return type;
  return 'general';
};

const uniqueTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) return [];
  const set = new Set<string>();
  for (const tag of tags) {
    const value = String(tag || '').trim();
    if (!value) continue;
    set.add(value);
  }
  return Array.from(set);
};

const memoryFilePath = (): string => {
  const base = getWorkspacePaths().base;
  return path.join(base, MEMORY_DIR, MEMORY_FILE);
};

const curatedMemoryFilePath = (): string => {
  const base = getWorkspacePaths().base;
  return path.join(base, MEMORY_DIR, CURATED_MEMORY_FILE);
};

const defaultData = (): MemoryFileData => ({
  version: 1,
  updatedAt: now(),
  memories: [],
});

const ensureDir = async (): Promise<void> => {
  await fs.mkdir(path.dirname(memoryFilePath()), { recursive: true });
};

const formatDateTime = (timestamp: number): string => {
  const date = new Date(Number(timestamp || Date.now()));
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
};

const normalizeContentForDedup = (content: string): string => {
  return content
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
};

const extractMemoryKey = (content: string): string => {
  const text = String(content || '').trim();
  if (!text) return '';

  const delimiters = ['：', ':', '=', '=>', '->', '是', '为'];
  for (const delimiter of delimiters) {
    const idx = text.indexOf(delimiter);
    if (idx > 0 && idx <= 40) {
      return text.slice(0, idx).trim().toLowerCase();
    }
  }

  return '';
};

const memoryWeight = (memory: FileUserMemory): number => {
  if (memory.type === 'preference' || memory.type === 'fact') return 2;
  return 1;
};

const mergeTags = (left: string[], right: string[]): string[] => {
  return uniqueTags([...left, ...right]);
};

const sortMemories = (memories: FileUserMemory[]): FileUserMemory[] => {
  return [...memories].sort((a, b) => {
    const w = memoryWeight(b) - memoryWeight(a);
    if (w !== 0) return w;
    return b.updated_at - a.updated_at;
  });
};

const dedupeAndPruneMemories = (memories: FileUserMemory[]): FileUserMemory[] => {
  const byExact = new Map<string, FileUserMemory>();
  const byKey = new Map<string, FileUserMemory>();

  for (const raw of sortMemories(memories)) {
    const contentNorm = normalizeContentForDedup(raw.content);
    const scopedType = normalizeType(raw.type);
    const key = extractMemoryKey(raw.content);
    const keyBucket = (scopedType === 'fact' || scopedType === 'preference') && key
      ? `${scopedType}::${key}`
      : '';

    const exactHit = contentNorm ? byExact.get(contentNorm) : undefined;
    if (exactHit) {
      exactHit.tags = mergeTags(exactHit.tags, raw.tags);
      exactHit.updated_at = Math.max(exactHit.updated_at, raw.updated_at);
      exactHit.last_accessed = Math.max(exactHit.last_accessed || 0, raw.last_accessed || 0);
      if (exactHit.type === 'general' && scopedType !== 'general') {
        exactHit.type = scopedType;
      }
      if (keyBucket) {
        byKey.set(keyBucket, exactHit);
      }
      continue;
    }

    if (keyBucket && byKey.has(keyBucket)) {
      const keyHit = byKey.get(keyBucket)!;
      keyHit.content = raw.content;
      keyHit.tags = mergeTags(keyHit.tags, raw.tags);
      keyHit.updated_at = Math.max(keyHit.updated_at, raw.updated_at);
      keyHit.last_accessed = Math.max(keyHit.last_accessed || 0, raw.last_accessed || 0);
      if (contentNorm) {
        byExact.set(contentNorm, keyHit);
      }
      continue;
    }

    const next: FileUserMemory = {
      ...raw,
      type: scopedType,
      tags: uniqueTags(raw.tags),
    };
    if (contentNorm) {
      byExact.set(contentNorm, next);
    }
    if (keyBucket) {
      byKey.set(keyBucket, next);
    }
  }

  return sortMemories(Array.from(new Set(byExact.values()))).slice(0, MAX_MEMORY_ITEMS);
};

const buildCuratedMemoryMarkdown = (memories: FileUserMemory[]): string => {
  const selected = sortMemories(memories).slice(0, 120);
  const preference = selected.filter((item) => item.type === 'preference');
  const fact = selected.filter((item) => item.type === 'fact');
  const general = selected.filter((item) => item.type === 'general');

  const renderSection = (title: string, items: FileUserMemory[]): string[] => {
    if (items.length === 0) {
      return [`## ${title}`, '(暂无)'];
    }

    return [
      `## ${title}`,
      ...items.map((item) => {
        const tags = item.tags.length > 0 ? ` [${item.tags.join(', ')}]` : '';
        return `- ${item.content}${tags} (updated: ${formatDateTime(item.updated_at)})`;
      }),
    ];
  };

  return [
    '# MEMORY.md',
    '',
    '这个文件是用户长期记忆摘要（可人工编辑）。',
    '自动生成时间：' + new Date().toISOString(),
    '',
    ...renderSection('偏好 Preferences', preference),
    '',
    ...renderSection('事实 Facts', fact),
    '',
    ...renderSection('其他 General', general),
    '',
    '> 说明：本文件由系统自动维护，同时支持人工调整。若与最新用户明确指令冲突，以最新指令为准。',
  ].join('\n');
};

const syncCuratedMemoryMarkdown = async (memories: FileUserMemory[]): Promise<void> => {
  await ensureDir();
  const filePath = curatedMemoryFilePath();
  const tempPath = `${filePath}.tmp`;
  const markdown = buildCuratedMemoryMarkdown(memories);
  await fs.writeFile(tempPath, markdown, 'utf-8');
  await fs.rename(tempPath, filePath);
};

const readData = async (): Promise<MemoryFileData> => {
  const filePath = memoryFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MemoryFileData>;
    const list = Array.isArray(parsed.memories) ? parsed.memories : [];
    const memories: FileUserMemory[] = list.map((item: any) => ({
      id: String(item.id || `mem_${now()}`),
      content: String(item.content || '').trim(),
      type: normalizeType(item.type),
      tags: uniqueTags(item.tags),
      created_at: Number(item.created_at || now()),
      updated_at: Number(item.updated_at || now()),
      last_accessed: item.last_accessed ? Number(item.last_accessed) : undefined,
    })).filter((m) => m.content.length > 0);

    return {
      version: Number(parsed.version || 1),
      updatedAt: Number(parsed.updatedAt || now()),
      memories: dedupeAndPruneMemories(memories),
    };
  } catch {
    return defaultData();
  }
};

const writeData = async (data: MemoryFileData): Promise<void> => {
  await ensureDir();
  const filePath = memoryFilePath();
  const payload: MemoryFileData = {
    version: 1,
    updatedAt: now(),
    memories: dedupeAndPruneMemories(data.memories),
  };
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
  await fs.rename(tempPath, filePath);
  await syncCuratedMemoryMarkdown(payload.memories);
};

const migrateFromDbIfNeeded = async (): Promise<void> => {
  const filePath = memoryFilePath();
  try {
    await fs.access(filePath);
    return;
  } catch {
    // continue migration
  }

  const dbMemories = getDbUserMemories();
  if (!dbMemories.length) {
    await writeData(defaultData());
    return;
  }

  const migrated: FileUserMemory[] = dbMemories.map((m) => ({
    id: m.id,
    content: m.content,
    type: normalizeType(m.type),
    tags: uniqueTags(m.tags),
    created_at: m.created_at,
    updated_at: m.updated_at,
    last_accessed: m.last_accessed,
  }));
  await writeData({
    version: 1,
    updatedAt: now(),
    memories: migrated,
  });
};

const generateMemoryId = (): string => {
  return `mem_${now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export async function listUserMemoriesFromFile(): Promise<FileUserMemory[]> {
  await migrateFromDbIfNeeded();
  const data = await readData();
  await syncCuratedMemoryMarkdown(data.memories);
  return sortMemories(data.memories);
}

export async function addUserMemoryToFile(
  content: string,
  type: MemoryType = 'general',
  tags: string[] = []
): Promise<FileUserMemory> {
  await migrateFromDbIfNeeded();
  const data = await readData();
  const item: FileUserMemory = {
    id: generateMemoryId(),
    content: String(content || '').trim(),
    type: normalizeType(type),
    tags: uniqueTags(tags),
    created_at: now(),
    updated_at: now(),
    last_accessed: now(),
  };

  if (!item.content) {
    throw new Error('记忆内容不能为空');
  }

  const normalized = normalizeContentForDedup(item.content);
  const key = extractMemoryKey(item.content);
  const exactIndex = normalized
    ? data.memories.findIndex((existing) => normalizeContentForDedup(existing.content) === normalized)
    : -1;

  if (exactIndex >= 0) {
    const existing = data.memories[exactIndex];
    existing.tags = mergeTags(existing.tags, item.tags);
    existing.updated_at = now();
    existing.last_accessed = now();
    if (existing.type === 'general' && item.type !== 'general') {
      existing.type = item.type;
    }
    await writeData(data);
    return existing;
  }

  const canMergeByKey = (item.type === 'preference' || item.type === 'fact') && key.length >= 2;
  if (canMergeByKey) {
    const byKeyIndex = data.memories.findIndex((existing) => {
      if (existing.type !== item.type) return false;
      return extractMemoryKey(existing.content) === key;
    });

    if (byKeyIndex >= 0) {
      const existing = data.memories[byKeyIndex];
      existing.content = item.content;
      existing.tags = mergeTags(existing.tags, item.tags);
      existing.updated_at = now();
      existing.last_accessed = now();
      await writeData(data);
      return existing;
    }
  }

  data.memories.push(item);
  await writeData(data);
  return item;
}

export async function deleteUserMemoryFromFile(id: string): Promise<void> {
  await migrateFromDbIfNeeded();
  const data = await readData();
  data.memories = data.memories.filter((item) => item.id !== id);
  await writeData(data);
}

export async function updateUserMemoryInFile(
  id: string,
  updates: Partial<Pick<FileUserMemory, 'content' | 'type' | 'tags'>>
): Promise<void> {
  await migrateFromDbIfNeeded();
  const data = await readData();
  const idx = data.memories.findIndex((item) => item.id === id);
  if (idx < 0) return;

  const current = data.memories[idx];
  const next: FileUserMemory = {
    ...current,
    content: updates.content !== undefined ? String(updates.content || '').trim() : current.content,
    type: updates.type !== undefined ? normalizeType(updates.type) : current.type,
    tags: updates.tags !== undefined ? uniqueTags(updates.tags) : current.tags,
    updated_at: now(),
  };

  if (!next.content) {
    throw new Error('记忆内容不能为空');
  }

  data.memories[idx] = next;
  await writeData(data);
}

export async function markMemoryAccessed(id: string): Promise<void> {
  await migrateFromDbIfNeeded();
  const data = await readData();
  const item = data.memories.find((m) => m.id === id);
  if (!item) return;
  item.last_accessed = now();
  item.updated_at = now();
  await writeData(data);
}

export async function getLongTermMemoryPrompt(maxItems = 30): Promise<string> {
  const memories = await listUserMemoriesFromFile();
  const curatedMemoryMarkdown = await (async () => {
    try {
      return await fs.readFile(curatedMemoryFilePath(), 'utf-8');
    } catch {
      return '';
    }
  })();
  if (!memories.length && !curatedMemoryMarkdown.trim()) return '';

  const selected = memories.slice(0, Math.max(1, maxItems));
  const listPrompt = selected.map((m, index) => {
    const tagText = m.tags.length ? ` [tags: ${m.tags.join(', ')}]` : '';
    return `${index + 1}. [${m.type}] ${m.content}${tagText}`;
  }).join('\n');

  if (!curatedMemoryMarkdown.trim()) {
    return listPrompt;
  }

  return [
    '<memory_markdown>',
    curatedMemoryMarkdown.slice(0, 16000),
    '</memory_markdown>',
    '',
    '<memory_index>',
    listPrompt,
    '</memory_index>',
  ].join('\n');
}
