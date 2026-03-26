import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { getWorkspacePaths } from '../db';

export type MediaAssetSource = 'generated' | 'planned' | 'imported';

export interface MediaAsset {
  id: string;
  source: MediaAssetSource;
  projectId?: string;
  title?: string;
  prompt?: string;
  provider?: string;
  providerTemplate?: string;
  model?: string;
  aspectRatio?: string;
  size?: string;
  quality?: string;
  mimeType?: string;
  relativePath?: string;
  boundManuscriptPath?: string;
  createdAt: string;
  updatedAt: string;
}

interface MediaCatalog {
  version: 1;
  assets: MediaAsset[];
}

const DEFAULT_CATALOG: MediaCatalog = {
  version: 1,
  assets: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ');
}

function normalizePathForStore(input: string): string {
  return input.replace(/\\/g, '/');
}

function getMediaRootDir(): string {
  const paths = getWorkspacePaths() as ReturnType<typeof getWorkspacePaths> & { media?: string };
  return paths.media || path.join(paths.base, 'media');
}

function getCatalogPath(): string {
  return path.join(getMediaRootDir(), 'catalog.json');
}

function getGeneratedDir(): string {
  return path.join(getMediaRootDir(), 'generated');
}

async function ensureMediaDirs(): Promise<void> {
  await fs.mkdir(getMediaRootDir(), { recursive: true });
  await fs.mkdir(getGeneratedDir(), { recursive: true });
}

async function readCatalog(): Promise<MediaCatalog> {
  await ensureMediaDirs();
  try {
    const raw = await fs.readFile(getCatalogPath(), 'utf-8');
    const parsed = JSON.parse(raw) as MediaCatalog;
    if (parsed && Array.isArray(parsed.assets)) {
      return {
        version: 1,
        assets: parsed.assets,
      };
    }
    return DEFAULT_CATALOG;
  } catch {
    return DEFAULT_CATALOG;
  }
}

async function writeCatalog(catalog: MediaCatalog): Promise<void> {
  await ensureMediaDirs();
  await fs.writeFile(getCatalogPath(), JSON.stringify(catalog, null, 2), 'utf-8');
}

function extByMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'png';
}

async function updateManuscriptBinding(manuscriptPath: string, asset: MediaAsset): Promise<void> {
  const manuscriptsRoot = getWorkspacePaths().manuscripts;
  const normalized = normalizePathForStore(manuscriptPath);
  const absolutePath = path.join(manuscriptsRoot, normalized);
  const raw = await fs.readFile(absolutePath, 'utf-8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const current = Array.isArray(data.boundMedia) ? data.boundMedia : [];
  const filtered = current.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const id = (item as Record<string, unknown>).assetId;
    return id !== asset.id;
  });
  filtered.push({
    assetId: asset.id,
    mediaPath: asset.relativePath || '',
    source: asset.source,
    boundAt: nowIso(),
  });
  data.boundMedia = filtered;
  data.updatedAt = Date.now();
  const next = matter.stringify(parsed.content, data);
  await fs.writeFile(absolutePath, next, 'utf-8');
}

export async function listMediaAssets(limit = 200): Promise<MediaAsset[]> {
  const catalog = await readCatalog();
  const sorted = [...catalog.assets].sort((a, b) => {
    const at = new Date(a.updatedAt).getTime();
    const bt = new Date(b.updatedAt).getTime();
    return bt - at;
  });
  return sorted.slice(0, Math.max(1, limit));
}

export async function createGeneratedMediaAsset(input: {
  prompt: string;
  imageBuffer: Buffer;
  mimeType?: string;
  projectId?: string;
  provider?: string;
  providerTemplate?: string;
  model?: string;
  aspectRatio?: string;
  size?: string;
  quality?: string;
  title?: string;
}): Promise<MediaAsset> {
  await ensureMediaDirs();
  const catalog = await readCatalog();
  const mimeType = (input.mimeType || 'image/png').toLowerCase();
  const ext = extByMime(mimeType);
  const id = `media_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const fileName = `${id}.${ext}`;
  const relativePath = normalizePathForStore(path.join('generated', fileName));
  const absolutePath = path.join(getMediaRootDir(), relativePath);
  await fs.writeFile(absolutePath, input.imageBuffer);

  const asset: MediaAsset = {
    id,
    source: 'generated',
    projectId: input.projectId,
    title: input.title?.trim() || undefined,
    prompt: normalizePrompt(input.prompt),
    provider: input.provider?.trim() || undefined,
    providerTemplate: input.providerTemplate?.trim() || undefined,
    model: input.model?.trim() || undefined,
    aspectRatio: input.aspectRatio?.trim() || undefined,
    size: input.size?.trim() || undefined,
    quality: input.quality?.trim() || undefined,
    mimeType,
    relativePath,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  catalog.assets.push(asset);
  await writeCatalog(catalog);
  return asset;
}

export async function ensurePlannedMediaAssetsForProject(input: {
  projectId: string;
  prompts: string[];
  coverPrompt?: string;
  model?: string;
}): Promise<MediaAsset[]> {
  const normalizedPrompts = Array.from(
    new Set(
      [
        ...(input.coverPrompt ? [input.coverPrompt] : []),
        ...input.prompts,
      ]
        .map((item) => normalizePrompt(item))
        .filter(Boolean)
    )
  );

  if (normalizedPrompts.length === 0) {
    return [];
  }

  const catalog = await readCatalog();
  const created: MediaAsset[] = [];

  for (const prompt of normalizedPrompts) {
    const exists = catalog.assets.find((asset) =>
      asset.source === 'planned' &&
      asset.projectId === input.projectId &&
      normalizePrompt(asset.prompt || '') === prompt
    );

    if (exists) {
      continue;
    }

    const asset: MediaAsset = {
      id: `media_plan_${Date.now()}_${randomUUID().slice(0, 8)}`,
      source: 'planned',
      projectId: input.projectId,
      prompt,
      model: input.model?.trim() || undefined,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    catalog.assets.push(asset);
    created.push(asset);
  }

  if (created.length > 0) {
    await writeCatalog(catalog);
  }

  return created;
}

export async function bindMediaAssetToManuscript(input: {
  assetId: string;
  manuscriptPath: string;
}): Promise<MediaAsset> {
  const catalog = await readCatalog();
  const asset = catalog.assets.find((item) => item.id === input.assetId);
  if (!asset) {
    throw new Error('Media asset not found');
  }

  const boundPath = normalizePathForStore(input.manuscriptPath);
  asset.boundManuscriptPath = boundPath;
  asset.updatedAt = nowIso();
  await writeCatalog(catalog);

  if (asset.relativePath) {
    await updateManuscriptBinding(boundPath, asset);
  }

  return asset;
}

export async function updateMediaAssetMetadata(input: {
  assetId: string;
  projectId?: string;
  title?: string;
  prompt?: string;
}): Promise<MediaAsset> {
  const catalog = await readCatalog();
  const asset = catalog.assets.find((item) => item.id === input.assetId);
  if (!asset) {
    throw new Error('Media asset not found');
  }

  if (typeof input.projectId === 'string') asset.projectId = input.projectId || undefined;
  if (typeof input.title === 'string') asset.title = input.title.trim() || undefined;
  if (typeof input.prompt === 'string') asset.prompt = normalizePrompt(input.prompt);
  asset.updatedAt = nowIso();
  await writeCatalog(catalog);
  return asset;
}

export function getAbsoluteMediaPath(relativePath: string): string {
  return path.join(getMediaRootDir(), normalizePathForStore(relativePath));
}
