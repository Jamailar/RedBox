import { promises as fs } from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { getWorkspacePaths } from '../db';

export interface WanderItem {
  id: string;
  type: 'note' | 'video';
  title: string;
  content: string;
  cover?: string;
  meta: any;
}

export async function getAllKnowledgeItems(): Promise<WanderItem[]> {
  const paths = getWorkspacePaths();
  const items: WanderItem[] = [];

  // 1. Redbook Notes
  try {
    const redbookDir = paths.knowledgeRedbook;
    // Check if directory exists
    try {
        await fs.access(redbookDir);
    } catch {
        // Directory doesn't exist, skip
        return items;
    }

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
             cover = pathToFileURL(absolutePath).toString().replace('file://', 'local-file://');
        } else if (meta.images && meta.images.length > 0 && typeof meta.images[0] === 'string' && !meta.images[0].startsWith('http')) {
             const absolutePath = path.join(redbookDir, dir.name, meta.images[0]);
             cover = pathToFileURL(absolutePath).toString().replace('file://', 'local-file://');
        }

        items.push({
          id: dir.name,
          type: 'note',
          title: meta.title || 'Untitled Note',
          content: meta.content || '',
          cover,
          meta
        });
      } catch (e) {
        // Ignore invalid notes
      }
    }
  } catch (e) {
    console.error('Error loading Redbook notes:', e);
  }

  // 2. YouTube Videos
  try {
    const youtubeDir = paths.knowledgeYoutube;
    try {
        await fs.access(youtubeDir);
    } catch {
        return items;
    }

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
             cover = pathToFileURL(absolutePath).toString().replace('file://', 'local-file://');
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
          meta
        });
      } catch (e) {
        // Ignore invalid videos
      }
    }
  } catch (e) {
    console.error('Error loading YouTube videos:', e);
  }

  return items;
}
