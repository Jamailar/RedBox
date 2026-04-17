import { promises as fs } from 'fs';
import * as path from 'path';
import { getWorkspacePaths, listDocumentKnowledgeIndexEntries } from '../db';
import { listDocumentFilesForSource, loadDocumentSources } from './documentKnowledgeStore';
import { toAppAssetUrl } from './localAssetManager';

export interface WanderItem {
  id: string;
  type: 'note' | 'video';
  title: string;
  content: string;
  cover?: string;
  video?: string;
  meta: any;
}

export async function getAllKnowledgeItems(): Promise<WanderItem[]> {
  const paths = getWorkspacePaths();
  const items: WanderItem[] = [];
  const directoryExists = async (targetPath: string) => {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Redbook Notes
  try {
    const redbookDir = paths.knowledgeRedbook;
    if (!(await directoryExists(redbookDir))) {
      console.log('[wander:get-random] redbook directory missing, skipped');
    } else {
      const dirs = await fs.readdir(redbookDir, { withFileTypes: true });

      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        try {
          const metaPath = path.join(redbookDir, dir.name, 'meta.json');
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);

          // Resolve cover image
          let cover = meta.cover;
          if (cover && typeof cover === 'string' && !cover.startsWith('http')) {
               const absolutePath = path.join(redbookDir, dir.name, cover);
               cover = toAppAssetUrl(absolutePath);
          } else if (meta.images && meta.images.length > 0 && typeof meta.images[0] === 'string' && !meta.images[0].startsWith('http')) {
               const absolutePath = path.join(redbookDir, dir.name, meta.images[0]);
               cover = toAppAssetUrl(absolutePath);
          }

          // Resolve video: check images/video.json first, then fall back to any .mp4 in images
          let video: string | undefined;
          if (meta.images) {
            // Priority: images/video.json (structured metadata)
            const videoJsonPath = path.join(redbookDir, dir.name, 'images', 'video.json');
            try {
              const videoJsonContent = await fs.readFile(videoJsonPath, 'utf-8');
              const videoJson = JSON.parse(videoJsonContent);
              if (videoJson && videoJson.url) {
                if (videoJson.url.startsWith('http')) {
                  video = videoJson.url;
                } else {
                  const absolutePath = path.join(redbookDir, dir.name, videoJson.url);
                  video = toAppAssetUrl(absolutePath);
                }
              }
            } catch {
              // video.json not found, fall through to .mp4 scan
            }

            // Fallback: scan images for .mp4
            if (!video) {
              for (const img of meta.images) {
                if (typeof img === 'string' && img.endsWith('.mp4')) {
                  const absolutePath = path.join(redbookDir, dir.name, img);
                  video = toAppAssetUrl(absolutePath);
                  break;
                }
              }
            }
          }

          items.push({
            id: dir.name,
            type: video ? 'video' : 'note',
            title: meta.title || 'Untitled Note',
            content: meta.content || '',
            cover,
            video,
            meta,
          });
        } catch {
          // Ignore invalid notes
        }
      }
    }
  } catch (e) {
    console.error('Error loading Redbook notes:', e);
  }

  // 2. YouTube Videos
  try {
    const youtubeDir = paths.knowledgeYoutube;
    if (!(await directoryExists(youtubeDir))) {
      console.log('[wander:get-random] youtube directory missing, skipped');
    } else {
      const dirs = await fs.readdir(youtubeDir, { withFileTypes: true });

      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        try {
          const metaPath = path.join(youtubeDir, dir.name, 'meta.json');
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);

          // Resolve thumbnail
          let cover = meta.thumbnail || meta.thumbnailUrl;
          if (meta.thumbnail && !meta.thumbnail.startsWith('http')) {
               const absolutePath = path.join(youtubeDir, dir.name, meta.thumbnail);
               cover = toAppAssetUrl(absolutePath);
          }

          // Get transcript if available
          let content = meta.description || '';
          if (meta.transcriptFile) {
              try {
                  const transcriptPath = path.join(youtubeDir, dir.name, meta.transcriptFile);
                  content = await fs.readFile(transcriptPath, 'utf-8');
              } catch {}
          } else if (meta.transcript) {
              content = meta.transcript;
          }

          items.push({
            id: dir.name,
            type: 'video',
            title: meta.title || 'Untitled Video',
            content: content,
            cover,
            meta,
          });
        } catch {
          // Ignore invalid videos
        }
      }
    }
  } catch (e) {
    console.error('Error loading YouTube videos:', e);
  }

  // 3. Document Knowledge (copied files/folders + Obsidian vault)
  try {
    const paths = getWorkspacePaths();
    const sources = await loadDocumentSources(paths);
    for (const source of sources) {
      let files = listDocumentKnowledgeIndexEntries(source.id, 120).map((entry) => ({
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        absolutePath: entry.absolutePath,
        relativePath: entry.relativePath,
        indexedTitle: entry.title || '',
      }));

      if (!files.length) {
        const scanned = await listDocumentFilesForSource(source, { maxFiles: 120 });
        files = scanned.map((entry) => ({
          ...entry,
          indexedTitle: '',
        }));
      }

      for (const file of files) {
        try {
          const raw = await fs.readFile(file.absolutePath, 'utf-8');
          const content = String(raw || '').trim();
          if (!content) continue;

          const headingMatch = content.match(/^#\s+(.+)$/m);
          const fallbackTitle = path.basename(file.relativePath, path.extname(file.relativePath));
          const title = (file.indexedTitle || headingMatch?.[1] || fallbackTitle || file.sourceName || 'Untitled Document').trim();

          const sourceIdSafe = file.sourceId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const relSafe = file.relativePath.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-120);

          items.push({
            id: `doc_${sourceIdSafe}_${relSafe}`,
            // 兼容现有 Wander 前端逻辑：文档按 note 类型展示
            type: 'note',
            title,
            content: content.slice(0, 12000),
            meta: {
              sourceType: 'document',
              sourceId: file.sourceId,
              sourceName: file.sourceName,
              sourceKind: file.sourceKind,
              filePath: file.absolutePath,
              relativePath: file.relativePath,
            },
          });
        } catch {
          // Ignore unreadable files
        }
      }
    }
  } catch (e) {
    console.error('Error loading document knowledge:', e);
  }

  return items;
}
