import { app, BrowserWindow, ipcMain, protocol, nativeImage, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  saveSettings,
  getSettings,
  getWorkspacePaths,
  getWorkspacePathsForSpace,
  getActiveSpaceId,
  listSpaces,
  createSpace,
  renameSpace,
  setActiveSpace,
  listArchiveProfiles,
  createArchiveProfile,
  updateArchiveProfile,
  deleteArchiveProfile,
  listArchiveSamples,
  createArchiveSample,
  updateArchiveSample,
  deleteArchiveSample,
  getChatSessionByFile,
  getChatSessionByFileId,
  getChatSession,
  updateChatSessionMetadata,
  createChatSession,
  getChatSessions,
  getChatMessages,
  addChatMessage,
  deleteChatSession,
  clearChatMessages,
  updateChatSessionTitle,
  getChatSessionByContext,
} from './db'
import { indexManager } from './core/IndexManager'
import { embeddingService } from './core/vector/EmbeddingService'
import { normalizeNote, normalizeVideo, normalizeFile, normalizeArchiveSample } from './core/normalization'
import {
  createAgentExecutor,
  AgentExecutor,
  type AgentConfig,
  getAllKnowledgeItems
} from './core'
import { WANDER_BRAINSTORM_PROMPT } from './prompts'
import { fileWatcher } from './core/FileWatcherService'
import matter from 'gray-matter'
import { ulid } from 'ulid'
import { SkillManager } from './core/skillManager';
import {
  listUserMemoriesFromFile,
  addUserMemoryToFile,
  deleteUserMemoryFromFile,
  updateUserMemoryInFile,
} from './core/fileMemoryStore';
import { getRedClawProject, listRedClawProjects } from './core/redclawStore';
import {
  listMediaAssets,
  bindMediaAssetToManuscript,
  updateMediaAssetMetadata,
  getAbsoluteMediaPath,
  type MediaAsset,
} from './core/mediaLibraryStore';
import { generateImagesToMediaLibrary } from './core/imageGenerationService';
import { getRedClawBackgroundRunner } from './core/redclawBackgroundRunner';

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
let redClawRunnerListenersAttached = false;

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'redbox.png');
  const devIconPath = path.join(process.cwd(), 'desktop', 'redbox.png');
  const resolvedIconPath = app.isPackaged ? iconPath : devIconPath;

  win = new BrowserWindow({
    icon: resolvedIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
    width: 1200,
    height: 800,
    backgroundColor: '#FFFFFF',

  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const distDir = process.env.DIST || path.join(__dirname, '../dist');
    win.loadFile(path.join(distDir, 'index.html'))
  }

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(resolvedIconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }
}

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    try {
      const keepAlive = await getRedClawBackgroundRunner().shouldKeepAliveWhenNoWindow();
      if (keepAlive) {
        console.log('[RedClawRunner] Keep app alive in background (no window).');
        win = null;
        return;
      }
    } catch (error) {
      console.warn('[RedClawRunner] keep-alive check failed:', error);
    }
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const targetUrl = String(url || '').trim();
    const isHttpUrl = /^https?:\/\//i.test(targetUrl);

    if (contents.getType() === 'webview') {
      const hostContents = (contents as unknown as { hostWebContents?: Electron.WebContents }).hostWebContents;
      if (isHttpUrl) {
        hostContents?.send('xhs:open-in-tab', { url: targetUrl });
      }
      return { action: 'deny' };
    }

    if (isHttpUrl) {
      void shell.openExternal(targetUrl);
    }

    return { action: 'deny' };
  });
});

const registerLocalFileProtocol = () => {
  protocol.registerFileProtocol('local-file', (request, callback) => {
    const url = request.url.replace('local-file://', '');
    const decodedPath = decodeURIComponent(url);
    const normalizedPath = path.normalize(decodedPath);
    const baseDir = path.normalize(getWorkspacePaths().base);

    if (!normalizedPath.startsWith(baseDir)) {
      callback({ error: -10 });
      return;
    }

    callback({ path: normalizedPath });
  });
};

async function ensureWorkspaceStructureFor(paths: ReturnType<typeof getWorkspacePaths>) {
  const fs = require('fs/promises');
  const dirs = [
    paths.base,
    paths.skills,
    paths.knowledgeRedbook,
    paths.knowledgeYoutube,
    paths.advisors,
    paths.manuscripts,
    paths.media,
    paths.redclaw,
    path.join(paths.base, 'archives'),
    path.join(paths.base, 'chatrooms'),
  ];
  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
}

function toLocalFileUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).toString().replace('file://', 'local-file://');
}

function normalizeRelativePath(input: string): string {
  const normalized = path.normalize(String(input || '')).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('Invalid relative path');
  }
  if (normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Path traversal is not allowed');
  }
  return normalized;
}

async function enrichMediaAsset(asset: MediaAsset): Promise<MediaAsset & { absolutePath?: string; previewUrl?: string; exists: boolean }> {
  if (!asset.relativePath) {
    return { ...asset, exists: false };
  }
  const absolutePath = getAbsoluteMediaPath(asset.relativePath);
  try {
    await fs.access(absolutePath);
    return {
      ...asset,
      absolutePath,
      previewUrl: toLocalFileUrl(absolutePath),
      exists: true,
    };
  } catch {
    return {
      ...asset,
      absolutePath,
      exists: false,
    };
  }
}

async function refreshForSpaceChange() {
  clearAllChatServices();
  fileWatcher.stop();
  fileWatcher.start();
  indexManager.clearQueue();

  const { vectorStore } = await import('./core/vector/VectorStore');
  await vectorStore.refreshCache();
  await getRedClawBackgroundRunner().reloadForWorkspaceChange();

  win?.webContents.send('space:changed', { activeSpaceId: getActiveSpaceId() });
}

async function initializeRedClawBackgroundRunner() {
  const runner = getRedClawBackgroundRunner();
  if (!redClawRunnerListenersAttached) {
    runner.on('status', (status) => {
      win?.webContents.send('redclaw:runner-status', status);
    });
    runner.on('log', (log) => {
      win?.webContents.send('redclaw:runner-log', log);
    });
    redClawRunnerListenersAttached = true;
  }
  await runner.init();
}

app.whenReady().then(async () => {
  registerLocalFileProtocol();
  try {
    await ensureWorkspaceStructureFor(getWorkspacePaths());
  } catch (e) {
    console.error('[Workspace] Failed to ensure workspace structure:', e);
  }
  await initializeRedClawBackgroundRunner();
  createWindow();

  // 初始化任务队列并启动后台服务
  initializeTaskQueueWithExecutors();

  // 启动文件监听服务
  fileWatcher.start();

  // 自动检查并安装/更新 yt-dlp（静默后台执行）
  import('./core/youtubeScraper').then(({ autoSetupYtdlp }) => {
    autoSetupYtdlp().then(result => {
      if (result.action !== 'none') {
        console.log(`[App] yt-dlp auto setup: ${result.action} - ${result.message}`);
      }
    }).catch(e => {
      console.error('[App] yt-dlp auto setup error:', e);
    });
  });

});

// ========== 任务队列管理 ==========
import { getTaskQueue, initializeTaskQueue, type Task } from './core/taskQueue';

function initializeTaskQueueWithExecutors() {
  const queue = initializeTaskQueue();

  // 注册字幕下载执行器
  queue.registerExecutor('subtitle_download', async (task, onProgress) => {
    const { queueSubtitleDownload } = await import('./core/subtitleQueue');
    const data = task.data as { videoId: string; outputDir: string };

    onProgress(0, 1, `下载字幕: ${data.videoId}`);
    const result = await queueSubtitleDownload(data.videoId, data.outputDir);
    onProgress(1, 1, result.success ? '下载完成' : '下载失败');

    return result;
  });

  // 转发任务事件到前端
  queue.on('task:started', (task: Task) => {
    win?.webContents.send('task-queue:task-started', task);
  });

  queue.on('task:progress', (task: Task) => {
    win?.webContents.send('task-queue:task-progress', task);
  });

  queue.on('task:completed', (task: Task) => {
    win?.webContents.send('task-queue:task-completed', task);
  });

  queue.on('task:failed', (task: Task) => {
    win?.webContents.send('task-queue:task-failed', task);
  });

  console.log('[TaskQueue] Executors registered');
}

// --------- IPC Handlers ---------

// Database
ipcMain.handle('db:save-settings', (_, settings) => {
  return saveSettings(settings)
})

ipcMain.handle('db:get-settings', () => {
  return getSettings()
})

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('spaces:list', async () => {
  return {
    spaces: listSpaces(),
    activeSpaceId: getActiveSpaceId(),
  };
});

ipcMain.handle('spaces:create', async (_, name: string) => {
  const space = createSpace(name || '');
  await ensureWorkspaceStructureFor(getWorkspacePathsForSpace(space.id));
  return { success: true, space };
});

ipcMain.handle('spaces:rename', async (_, { id, name }: { id: string; name: string }) => {
  const space = renameSpace(id, name);
  if (!space) {
    return { success: false, error: '空间不存在或名称无效' };
  }
  return { success: true, space };
});

ipcMain.handle('spaces:switch', async (_, spaceId: string) => {
  const space = setActiveSpace(spaceId);
  await ensureWorkspaceStructureFor(getWorkspacePaths());
  await refreshForSpaceChange();
  return { success: true, space };
});

// Memory
ipcMain.handle('memory:list', async () => {
  return listUserMemoriesFromFile();
});

ipcMain.handle('memory:add', async (_, { content, type, tags }) => {
  return addUserMemoryToFile(content, type, tags);
});

ipcMain.handle('memory:delete', async (_, id) => {
  return deleteUserMemoryFromFile(id);
});

ipcMain.handle('memory:update', async (_, { id, updates }) => {
  return updateUserMemoryInFile(id, updates);
});

// Fetch Models
ipcMain.handle('ai:fetch-models', async (_, { apiKey, baseURL }) => {
  try {
    const url = `${baseURL}/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json();
    // Support OpenAI format { data: [{ id: 'model-id' }] }
    return data.data || [];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
});

// AI Chat - 使用 pi-agent-core 引擎
import { PiChatService } from './pi/PiChatService';

// 会话级 ChatService 实例管理（保证切换 tab/并行会话时不中断）
const chatServices = new Map<string, PiChatService>();

function getOrCreateChatService(sessionId: string, sender?: Electron.WebContents): PiChatService {
  let service = chatServices.get(sessionId);
  if (!service) {
    service = new PiChatService();
    chatServices.set(sessionId, service);
  }
  if (sender) {
    const browserWindow = BrowserWindow.fromWebContents(sender);
    if (browserWindow) {
      service.setWindow(browserWindow);
    }
  }
  return service;
}

function cleanupChatService(sessionId: string): void {
  const service = chatServices.get(sessionId);
  if (!service) return;
  try {
    service.abort();
  } catch {
    // ignore
  }
  chatServices.delete(sessionId);
}

function clearAllChatServices(): void {
  for (const [sessionId] of chatServices) {
    cleanupChatService(sessionId);
  }
}

// 创建新的聊天会话
ipcMain.handle('chat:create-session', async (_, title?: string) => {
  const sessionId = `session_${Date.now()}`;
  const defaultTitle = title || 'New Chat';

  createChatSession(sessionId, defaultTitle);
  return { id: sessionId, title: defaultTitle, timestamp: Date.now() };
});

// 获取或创建文件关联的会话
ipcMain.handle('chat:getOrCreateFileSession', async (_, { filePath, fileId }: { filePath: string; fileId?: string }) => {
  if (!filePath) return null;

  // 1. 优先尝试通过 ID 查找 (更精准，防改名)
  if (fileId) {
    const sessionById = getChatSessionByFileId(fileId);
    if (sessionById) {
      // 检查路径是否变化 (例如文件被重命名)
      // 如果路径变了，更新元数据中的 path，确保 Agent 能找到最新文件
      try {
        const meta = JSON.parse(sessionById.metadata || '{}');
        if (meta.associatedFilePath !== filePath) {
          meta.associatedFilePath = filePath;
          updateChatSessionMetadata(sessionById.id, meta);
          // Update local object to return correct data
          sessionById.metadata = JSON.stringify(meta);
        }
      } catch (e) {
        console.error('Failed to update session path:', e);
      }
      return sessionById;
    }
  }

  // 2. 如果没有 ID 或通过 ID 没找到 (兼容旧数据)，尝试通过路径查找
  const existingSession = getChatSessionByFile(filePath);
  if (existingSession) {
    // 如果找到了旧会话但现在有了 ID，补全 ID 信息
    if (fileId) {
       try {
        const meta = JSON.parse(existingSession.metadata || '{}');
        if (!meta.associatedFileId) {
          meta.associatedFileId = fileId;
          updateChatSessionMetadata(existingSession.id, meta);
          existingSession.metadata = JSON.stringify(meta);
        }
      } catch (e) {
        console.error('Failed to migrate session ID:', e);
      }
    }
    return existingSession;
  }

  // 3. 创建新会话
  const sessionId = `session_${Date.now()}`;
  const fileName = path.basename(filePath);
  const title = `Manuscript: ${fileName}`;
  const metadata = {
    associatedFilePath: filePath,
    associatedFileId: fileId // Store UUID if available
  };

  createChatSession(sessionId, title, metadata);
  return { id: sessionId, title, timestamp: Date.now(), metadata: JSON.stringify(metadata) };
});

// 获取或创建上下文关联的会话 (知识库聊天)
ipcMain.handle('chat:getOrCreateContextSession', async (_, { contextId, contextType, title, initialContext }: { contextId: string; contextType: string; title: string; initialContext: string }) => {
  if (!contextId || !contextType) return null;

  // 1. 尝试查找现有会话
  const existingSession = getChatSessionByContext(contextId, contextType);

  if (existingSession) {
    // 更新上下文内容 (确保 Agent 拿到最新的知识库内容)
    try {
      const meta = JSON.parse(existingSession.metadata || '{}');
      if (meta.contextContent !== initialContext) {
        meta.contextContent = initialContext;
        updateChatSessionMetadata(existingSession.id, meta);
        existingSession.metadata = JSON.stringify(meta);
      }
    } catch (e) {
      console.error('Failed to update session context:', e);
    }
    return existingSession;
  }

  // 2. 创建新会话
  const sessionId = `session_${Date.now()}`;
  const metadata = {
    contextId,
    contextType,
    contextContent: initialContext, // 存储初始上下文内容
    isContextBound: true
  };

  createChatSession(sessionId, title, metadata);
  return { id: sessionId, title, timestamp: Date.now(), metadata: JSON.stringify(metadata) };
});

ipcMain.handle('redclaw:list-projects', async (_, { limit }: { limit?: number } = {}) => {
  try {
    return await listRedClawProjects(limit || 20);
  } catch (error) {
    console.error('Failed to list RedClaw projects:', error);
    return [];
  }
});

ipcMain.handle('redclaw:get-project', async (_, { projectId }: { projectId: string }) => {
  try {
    if (!projectId) {
      return { success: false, error: 'projectId is required' };
    }
    const detail = await getRedClawProject(projectId);
    return { success: true, ...detail };
  } catch (error) {
    console.error('Failed to get RedClaw project:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('redclaw:open-project', async (_, { projectDir }: { projectDir: string }) => {
  try {
    if (!projectDir) {
      return { success: false, error: 'projectDir is required' };
    }
    const openError = await shell.openPath(projectDir);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to open RedClaw project:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('redclaw:runner-status', async () => {
  return getRedClawBackgroundRunner().getStatus();
});

ipcMain.handle('redclaw:runner-start', async (_, payload: {
  intervalMinutes?: number;
  keepAliveWhenNoWindow?: boolean;
  maxProjectsPerTick?: number;
} = {}) => {
  try {
    return await getRedClawBackgroundRunner().start(payload);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('redclaw:runner-stop', async () => {
  try {
    return await getRedClawBackgroundRunner().stop();
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('redclaw:runner-run-now', async (_, payload: { projectId?: string } = {}) => {
  try {
    return await getRedClawBackgroundRunner().runNow(payload.projectId);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('redclaw:runner-set-project', async (_, payload: {
  projectId: string;
  enabled: boolean;
  prompt?: string;
}) => {
  try {
    return await getRedClawBackgroundRunner().setProjectState(payload);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('redclaw:runner-set-config', async (_, payload: {
  intervalMinutes?: number;
  keepAliveWhenNoWindow?: boolean;
  maxProjectsPerTick?: number;
} = {}) => {
  try {
    return await getRedClawBackgroundRunner().setRunnerConfig(payload);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('media:list', async (_, { limit }: { limit?: number } = {}) => {
  try {
    const assets = await listMediaAssets(limit || 300);
    const enriched = await Promise.all(assets.map((asset) => enrichMediaAsset(asset)));
    return { success: true, assets: enriched };
  } catch (error) {
    console.error('Failed to list media assets:', error);
    return { success: false, error: String(error), assets: [] };
  }
});

ipcMain.handle('media:update', async (_, payload: { assetId: string; projectId?: string; title?: string; prompt?: string }) => {
  try {
    if (!payload?.assetId) {
      return { success: false, error: 'assetId is required' };
    }
    const updated = await updateMediaAssetMetadata(payload);
    return { success: true, asset: await enrichMediaAsset(updated) };
  } catch (error) {
    console.error('Failed to update media asset:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('media:bind', async (_, { assetId, manuscriptPath }: { assetId: string; manuscriptPath: string }) => {
  try {
    if (!assetId || !manuscriptPath) {
      return { success: false, error: 'assetId and manuscriptPath are required' };
    }
    const normalizedManuscriptPath = normalizeRelativePath(manuscriptPath);
    const absoluteManuscriptPath = path.join(getWorkspacePaths().manuscripts, normalizedManuscriptPath);
    await fs.access(absoluteManuscriptPath);
    const updated = await bindMediaAssetToManuscript({
      assetId,
      manuscriptPath: normalizedManuscriptPath,
    });
    return { success: true, asset: await enrichMediaAsset(updated) };
  } catch (error) {
    console.error('Failed to bind media asset:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('media:open', async (_, { assetId }: { assetId: string }) => {
  try {
    if (!assetId) {
      return { success: false, error: 'assetId is required' };
    }
    const assets = await listMediaAssets(5000);
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) {
      return { success: false, error: 'Media asset not found' };
    }

    const targetPath = asset.relativePath
      ? getAbsoluteMediaPath(asset.relativePath)
      : getWorkspacePaths().media;
    const openError = await shell.openPath(targetPath);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to open media asset:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('media:open-root', async () => {
  try {
    const openError = await shell.openPath(getWorkspacePaths().media);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to open media library root:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('image-gen:generate', async (_, {
  prompt,
  projectId,
  title,
  count,
  size,
  quality,
  model,
}: {
  prompt: string;
  projectId?: string;
  title?: string;
  count?: number;
  size?: string;
  quality?: string;
  model?: string;
}) => {
  try {
    const result = await generateImagesToMediaLibrary({
      prompt,
      projectId,
      title,
      count,
      size,
      quality,
      model,
    });
    const assets = await Promise.all(result.assets.map((asset) => enrichMediaAsset(asset)));
    return { success: true, assets };
  } catch (error) {
    console.error('Failed to generate images:', error);
    return { success: false, error: String(error) };
  }
});

// 获取所有会话
ipcMain.handle('chat:get-sessions', async () => {
  return getChatSessions();
});

// 删除会话
ipcMain.handle('chat:delete-session', async (_, sessionId: string) => {
  deleteChatSession(sessionId);
  cleanupChatService(sessionId);
  return { success: true };
});

// 获取会话消息
ipcMain.handle('chat:get-messages', async (_, sessionId: string) => {
  return getChatMessages(sessionId);
});

// 清空会话消息
ipcMain.handle('chat:clear-messages', async (_, sessionId: string) => {
  clearChatMessages(sessionId);
  const session = getChatSession(sessionId);
  if (session?.metadata) {
    try {
      const metadata = JSON.parse(session.metadata);
      delete metadata.compactSummary;
      delete metadata.compactBaseMessageCount;
      delete metadata.compactRounds;
      delete metadata.compactUpdatedAt;
      updateChatSessionMetadata(sessionId, metadata);
    } catch (error) {
      console.warn('[chat:clear-messages] Failed to clear compact metadata:', error);
    }
  }
  const service = chatServices.get(sessionId);
  if (service) {
    service.clearHistory();
  }
  return { success: true };
});

ipcMain.handle('chat:compact-context', async (event, sessionId: string) => {
  if (!sessionId) {
    return { success: false, compacted: false, message: 'sessionId is required' };
  }

  try {
    const service = getOrCreateChatService(sessionId, event.sender);
    return await service.compactContextNow(sessionId);
  } catch (error) {
    console.error('[chat:compact-context] Failed:', error);
    return { success: false, compacted: false, message: String(error) };
  }
});

// 自动生成聊天标题
ipcMain.handle('chat:generate-title', async (_, { sessionId, message }) => {
    // TODO: Implement title generation with new engine
    return message.substring(0, 30);
});

// 开始聊天（使用 ChatServiceV2）
ipcMain.on('chat:send-message', async (event, { sessionId, message, displayContent, attachment, modelConfig }) => {
  const sender = event.sender;
  const settings = (getSettings() || {}) as Record<string, unknown>;
  console.log('[chat:send-message] incoming', {
    sessionId: sessionId || null,
    messageLength: typeof message === 'string' ? message.length : 0,
    hasAttachment: Boolean(attachment),
    modelFromSettings: settings.model_name || null,
  });

  // 如果没有 sessionId，创建新会话
  if (!sessionId) {
    sessionId = `session_${Date.now()}`;

    createChatSession(sessionId, 'New Chat');
    sender.send('chat:session-created', { sessionId });
  }

  // 保存用户消息到数据库
  const userMsgId = `msg_${Date.now()}`;
  addChatMessage({
    id: userMsgId,
    session_id: sessionId,
    role: 'user',
    content: message,
    display_content: displayContent || undefined,
    attachment: attachment ? JSON.stringify(attachment) : undefined,
  });

  try {
    const service = getOrCreateChatService(sessionId, sender);

    // 发送消息
    await service.sendMessage(message, sessionId);
    console.log('[chat:send-message] completed', { sessionId });

  } catch (err: unknown) {
    console.error('ChatV2 Error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Unknown error occurred';
    sender.send('chat:error', { message: errorMsg });
  }
});

// 取消执行
ipcMain.on('chat:cancel', (_, payload?: { sessionId?: string } | string) => {
    const sessionId = typeof payload === 'string'
      ? payload
      : payload?.sessionId;

    if (sessionId) {
      const service = chatServices.get(sessionId);
      if (service) {
        service.abort();
      }
      return;
    }

    for (const service of chatServices.values()) {
      service.abort();
    }
});

// ========== 保留旧的 ai:start-chat 以兼容旧 UI ==========
let currentAgent: AgentExecutor | null = null;

ipcMain.on('ai:start-chat', async (event, message, modelConfig) => {
  const sender = event.sender

  const settings = (getSettings() || {}) as Record<string, unknown>

  const config: AgentConfig = {
    apiKey: (modelConfig?.apiKey || settings.api_key || '') as string,
    baseURL: (modelConfig?.baseURL || settings.api_endpoint || '') as string,
    model: (modelConfig?.modelName || settings.model_name || '') as string,
    projectRoot: process.cwd(),
    maxTurns: 20,
    maxTimeMinutes: 10,
    temperature: 0.7,
  }

  if (!config.apiKey) {
    sender.send('ai:error', 'API Key is missing. Please configure it in Settings.')
    return
  }

  if (!config.model) {
    sender.send('ai:error', 'Model Name is missing. Please configure a default model in Settings.')
    return
  }

  try {
    currentAgent = await createAgentExecutor(config, (agentEvent) => {
      switch (agentEvent.type) {
        case 'thinking':
          sender.send('ai:stream-event', { type: 'stage_start', data: { stage: 'thinking', content: agentEvent.content } })
          break
        case 'tool_start':
          sender.send('ai:stream-event', { type: 'tool_start', data: { callId: agentEvent.callId, name: agentEvent.name, input: agentEvent.params, description: agentEvent.description } })
          break
        case 'tool_end':
          sender.send('ai:stream-event', { type: 'tool_end', data: { callId: agentEvent.callId, name: agentEvent.name, output: agentEvent.result } })
          break
        case 'tool_confirm_request':
          sender.send('ai:tool-confirm-request', { callId: agentEvent.callId, name: agentEvent.name, details: agentEvent.details })
          break
        case 'response_chunk':
          sender.send('ai:stream-event', { type: 'token_stream', data: { content: agentEvent.content } })
          break
        case 'skill_activated':
          sender.send('ai:stream-event', { type: 'skill_activated', data: { name: agentEvent.name, description: agentEvent.description } })
          break
        case 'error':
          sender.send('ai:error', agentEvent.message)
          break
        case 'done':
          sender.send('ai:stream-end')
          break
      }
    })
    await currentAgent.run(message)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error occurred';
    sender.send('ai:error', message)
  } finally {
    currentAgent = null
  }
})

// 工具确认响应（旧版）
ipcMain.on('ai:confirm-tool', (_, callId: string, confirmed: boolean) => {
  if (currentAgent) {
    const { ToolConfirmationOutcome } = require('./core/toolRegistry');
    const outcome = confirmed
      ? ToolConfirmationOutcome.ProceedOnce
      : ToolConfirmationOutcome.Cancel;
    currentAgent.confirmToolCall(callId, outcome)
  }
})

// 取消 Agent 执行（旧版）
ipcMain.on('ai:cancel', () => {
  if (currentAgent) {
    currentAgent.cancel()
  }
})

// Skills 管理
ipcMain.handle('skills:list', async () => {
  try {
    const manager = new SkillManager();
    const paths = getWorkspacePaths();
    await manager.discoverSkills(paths.base);
    const skills = manager.getAllSkills();
    console.log('[skills:list] Found skills:', skills.length, 'in workspace:', paths.base);
    return skills;
  } catch (error) {
    console.error('Failed to list skills:', error);
    return [];
  }
})

const SKILL_FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---/;
const SKILL_NAME_REGEX = /^\s*name:\s*(.+)$/m;
const SKILL_DESC_REGEX = /^\s*description:\s*(.+)$/m;

const CLAWHUB_BASE_URL = 'https://clawhub.ai';

const sanitizeSkillFileName = (value: string): string => {
  const normalized = value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '-');
  return normalized || `skill-${Date.now()}`;
};

const parseSkillHeader = (content: string): { name?: string; description?: string } => {
  const nameMatch = content.match(SKILL_NAME_REGEX);
  const descMatch = content.match(SKILL_DESC_REGEX);
  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, '');
  const description = descMatch?.[1]?.trim().replace(/^["']|["']$/g, '');
  return { name, description };
};

const buildSkillFileName = async (skillsDir: string, preferredName: string): Promise<string> => {
  const base = sanitizeSkillFileName(preferredName).replace(/\.md$/i, '');
  let candidate = `${base}.md`;
  let index = 1;
  while (true) {
    try {
      await fs.access(path.join(skillsDir, candidate));
      candidate = `${base}-${index}.md`;
      index += 1;
    } catch {
      return candidate;
    }
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const clawHubRequest = async (
  pathname: string,
  options?: {
    query?: Record<string, string | number | boolean | undefined>;
    responseType?: 'json' | 'text';
    retries?: number;
  }
): Promise<any> => {
  const query = options?.query || {};
  const url = new URL(pathname, CLAWHUB_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  let retries = options?.retries ?? 1;
  while (true) {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': options?.responseType === 'text' ? 'text/plain,*/*' : 'application/json',
        'User-Agent': 'RedConvert-Skill-Market/1.0',
      },
    });

    if (response.ok) {
      if (options?.responseType === 'text') {
        return response.text();
      }
      return response.json();
    }

    if (response.status === 429 && retries > 0) {
      const retryAfter = Number(response.headers.get('retry-after') || '2');
      await sleep(Math.max(1, retryAfter) * 1000);
      retries -= 1;
      continue;
    }

    const errorText = await response.text().catch(() => '');
    throw new Error(`ClawHub API error (${response.status}): ${errorText || response.statusText}`);
  }
};

const toMarketSkill = (item: any, index: number) => ({
  id: item.slug || `skill-${index}`,
  slug: item.slug || '',
  skillName: item.displayName || item.slug || 'Unknown Skill',
  description: item.summary || '',
  stars: Number(item.stats?.stars || 0),
  installs: Number(item.stats?.installsCurrent || item.stats?.installsAllTime || 0),
  updatedAt: typeof item.updatedAt === 'number'
    ? new Date(item.updatedAt).toISOString()
    : (item.updatedAt || ''),
  marketUrl: item.slug ? `https://clawhub.ai/skills/${item.slug}` : 'https://clawhub.ai',
  version: item.tags?.latest || item.version || '',
});

const installSkillFromMarket = async (slugInput: string, tagInput?: string) => {
  const slug = (slugInput || '').trim().toLowerCase();
  const tag = (tagInput || 'latest').trim() || 'latest';
  if (!slug) {
    throw new Error('技能 slug 不能为空');
  }

  const detail = await clawHubRequest(`/api/v1/skills/${encodeURIComponent(slug)}`, { retries: 1 });
  const detailSkill = detail?.skill || {};
  const candidatePaths = ['SKILL.md', 'skill.md'];
  let content = '';

  for (const filePath of candidatePaths) {
    try {
      const text = await clawHubRequest(`/api/v1/skills/${encodeURIComponent(slug)}/file`, {
        query: { path: filePath, tag },
        responseType: 'text',
        retries: 1,
      });
      if (typeof text === 'string' && text.trim()) {
        content = text;
        break;
      }
    } catch {
      // try next path
    }
  }

  if (!content.trim()) {
    throw new Error('未获取到技能文件（SKILL.md）');
  }

  const parsedHeader = parseSkillHeader(content);
  const inferredName = parsedHeader.name || detailSkill.displayName || detailSkill.slug || slug;
  const inferredDesc = parsedHeader.description || detailSkill.summary || `Imported from ClawHub (${slug})`;

  if (!SKILL_FRONTMATTER_REGEX.test(content)) {
    content = `---\nname: ${inferredName}\ndescription: ${inferredDesc}\n---\n\n${content}`;
  }

  const skillsDir = getWorkspacePaths().skills;
  await fs.mkdir(skillsDir, { recursive: true });
  const fileName = await buildSkillFileName(skillsDir, inferredName);
  const savePath = path.join(skillsDir, fileName);
  await fs.writeFile(savePath, content, 'utf-8');

  return {
    success: true,
    location: savePath,
    slug,
    tag,
    displayName: detailSkill.displayName || inferredName,
  };
};

ipcMain.handle('skills:enable', async (_, { name }: { name: string }) => {
  try {
    const manager = new SkillManager();
    await manager.discoverSkills(getWorkspacePaths().base);
    const changed = await manager.enableSkill(name);
    return { success: true, changed };
  } catch (error) {
    console.error('Failed to enable skill:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('skills:disable', async (_, { name }: { name: string }) => {
  try {
    const manager = new SkillManager();
    await manager.discoverSkills(getWorkspacePaths().base);
    const changed = await manager.disableSkill(name);
    return { success: true, changed };
  } catch (error) {
    console.error('Failed to disable skill:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('skills:market-search', async (_, { query }: { query?: string }) => {
  const keyword = (query || '').trim();
  try {
    if (keyword) {
      const data = await clawHubRequest('/api/v1/search', {
        query: { q: keyword, limit: 20, nonSuspiciousOnly: true },
        retries: 1,
      });
      const items = Array.isArray(data?.results) ? data.results : [];
      return items.map(toMarketSkill);
    }

    const trending = await clawHubRequest('/api/v1/skills', {
      query: { limit: 20, sort: 'trending', nonSuspiciousOnly: true },
      retries: 1,
    });
    const items = Array.isArray(trending?.items) ? trending.items : [];
    return items.map(toMarketSkill);
  } catch (error) {
    console.error('Failed to search skill market:', error);
    return [];
  }
});

ipcMain.handle('skills:market-install', async (_, { slug, tag }: { slug: string; tag?: string }) => {
  try {
    return await installSkillFromMarket(slug, tag);
  } catch (error) {
    console.error('Failed to install skill from market:', error);
    return { success: false, error: String(error) };
  }
});

// Legacy channel kept for compatibility with old renderer calls.
ipcMain.handle('skills:install-from-github', async (_, { repoFullName, skillPath }: { repoFullName: string; skillPath?: string }) => {
  const raw = (repoFullName || '').trim();
  const slug = raw.replace(/^https?:\/\/clawhub\.ai\/skills\//i, '').replace(/^clawhub\//i, '').replace(/^\/+|\/+$/g, '');
  try {
    if (!slug || slug.includes('/')) {
      return { success: false, error: '旧接口已切换为 ClawHub。请输入技能 slug（例如 redbook-browser-ops）。' };
    }
    return await installSkillFromMarket(slug, skillPath || 'latest');
  } catch (error) {
    console.error('Failed to install skill from legacy channel:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('skills:save', async (_, { location, content }: { location: string; content: string }) => {
  try {
    await fs.writeFile(location, content, 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to save skill:', error);
    return { success: false, error: String(error) };
  }
})

ipcMain.handle('skills:create', async (_, { name }: { name: string }) => {
  try {
    const paths = getWorkspacePaths();
    const skillsDir = paths.skills;
    await fs.mkdir(skillsDir, { recursive: true });

    const fileName = `${name}.md`;
    const filePath = path.join(skillsDir, fileName);

    // Check if file already exists
    try {
      await fs.access(filePath);
      return { success: false, error: '同名技能已存在' };
    } catch {
      // File doesn't exist, we can create it
    }

    const template = `---
name: ${name}
description: 请添加技能描述
---

# ${name}

在这里编写技能的详细指令...
`;

    await fs.writeFile(filePath, template, 'utf-8');
    return { success: true, location: filePath };
  } catch (error) {
    console.error('Failed to create skill:', error);
    return { success: false, error: String(error) };
  }
})

// --------- Advisors (智囊团) ---------
function getAdvisorsDir() {
  return path.join(getWorkspacePaths().base, 'advisors');
}

ipcMain.handle('advisors:list', async () => {
  const fs = require('fs/promises');
  const advisorsDir = getAdvisorsDir();

  try {
    await fs.mkdir(advisorsDir, { recursive: true });
    const dirs = await fs.readdir(advisorsDir, { withFileTypes: true });
    const advisors = [];

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const configPath = path.join(advisorsDir, dir.name, 'config.json');
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(content);

        // 处理头像路径
        if (config.avatar && !config.avatar.startsWith('http') && !config.avatar.startsWith('data:') && !config.avatar.match(/^[\w\u4e00-\u9fa5]+$/)) {
           // 如果不是 http/data 且不是 emoji (简单的 emoji 判定，或者干脆判断是否有扩展名)
           // 更简单的逻辑：如果文件存在于目录下，转换协议
           const avatarPath = path.join(advisorsDir, dir.name, config.avatar);
           try {
             await fs.access(avatarPath);
             config.avatar = pathToFileURL(avatarPath).toString().replace('file://', 'local-file://');
           } catch {
             // 文件不存在，保持原样（可能是 emoji）
           }
        }

        // Get knowledge files
        const knowledgeDir = path.join(advisorsDir, dir.name, 'knowledge');
        let knowledgeFiles: string[] = [];
        try {
          const files = await fs.readdir(knowledgeDir);
          knowledgeFiles = files.filter((f: string) => f.endsWith('.txt') || f.endsWith('.md'));
        } catch { /* no knowledge dir */ }
        advisors.push({ id: dir.name, ...config, knowledgeFiles });
      } catch { /* skip invalid */ }
    }

    return advisors.sort((a: { createdAt?: string }, b: { createdAt?: string }) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
  } catch (error) {
    console.error('Failed to list advisors:', error);
    return [];
  }
});

// 辅助函数：保存头像（下载URL或复制本地文件）
async function saveAdvisorAvatar(advisorDir: string, avatarInput: string): Promise<string> {
  const fs = require('fs/promises');

  // 1. 如果是简单的 Emoji (长度短且无扩展名)，直接返回
  if (avatarInput.length < 10 && !avatarInput.includes('/') && !avatarInput.includes('.')) {
    return avatarInput;
  }

  // 2. 如果是 URL (YouTube 头像)，下载它
  if (avatarInput.startsWith('http')) {
    try {
      const ext = path.extname(new URL(avatarInput).pathname) || '.jpg';
      const fileName = `avatar${ext}`;
      const destPath = path.join(advisorDir, fileName);
      await downloadImageToFile(avatarInput, destPath);
      return fileName;
    } catch (e) {
      console.error('Failed to download avatar:', e);
      return avatarInput; // 失败则保留 URL
    }
  }

  // 3. 如果是本地文件路径 (用户上传)，复制它
  // 判断逻辑：绝对路径
  if (path.isAbsolute(avatarInput)) {
    try {
      const ext = path.extname(avatarInput);
      const fileName = `avatar_${Date.now()}${ext}`;
      const destPath = path.join(advisorDir, fileName);
      await fs.copyFile(avatarInput, destPath);
      return fileName;
    } catch (e) {
      console.error('Failed to copy avatar:', e);
      return '🧠'; // 失败返回默认 Emoji
    }
  }

  // 4. 其他情况（已经是相对路径等），直接返回
  return avatarInput;
}

ipcMain.handle('advisors:create', async (_, data: { name: string; avatar: string; personality: string; systemPrompt: string; youtubeChannel?: { url: string; channelId: string } }) => {
  const fs = require('fs/promises');
  const advisorId = `advisor_${Date.now()}`;
  const advisorDir = path.join(getAdvisorsDir(), advisorId);

  try {
    await fs.mkdir(advisorDir, { recursive: true });
    await fs.mkdir(path.join(advisorDir, 'knowledge'), { recursive: true });

    // 处理头像保存
    const savedAvatar = await saveAdvisorAvatar(advisorDir, data.avatar);

    const config: Record<string, unknown> = {
      name: data.name,
      avatar: savedAvatar,
      personality: data.personality,
      systemPrompt: data.systemPrompt,
      createdAt: new Date().toISOString()
    };

    // If YouTube channel provided, save it
    if (data.youtubeChannel) {
      config.youtubeChannel = {
        url: data.youtubeChannel.url,
        channelId: data.youtubeChannel.channelId,
        lastRefreshed: new Date().toISOString()
      };
      config.videos = []; // Initialize empty video list
    }

    await fs.writeFile(path.join(advisorDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    return { success: true, id: advisorId };
  } catch (error) {
    console.error('Failed to create advisor:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('advisors:update', async (_, data: { id: string; name: string; avatar: string; personality: string; systemPrompt: string }) => {
  const fs = require('fs/promises');
  const advisorDir = path.join(getAdvisorsDir(), data.id);
  const configPath = path.join(advisorDir, 'config.json');

  try {
    const existingContent = await fs.readFile(configPath, 'utf-8');
    const existing = JSON.parse(existingContent);

    // 检查头像是否改变
    let newAvatar = data.avatar;
    // 如果传入的是 local-file:// 协议，说明没变，还原为 config 中的相对路径
    if (newAvatar.startsWith('local-file://')) {
        newAvatar = existing.avatar;
    } else if (newAvatar !== existing.avatar) {
        // 头像变了，保存新头像
        newAvatar = await saveAdvisorAvatar(advisorDir, newAvatar);
    }

    const updated = {
      ...existing,
      name: data.name,
      avatar: newAvatar,
      personality: data.personality,
      systemPrompt: data.systemPrompt
    };

    await fs.writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to update advisor:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('advisors:select-avatar', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp', 'gif'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('advisors:delete', async (_, advisorId: string) => {
  const fs = require('fs/promises');
  const advisorDir = path.join(getAdvisorsDir(), advisorId);

  try {
    await fs.rm(advisorDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete advisor:', error);
    return { success: false };
  }
});

ipcMain.handle('advisors:upload-knowledge', async (_, advisorId: string) => {
  const { dialog } = require('electron');
  const fs = require('fs/promises');

  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false };
  }

  const knowledgeDir = path.join(getAdvisorsDir(), advisorId, 'knowledge');
  await fs.mkdir(knowledgeDir, { recursive: true });

  for (const filePath of result.filePaths) {
    const fileName = path.basename(filePath);
    const destPath = path.join(knowledgeDir, fileName);
    await fs.copyFile(filePath, destPath);

    // Index advisor knowledge
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      indexManager.addToQueue(normalizeFile(
        `advisor_${advisorId}_${fileName}`,
        fileName,
        content,
        'advisor',
        advisorId
      ));
    } catch (e) {
      console.error(`Failed to index advisor file ${fileName}:`, e);
    }
  }

  return { success: true, count: result.filePaths.length };
});

ipcMain.handle('advisors:delete-knowledge', async (_, { advisorId, fileName }: { advisorId: string; fileName: string }) => {
  const fs = require('fs/promises');
  const filePath = path.join(getAdvisorsDir(), advisorId, 'knowledge', fileName);

  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete knowledge file:', error);
    return { success: false };
  }
});

ipcMain.handle('advisors:optimize-prompt', async (_, { info }: { info: string }) => {
  const OpenAI = require('openai').default;
  const settings = getSettings() as { api_endpoint?: string; api_key?: string; model_name?: string } | undefined;

  if (!settings?.api_endpoint || !settings?.api_key || !settings?.model_name) {
    return { success: false, error: '请先在设置中配置 API' };
  }

  try {
    const client = new OpenAI({ apiKey: settings.api_key, baseURL: settings.api_endpoint });

    const response = await client.chat.completions.create({
      model: settings.model_name,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的 Prompt 工程师。请根据用户的简单描述，编写一个高质量、详细的 AI 角色系统提示词 (System Prompt)。\n要求：\n1. 包含角色的人设、背景、专业技能、语言风格。\n2. 明确回复的约束条件（如字数限制、格式要求）。\n3. 提示词应激发 AI 的最佳表现。\n4. 直接返回优化后的 Prompt 内容，不要包含解释或其他文字。'
        },
        { role: 'user', content: `请优化以下角色描述：\n${info}` }
      ]
    });

    const optimizedPrompt = response.choices[0]?.message?.content || '';
    return { success: true, prompt: optimizedPrompt };
  } catch (error) {
    console.error('Failed to optimize prompt:', error);
    return { success: false, error: String(error) };
  }
});

// Deep AI Optimization - 搜索 + 知识库 + LLM 生成更全面的角色设定
ipcMain.handle('advisors:optimize-prompt-deep', async (_, {
  advisorId,
  name,
  personality,
  currentPrompt
}: {
  advisorId: string;
  name: string;
  personality: string;
  currentPrompt: string;
}) => {
  const OpenAI = require('openai').default;
  const { searchWeb } = await import('./core/bingSearch');
  const settings = getSettings() as { api_endpoint?: string; api_key?: string; model_name?: string } | undefined;

  if (!settings?.api_endpoint || !settings?.api_key || !settings?.model_name) {
    return { success: false, error: '请先在设置中配置 API' };
  }

  try {
    console.log(`[optimize-prompt-deep] Starting deep optimization for: ${name}`);

    // Step 1: 搜索这个人的信息
    let searchSummary = '';
    try {
      console.log(`[optimize-prompt-deep] Searching for: ${name}`);
      const searchResults = await searchWeb(`${name} 博主 创作者 介绍`, 5);
      if (searchResults.length > 0) {
        searchSummary = searchResults.map(r => `- ${r.title}: ${r.snippet}`).join('\n');
        console.log(`[optimize-prompt-deep] Found ${searchResults.length} search results`);
      }
    } catch (e) {
      console.warn('[optimize-prompt-deep] Search failed:', e);
    }

    // Step 2: 读取知识库内容摘要
    let knowledgeSummary = '';
    try {
      const fs = require('fs/promises');
      const advisorDir = path.join(getWorkspacePaths().base, 'advisors', advisorId);
      const knowledgeDir = path.join(advisorDir, 'knowledge');

      const files = await fs.readdir(knowledgeDir).catch(() => [] as string[]);
      const textFiles = files.filter((f: string) => f.endsWith('.txt') || f.endsWith('.md'));

      if (textFiles.length > 0) {
        const samples: string[] = [];
        // 读取最多3个文件的前500字符作为样本
        for (const file of textFiles.slice(0, 3)) {
          const content = await fs.readFile(path.join(knowledgeDir, file), 'utf-8');
          samples.push(`[${file}]\n${content.slice(0, 500)}...`);
        }
        knowledgeSummary = samples.join('\n\n');
        console.log(`[optimize-prompt-deep] Loaded ${textFiles.length} knowledge files`);
      }
    } catch (e) {
      console.warn('[optimize-prompt-deep] Knowledge read failed:', e);
    }

    // Step 3: 使用 LLM 生成优化后的角色设定
    const client = new OpenAI({ apiKey: settings.api_key, baseURL: settings.api_endpoint });

    const systemPromptForOptimization = `你是一位专业的 AI 角色设计师和 Prompt 工程师。请根据提供的信息，为这个智囊团成员生成一个高质量、全面的角色设定系统提示词。

## 要求
1. 分析所有可用信息，提炼出这个人的核心特点
2. 生成的角色设定应包含：
   - 身份背景和专业领域
   - 思维方式和分析风格
   - 语言风格和表达特点
   - 独特的观点或方法论
   - 回复时的约束（如字数、格式）
3. 让角色鲜活、有个性，不要太泛泛
4. 直接返回优化后的系统提示词，不要包含解释`;

    const userPromptForOptimization = `## 角色基本信息
- 名称: ${name}
- 一句话描述: ${personality || '(未填写)'}
- 当前设定: ${currentPrompt || '(未填写)'}

## 网络搜索结果
${searchSummary || '(未找到相关信息)'}

## 知识库内容样本
${knowledgeSummary || '(无知识库内容)'}

请基于以上信息，生成一个专业、全面的角色设定系统提示词：`;

    const response = await client.chat.completions.create({
      model: settings.model_name,
      messages: [
        { role: 'system', content: systemPromptForOptimization },
        { role: 'user', content: userPromptForOptimization }
      ],
      temperature: 0.7,
    });

    const optimizedPrompt = response.choices[0]?.message?.content || '';
    console.log(`[optimize-prompt-deep] Generated ${optimizedPrompt.length} chars prompt`);

    return { success: true, prompt: optimizedPrompt };
  } catch (error) {
    console.error('Failed to deep optimize prompt:', error);
    return { success: false, error: String(error) };
  }
});

// AI Persona Generation (for YouTube import)
ipcMain.handle('advisors:generate-persona', async (_, {
  channelName,
  channelDescription,
  videoTitles
}: {
  channelName: string;
  channelDescription: string;
  videoTitles: string[]
}) => {
  const OpenAI = require('openai').default;
  const { searchWeb } = await import('./core/bingSearch');
  const settings = getSettings() as { api_endpoint?: string; api_key?: string; model_name?: string } | undefined;

  if (!settings?.api_endpoint || !settings?.api_key || !settings?.model_name) {
    return { success: false, error: '请先在设置中配置 API' };
  }

  try {
    // Step 1: Search for information about the YouTuber
    console.log(`[generate-persona] Searching for: ${channelName}`);
    const searchResults = await searchWeb(`${channelName} YouTuber 博主 介绍`, 5);
    const searchSummary = searchResults.length > 0
      ? searchResults.map(r => `- ${r.title}: ${r.snippet}`).join('\n')
      : '(未找到搜索结果)';

    console.log(`[generate-persona] Found ${searchResults.length} search results`);

    // Step 2: Generate persona using LLM
    const client = new OpenAI({ apiKey: settings.api_key, baseURL: settings.api_endpoint });

    const prompt = `你是一位专业的 AI 角色设计师。请根据以下信息，为这个 YouTube 博主创建一个高质量的 AI 角色人设系统提示词。

## 博主信息

**频道名称**: ${channelName}

**频道描述**: 
${channelDescription || '(无描述)'}

**近期视频标题**:
${videoTitles.slice(0, 10).map(t => `- ${t}`).join('\n') || '(无视频信息)'}

**网络搜索结果**:
${searchSummary}

## 要求

请生成一个完整的系统提示词，包含：
1. **角色身份**: 清晰定义这个AI是谁，与真人博主的关系
2. **专业领域**: 根据视频主题归纳核心专长
3. **说话风格**: 基于频道调性推断（专业/轻松/激励等）
4. **价值观**: 该博主传达的核心理念
5. **互动方式**: 如何与用户交流
6. **边界说明**: 明确AI不是真人，是基于其内容训练的虚拟助手

直接输出系统提示词内容，不要添加其他解释。`;

    const response = await client.chat.completions.create({
      model: settings.model_name,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    });

    const generatedPrompt = response.choices[0]?.message?.content || '';
    console.log(`[generate-persona] Generated prompt (${generatedPrompt.length} chars)`);

    return { success: true, prompt: generatedPrompt, searchResults };
  } catch (error) {
    console.error('Failed to generate persona:', error);
    return { success: false, error: String(error) };
  }
});

// YouTube Import
ipcMain.handle('youtube:check-ytdlp', async () => {
  const { checkYtdlp } = await import('./core/youtubeScraper');
  return checkYtdlp();
});

ipcMain.handle('advisors:fetch-youtube-info', async (event, { channelUrl }: { channelUrl: string }) => {
  const { fetchChannelInfo } = await import('./core/youtubeScraper');
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const info = await fetchChannelInfo(channelUrl, (msg) => {
      win?.webContents.send('youtube:fetch-info-progress', msg);
    });
    return { success: true, data: info };
  } catch (error) {
    console.error('Failed to fetch channel info:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('advisors:download-youtube-subtitles', async (event, { channelUrl, videoCount, advisorId }: { channelUrl: string; videoCount: number; advisorId: string }) => {
  const { fetchVideoList } = await import('./core/youtubeScraper');
  const win = BrowserWindow.fromWebContents(event.sender);
  const fs = require('fs/promises');
  const advisorDir = path.join(getAdvisorsDir(), advisorId);
  const outputDir = path.join(advisorDir, 'knowledge');
  const configPath = path.join(advisorDir, 'config.json');

  try {
    await fs.mkdir(outputDir, { recursive: true });

    // Step 1: 获取视频列表
    win?.webContents.send('advisors:download-progress', { advisorId, progress: '正在获取视频列表...' });
    const videos = await fetchVideoList(channelUrl, videoCount);

    if (videos.length === 0) {
      win?.webContents.send('advisors:download-progress', { advisorId, progress: '未找到视频' });
      return { success: false, error: 'No videos found' };
    }

    // Step 2: 保存视频列表到 config.json
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configRaw);
    config.videos = videos;
    config.youtubeChannel = {
      ...config.youtubeChannel,
      lastRefreshed: new Date().toISOString()
    };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    win?.webContents.send('advisors:download-progress', { advisorId, progress: `找到 ${videos.length} 个视频，开始下载字幕...` });

    // Step 3: 逐个下载字幕（使用字幕队列，自动控制间隔）
    const { queueSubtitleDownload } = await import('./core/subtitleQueue');
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];

      // 发送进度
      win?.webContents.send('advisors:download-progress', {
        advisorId,
        progress: `下载中 (${i + 1}/${videos.length}): ${video.title.slice(0, 30)}...`
      });

      // 使用队列下载，队列内部会自动控制间隔
      const result = await queueSubtitleDownload(video.id, outputDir);

      // 更新视频状态
      if (result.success) {
        video.status = 'success';
        video.subtitleFile = result.subtitleFile;
        successCount++;

        // Index subtitle content
        if (result.subtitleFile) {
          try {
            const subtitleContent = await fs.readFile(path.join(outputDir, result.subtitleFile), 'utf-8');
            indexManager.addToQueue(normalizeVideo(
              `advisor_${advisorId}_youtube_${video.id}`,
              {
                videoId: video.id,
                title: video.title,
                description: '', // Not available here, but subtitle is main content
                videoUrl: `https://www.youtube.com/watch?v=${video.id}`
              },
              subtitleContent,
              'advisor',
              advisorId
            ));
          } catch (e) {
            console.error('Failed to index subtitle:', e);
          }
        }

      } else {
        video.status = 'failed';
        video.errorMessage = result.error;
        video.retryCount = 1;
        failCount++;
      }

      // 每下载一个就保存一次状态（支持断点续传）
      config.videos = videos;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    }

    win?.webContents.send('advisors:download-progress', {
      advisorId,
      progress: `下载完成！成功 ${successCount} 个，失败 ${failCount} 个`
    });

    return { success: true, successCount, failCount };
  } catch (error) {
    console.error('Failed to download subtitles:', error);
    win?.webContents.send('advisors:download-progress', { advisorId, progress: `下载失败: ${error}` });
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('youtube:install', async (event) => {
  const { installYtdlp } = await import('./core/youtubeScraper');
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const result = await installYtdlp((progress) => {
      win?.webContents.send('youtube:install-progress', progress);
    });
    return { success: result };
  } catch (error) {
    console.error('Failed to install yt-dlp:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('youtube:update', async () => {
  const { updateYtdlp } = await import('./core/youtubeScraper');
  try {
    const success = await updateYtdlp();
    return { success };
  } catch (error) {
    console.error('Failed to update yt-dlp:', error);
    return { success: false, error: String(error) };
  }
});

// Video Management
ipcMain.handle('advisors:refresh-videos', async (_, { advisorId, limit = 50 }: { advisorId: string; limit?: number }) => {
  const { fetchVideoList } = await import('./core/youtubeScraper');
  const fs = require('fs/promises');
  const advisorDir = path.join(getAdvisorsDir(), advisorId);
  const configPath = path.join(advisorDir, 'config.json');

  try {
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configRaw);

    if (!config.youtubeChannel?.url) {
      return { success: false, error: 'No YouTube channel configured' };
    }

    const newVideos = await fetchVideoList(config.youtubeChannel.url, limit);
    const existingVideos = config.videos || [];
    const existingIds = new Set(existingVideos.map((v: { id: string }) => v.id));

    // Merge: keep existing statuses, add new ones as pending
    const mergedVideos = [
      ...existingVideos,
      ...newVideos.filter(v => !existingIds.has(v.id))
    ];

    config.videos = mergedVideos;
    config.youtubeChannel.lastRefreshed = new Date().toISOString();

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true, videos: mergedVideos };
  } catch (error) {
    console.error('Failed to refresh videos:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('advisors:get-videos', async (_, { advisorId }: { advisorId: string }) => {
  const fs = require('fs/promises');
  const advisorDir = path.join(getAdvisorsDir(), advisorId);
  const configPath = path.join(advisorDir, 'config.json');

  try {
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configRaw);
    return { success: true, videos: config.videos || [], youtubeChannel: config.youtubeChannel };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('advisors:download-video', async (_event, { advisorId, videoId }: { advisorId: string; videoId: string }) => {
  const { queueSubtitleDownload } = await import('./core/subtitleQueue');
  const fsSync = require('fs');
  const fs = require('fs/promises');
  const advisorDir = path.join(getAdvisorsDir(), advisorId);
  const knowledgeDir = path.join(advisorDir, 'knowledge');
  const configPath = path.join(advisorDir, 'config.json');

  if (!fsSync.existsSync(knowledgeDir)) {
    fsSync.mkdirSync(knowledgeDir, { recursive: true });
  }

  try {
    // Update status to downloading
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configRaw);
    const video = config.videos?.find((v: { id: string }) => v.id === videoId);
    if (video) {
      video.status = 'downloading';
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    }

    const result = await queueSubtitleDownload(videoId, knowledgeDir);

    // Update status based on result
    const updatedConfigRaw = await fs.readFile(configPath, 'utf-8');
    const updatedConfig = JSON.parse(updatedConfigRaw);
    const updatedVideo = updatedConfig.videos?.find((v: { id: string }) => v.id === videoId);
    if (updatedVideo) {
      if (result.success) {
        updatedVideo.status = 'success';
        updatedVideo.subtitleFile = result.subtitleFile;
        updatedVideo.errorMessage = undefined;
      } else {
        updatedVideo.status = 'failed';
        updatedVideo.retryCount = (updatedVideo.retryCount || 0) + 1;
        updatedVideo.errorMessage = result.error;
      }
      await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
    }

    return result;
  } catch (error) {
    console.error('Failed to download video:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('advisors:retry-failed', async (event, { advisorId }: { advisorId: string }) => {
  const { queueSubtitleDownload } = await import('./core/subtitleQueue');
  const fsSync = require('fs');
  const fs = require('fs/promises');
  const advisorDir = path.join(getAdvisorsDir(), advisorId);
  const knowledgeDir = path.join(advisorDir, 'knowledge');
  const configPath = path.join(advisorDir, 'config.json');
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!fsSync.existsSync(knowledgeDir)) {
    fsSync.mkdirSync(knowledgeDir, { recursive: true });
  }

  try {
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configRaw);
    const failedVideos = (config.videos || []).filter((v: { status: string; retryCount: number }) =>
      v.status === 'failed' && (v.retryCount || 0) < 5
    );

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < failedVideos.length; i++) {
      const video = failedVideos[i];
      win?.webContents.send('advisors:retry-progress', { current: i + 1, total: failedVideos.length, videoId: video.id });

      // 使用队列下载，队列内部会自动控制间隔
      const result = await queueSubtitleDownload(video.id, knowledgeDir);

      // Re-read config each time to avoid race conditions
      const currentRaw = await fs.readFile(configPath, 'utf-8');
      const currentConfig = JSON.parse(currentRaw);
      const currentVideo = currentConfig.videos?.find((v: { id: string }) => v.id === video.id);

      if (currentVideo) {
        if (result.success) {
          currentVideo.status = 'success';
          currentVideo.subtitleFile = result.subtitleFile;
          currentVideo.errorMessage = undefined;
          successCount++;
        } else {
          currentVideo.status = 'failed';
          currentVideo.retryCount = (currentVideo.retryCount || 0) + 1;
          currentVideo.errorMessage = result.error;
          failCount++;
        }
        await fs.writeFile(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
      }
    }

    return { success: true, successCount, failCount };
  } catch (error) {
    console.error('Failed to retry downloads:', error);
    return { success: false, error: String(error) };
  }
});

// 向量索引管理 (Deprecated) -> Removed
// 检查是否需要自动索引 (Deprecated) -> Removed

// --------- Chat Rooms (创意聊天室) ---------
function getChatroomsDir() {
  return path.join(getWorkspacePaths().base, 'chatrooms');
}

// ========== 六顶思考帽系统聊天室 ==========
const SIX_HATS_ROOM_ID = 'system_six_thinking_hats';
const SIX_HATS_ROOM_NAME = '六顶思考帽';

// 六顶思考帽角色定义（增强版：支持工具调用和深度思考）
const SIX_THINKING_HATS = [
  {
    id: 'hat_white',
    name: '白帽',
    avatar: '⚪',
    color: '#FFFFFF',
    personality: '客观事实',
    systemPrompt: `你是"六顶思考帽"中的【白帽思考者】。

## 你的角色
白帽代表客观、中立的思维。你专注于：
- 已知的事实和数据
- 需要收集的信息
- 如何获取所需信息
- 客观分析，不带情感色彩

## 深度思考流程
1. **信息识别**：分析问题中已知的事实
2. **信息缺口**：识别缺失的关键数据
3. **数据搜索**：如果需要最新数据或事实验证，使用 web_search 工具搜索
4. **客观呈现**：整理并呈现事实，区分"已知"和"待确认"

## 工具使用指南
- 当需要验证事实、获取统计数据、查找最新信息时，主动使用 web_search
- 当需要计算数字时，使用 calculator
- 搜索时使用精确的关键词，如"XX 统计数据 2024"

## 回复要求
- 只陈述事实，不做价值判断
- 标注信息来源（搜索结果/已知/待确认）
- 用数据说话，保持中立客观
- 150-250字`
  },
  {
    id: 'hat_red',
    name: '红帽',
    avatar: '🔴',
    color: '#EF4444',
    personality: '情感直觉',
    systemPrompt: `你是"六顶思考帽"中的【红帽思考者】。

## 你的角色
红帽代表情感和直觉。你专注于：
- 直觉感受
- 情绪反应
- 喜好厌恶
- 不需要解释的感觉

## 深度思考流程
1. **第一印象**：这个问题给你什么直觉感受？
2. **情感共鸣**：如果是用户/客户会有什么情绪反应？
3. **直觉判断**：你的"内心声音"在说什么？
4. **感性洞察**：有时可以搜索相关的用户反馈或情感案例来佐证直觉

## 工具使用指南
- 可以搜索用户评价、情感反馈、社会舆论来了解大众情绪
- 搜索关键词如"用户评价"、"网友看法"、"争议"等

## 回复要求
- 直接表达感受，如"我觉得..."、"这让我感到..."
- 分享直觉判断，不需要理性解释
- 表达真实情感，包括担忧、兴奋、不安等
- 100-150字`
  },
  {
    id: 'hat_black',
    name: '黑帽',
    avatar: '⚫',
    color: '#1F2937',
    personality: '谨慎批判',
    systemPrompt: `你是"六顶思考帽"中的【黑帽思考者】。

## 你的角色
黑帽代表谨慎和批判性思维。你专注于：
- 潜在的风险和问题
- 可能的负面后果
- 逻辑上的漏洞
- 为什么可能行不通

## 深度思考流程
1. **风险识别**：列出所有可能的风险点
2. **案例研究**：搜索类似方案的失败案例或问题报道
3. **逻辑检验**：检查论证中的逻辑漏洞
4. **最坏情况**：分析最坏情况会怎样
5. **量化风险**：如需要，用计算器评估潜在损失

## 工具使用指南
- 主动搜索"失败案例"、"风险"、"问题"、"争议"等关键词
- 搜索行业报告中的风险分析
- 使用 calculator 计算潜在损失或风险概率

## 回复要求
- 指出具体的风险和隐患（引用搜索到的案例）
- 分析可能的失败原因
- 提出合理的质疑
- 保持建设性批评，不是为了否定而否定
- 150-250字`
  },
  {
    id: 'hat_yellow',
    name: '黄帽',
    avatar: '🟡',
    color: '#EAB308',
    personality: '积极乐观',
    systemPrompt: `你是"六顶思考帽"中的【黄帽思考者】。

## 你的角色
黄帽代表乐观和积极思维。你专注于：
- 可能的好处和价值
- 积极的方面
- 可行性和机会
- 最好的情况

## 深度思考流程
1. **价值发现**：这个方案能带来什么好处？
2. **成功案例**：搜索类似方案的成功案例
3. **机会识别**：有哪些潜在的机会？
4. **收益计算**：如需要，计算潜在收益
5. **乐观展望**：最好的情况会怎样？

## 工具使用指南
- 搜索"成功案例"、"最佳实践"、"收益"、"增长"等正面关键词
- 搜索行业趋势和机会
- 使用 calculator 计算潜在收益或增长率

## 回复要求
- 强调积极面，引用成功案例
- 发现潜在价值和机会
- 说明为什么可行
- 保持乐观但现实，有数据支撑更好
- 150-250字`
  },
  {
    id: 'hat_green',
    name: '绿帽',
    avatar: '🟢',
    color: '#22C55E',
    personality: '创意创新',
    systemPrompt: `你是"六顶思考帽"中的【绿帽思考者】。

## 你的角色
绿帽代表创造力和新想法。你专注于：
- 新的可能性
- 替代方案
- 创新的解决办法
- 打破常规思维

## 深度思考流程
1. **突破限制**：如果没有任何限制，可以怎么做？
2. **跨界借鉴**：搜索其他行业/领域的创新做法
3. **逆向思维**：反过来想会怎样？
4. **组合创新**：能否将不同元素组合？
5. **未来趋势**：搜索新兴趋势和前沿技术

## 工具使用指南
- 搜索"创新案例"、"新趋势"、"颠覆性"、"前沿技术"等关键词
- 搜索不同行业的创新解决方案
- 搜索最新的技术发展和应用

## 回复要求
- 提出至少2-3个新奇的想法
- 引用搜索到的创新案例作为灵感
- 探索不同的可能性
- 鼓励打破常规思维
- 150-250字`
  },
  {
    id: 'hat_blue',
    name: '蓝帽',
    avatar: '🔵',
    color: '#3B82F6',
    personality: '总结统筹',
    systemPrompt: `你是"六顶思考帽"中的【蓝帽思考者】。

## 你的角色
蓝帽代表控制和组织思维过程。你专注于：
- 总结各方观点
- 组织讨论框架
- 得出结论
- 规划下一步行动

## 深度思考流程
1. **观点梳理**：整理前面5顶帽子的核心观点
2. **矛盾分析**：识别观点之间的冲突和互补
3. **权衡取舍**：平衡风险与机会
4. **决策框架**：搜索相关的决策框架或方法论
5. **行动规划**：制定具体可执行的下一步

## 工具使用指南
- 可以搜索"决策框架"、"评估方法"等帮助做出更好的总结
- 如需要，使用 calculator 做量化比较

## 回复要求
- 综合前面各帽子的观点（简要引用）
- 提炼3-5个关键见解
- 给出清晰的结论或建议
- 提供2-3个可执行的行动方案
- 200-300字`
  }
];

// 确保六顶思考帽聊天室存在
async function ensureSixHatsRoom() {
  const fs = require('fs/promises');
  const roomsDir = getChatroomsDir();
  const roomPath = path.join(roomsDir, `${SIX_HATS_ROOM_ID}.json`);

  try {
    await fs.mkdir(roomsDir, { recursive: true });

    // 检查是否已存在
    try {
      await fs.access(roomPath);
      return; // 已存在
    } catch {
      // 不存在，创建
    }

    const room = {
      id: SIX_HATS_ROOM_ID,
      name: SIX_HATS_ROOM_NAME,
      advisorIds: SIX_THINKING_HATS.map(h => h.id),
      messages: [],
      createdAt: new Date().toISOString(),
      isSystem: true, // 标记为系统聊天室
      systemType: 'six_thinking_hats'
    };

    await fs.writeFile(roomPath, JSON.stringify(room, null, 2), 'utf-8');
    console.log('[Six Hats] Created default room');
  } catch (error) {
    console.error('[Six Hats] Failed to create room:', error);
  }
}

ipcMain.handle('chatrooms:list', async () => {
  const fs = require('fs/promises');
  const roomsDir = getChatroomsDir();

  // 确保六顶思考帽聊天室存在
  await ensureSixHatsRoom();

  try {
    await fs.mkdir(roomsDir, { recursive: true });
    const files = await fs.readdir(roomsDir);
    const rooms = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(roomsDir, file), 'utf-8');
        const room = JSON.parse(content);
        rooms.push(room);
      } catch { /* skip invalid */ }
    }

    // 系统聊天室排在最前面
    return rooms.sort((a: { isSystem?: boolean; createdAt?: string }, b: { isSystem?: boolean; createdAt?: string }) => {
      if (a.isSystem && !b.isSystem) return -1;
      if (!a.isSystem && b.isSystem) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  } catch (error) {
    console.error('Failed to list chatrooms:', error);
    return [];
  }
});

ipcMain.handle('chatrooms:create', async (_, { name, advisorIds }: { name: string; advisorIds: string[] }) => {
  const fs = require('fs/promises');
  const roomId = `room_${Date.now()}`;
  const roomPath = path.join(getChatroomsDir(), `${roomId}.json`);

  try {
    await fs.mkdir(getChatroomsDir(), { recursive: true });

    const room = {
      id: roomId,
      name,
      advisorIds,
      messages: [],
      createdAt: new Date().toISOString()
    };

    await fs.writeFile(roomPath, JSON.stringify(room, null, 2), 'utf-8');
    return room;
  } catch (error) {
    console.error('Failed to create chatroom:', error);
    return null;
  }
});

ipcMain.handle('chatrooms:messages', async (_, roomId: string) => {
  const fs = require('fs/promises');
  const roomPath = path.join(getChatroomsDir(), `${roomId}.json`);

  try {
    const content = await fs.readFile(roomPath, 'utf-8');
    const room = JSON.parse(content);
    return room.messages || [];
  } catch (error) {
    console.error('Failed to get messages:', error);
    return [];
  }
});

ipcMain.handle('chatrooms:update', async (_, { roomId, name, advisorIds }: { roomId: string; name?: string; advisorIds?: string[] }) => {
  const fs = require('fs/promises');
  const roomPath = path.join(getChatroomsDir(), `${roomId}.json`);

  try {
    const content = await fs.readFile(roomPath, 'utf-8');
    const room = JSON.parse(content);

    if (name !== undefined) room.name = name;
    if (advisorIds !== undefined) room.advisorIds = advisorIds;

    await fs.writeFile(roomPath, JSON.stringify(room, null, 2), 'utf-8');
    return { success: true, room };
  } catch (error) {
    console.error('Failed to update chatroom:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('chatrooms:delete', async (_, roomId: string) => {
  const fs = require('fs/promises');
  const roomPath = path.join(getChatroomsDir(), `${roomId}.json`);

  try {
    await fs.unlink(roomPath);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete chatroom:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('chatrooms:clear', async (_, roomId: string) => {
  const fs = require('fs/promises');
  const roomPath = path.join(getChatroomsDir(), `${roomId}.json`);

  try {
    const content = await fs.readFile(roomPath, 'utf-8');
    const room = JSON.parse(content);
    room.messages = [];
    await fs.writeFile(roomPath, JSON.stringify(room, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to clear chatroom messages:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('chatrooms:send', async (_, { roomId, message, context }: { roomId: string; message: string; context?: { filePath: string; fileContent: string } }) => {
  const fs = require('fs/promises');
  const roomPath = path.join(getChatroomsDir(), `${roomId}.json`);
  const { createDiscussionFlowService, DIRECTOR_ID } = await import('./core/director');

  try {
    // Load room
    const roomContent = await fs.readFile(roomPath, 'utf-8');
    const room = JSON.parse(roomContent);

    // Add user message
    const userMsg = { id: `msg_${Date.now()}`, role: 'user', content: message, timestamp: new Date().toISOString() };
    room.messages.push(userMsg);

    // 通知前端有新的用户消息（用于从其他页面发送消息的场景）
    win?.webContents.send('creative-chat:user-message', {
      roomId,
      message: userMsg
    });

    // Get settings
    const settings = getSettings() as { api_endpoint?: string; api_key?: string; model_name?: string; embedding_endpoint?: string; embedding_key?: string; embedding_model?: string } | undefined;
    if (!settings?.api_endpoint || !settings?.api_key || !settings?.model_name) {
      win?.webContents.send('creative-chat:done');
      return { success: false, error: 'API not configured' };
    }

    // ========== 检查是否是六顶思考帽模式 ==========
    const isSixHatsMode = room.isSystem && room.systemType === 'six_thinking_hats';

    let advisorInfos: { id: string; name: string; avatar: string; systemPrompt: string; knowledgeDir: string }[] = [];

    if (isSixHatsMode) {
      // 六顶思考帽模式：使用预定义的帽子角色
      advisorInfos = SIX_THINKING_HATS.map(hat => ({
        id: hat.id,
        name: hat.name,
        avatar: hat.avatar,
        systemPrompt: hat.systemPrompt,
        knowledgeDir: '', // 六顶思考帽不使用知识库
      }));
    } else {
      // 普通模式：从智囊团加载顾问
      const advisorsDir = getAdvisorsDir();

      for (const advisorId of room.advisorIds) {
        // 跳过总监ID（总监由DiscussionFlowService自动处理）
        if (advisorId === DIRECTOR_ID) continue;

        try {
          const configPath = path.join(advisorsDir, advisorId, 'config.json');
          const advisorContent = await fs.readFile(configPath, 'utf-8');
          const advisor = JSON.parse(advisorContent);
          const knowledgeDir = path.join(advisorsDir, advisorId, 'knowledge');

          advisorInfos.push({
            id: advisorId,
            name: advisor.name,
            avatar: advisor.avatar,
            systemPrompt: advisor.systemPrompt || '',
            knowledgeDir,
          });
        } catch (err) {
          console.error(`Failed to load advisor ${advisorId}:`, err);
        }
      }
    }

    if (advisorInfos.length === 0) {
      win?.webContents.send('creative-chat:done');
      return { success: false, error: 'No valid advisors in room' };
    }

    // 构建 Embedding 配置（已废弃）
    const embeddingConfig = null;

    // 创建讨论流程服务
    const discussionService = createDiscussionFlowService({
      apiKey: settings.api_key!,
      baseURL: settings.api_endpoint!,
      model: settings.model_name!,
    }, win);

    // 执行讨论流程
    // 六顶思考帽模式：按固定顺序（白→红→黑→黄→绿→蓝）
    // 普通模式：总监开场 -> 成员随机发言 -> 总监总结
    const newMessages = await discussionService.orchestrateDiscussion(
      roomId,
      message,
      advisorInfos,
      room.messages,
      isSixHatsMode, // 传递模式标记
      room.name, // 传递群聊目标
      context // 传递文件上下文
    );

    // 保存所有新消息到房间
    for (const msg of newMessages) {
      room.messages.push({
        id: msg.id,
        role: msg.role,
        advisorId: msg.advisorId,
        advisorName: msg.advisorName,
        advisorAvatar: msg.advisorAvatar,
        content: msg.content,
        timestamp: msg.timestamp,
        phase: msg.phase,
      });
    }

    // Save room
    await fs.writeFile(roomPath, JSON.stringify(room, null, 2), 'utf-8');
    win?.webContents.send('creative-chat:done');
    return { success: true };

  } catch (error) {
    console.error('Failed to send message:', error);
    win?.webContents.send('creative-chat:done');
    return { success: false, error: String(error) };
  }
});

// --------- Manuscripts (稿件编辑器) ---------
function getManuscriptsDir() {
  return getWorkspacePaths().manuscripts;
}

async function ensureManuscriptsDir() {
  const fs = require('fs/promises');
  try {
    await fs.mkdir(getManuscriptsDir(), { recursive: true });
  } catch { }
}

// 递归构建文件树
async function buildFileTree(dirPath: string, basePath: string): Promise<{ name: string; path: string; isDirectory: boolean; children?: unknown[]; status?: string }[]> {
  const fs = require('fs/promises');
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result: { name: string; path: string; isDirectory: boolean; children?: unknown[]; status?: string }[] = [];

  // Sort: directories first, then alphabetically
  const sorted = entries.sort((a: { isDirectory: () => boolean; name: string }, b: { isDirectory: () => boolean; name: string }) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(basePath, fullPath);

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, basePath);
      result.push({
        name: entry.name,
        path: relativePath,
        isDirectory: true,
        children
      });
    } else if (entry.name.endsWith('.md')) {
      let status = 'writing';
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const { data } = matter(content);
        if (data && data.status) {
          status = data.status;
        }
      } catch (e) {
        // Ignore error
      }
      result.push({
        name: entry.name,
        path: relativePath,
        isDirectory: false,
        status
      });
    }
  }

  return result;
}

// 列出文件树
ipcMain.handle('manuscripts:list', async () => {
  const fs = require('fs/promises');
  await ensureManuscriptsDir();
  const baseDir = getManuscriptsDir();

  try {
    const tree = await buildFileTree(baseDir, baseDir);
    return tree;
  } catch (error) {
    console.error('Failed to list manuscripts:', error);
    return [];
  }
});

// 读取文件内容
ipcMain.handle('manuscripts:read', async (_, filePath: string) => {
  const fs = require('fs/promises');
  const fullPath = path.join(getManuscriptsDir(), filePath);

  try {
    const rawContent = await fs.readFile(fullPath, 'utf-8');

    // Parse frontmatter
    const parsed = matter(rawContent);
    let { data, content } = parsed;
    let needsUpdate = false;

    // Ensure ID exists
    if (!data.id) {
      data.id = ulid();
      data.createdAt = Date.now();
      needsUpdate = true;
    }

    // If metadata was added/generated, write it back immediately
    if (needsUpdate) {
      const newContent = matter.stringify(content, data);
      await fs.writeFile(fullPath, newContent, 'utf-8');
    }

    return { content, metadata: data };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File not found - likely deleted. Return empty quietly.
      return { content: '', metadata: {} };
    }
    console.error('Failed to read manuscript:', error);
    // Return structure matching success case but empty
    return { content: '', metadata: {} };
  }
});

// 保存文件内容
ipcMain.handle('manuscripts:save', async (_, { path: filePath, content, metadata }: { path: string; content: string; metadata?: any }) => {
  const fs = require('fs/promises');
  const fullPath = path.join(getManuscriptsDir(), filePath);

  try {
    // If metadata provided, update timestamp
    const data = metadata || {};
    data.updatedAt = Date.now();

    // Recombine content and metadata
    const fileContent = matter.stringify(content, data);

    await fs.writeFile(fullPath, fileContent, 'utf-8');

    // 自动将稿件加入索引队列计算 embedding
    if (content && content.trim().length > 0) {
      const title = data.title || path.basename(filePath, '.md');
      indexManager.addToQueue({
        id: `manuscript_${filePath}`,
        sourceId: filePath,
        title,
        content,
        sourceType: 'file',
        scope: 'user',
        displayData: {
          platform: 'manuscript',
          url: filePath
        }
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to save manuscript:', error);
    return { success: false, error: String(error) };
  }
});

// 获取布局信息
ipcMain.handle('manuscripts:get-layout', async () => {
  const fs = require('fs/promises');
  await ensureManuscriptsDir();
  const layoutPath = path.join(getManuscriptsDir(), 'layout.json');

  try {
    const content = await fs.readFile(layoutPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
});

// 保存布局信息
ipcMain.handle('manuscripts:save-layout', async (_, layout: any) => {
  const fs = require('fs/promises');
  await ensureManuscriptsDir();
  const layoutPath = path.join(getManuscriptsDir(), 'layout.json');

  try {
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to save layout:', error);
    return { success: false, error: String(error) };
  }
});

// 创建文件夹
ipcMain.handle('manuscripts:create-folder', async (_, { parentPath, name }: { parentPath: string; name: string }) => {
  const fs = require('fs/promises');
  const fullPath = path.join(getManuscriptsDir(), parentPath, name);

  try {
    await fs.mkdir(fullPath, { recursive: true });
    return { success: true };
  } catch (error) {
    console.error('Failed to create folder:', error);
    return { success: false, error: String(error) };
  }
});

// 创建文件
ipcMain.handle('manuscripts:create-file', async (_, { parentPath, name, content }: { parentPath: string; name: string; content?: string }) => {
  const fs = require('fs/promises');
  const fileName = name.endsWith('.md') ? name : `${name}.md`;
  const fullPath = path.join(getManuscriptsDir(), parentPath, fileName);

  try {
    // Check if exists
    try {
      await fs.access(fullPath);
      return { success: false, error: '文件已存在' };
    } catch {
      // File doesn't exist, create it
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content || '', 'utf-8');
    return { success: true, path: path.relative(getManuscriptsDir(), fullPath) };
  } catch (error) {
    console.error('Failed to create file:', error);
    return { success: false, error: String(error) };
  }
});

// 删除文件或文件夹
ipcMain.handle('manuscripts:delete', async (_, filePath: string) => {
  const fs = require('fs/promises');
  const fullPath = path.join(getManuscriptsDir(), filePath);

  try {
    await fs.rm(fullPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete manuscript:', error);
    return { success: false, error: String(error) };
  }
});

// 重命名文件或文件夹
ipcMain.handle('manuscripts:rename', async (_, { oldPath, newName }: { oldPath: string; newName: string }) => {
  const fs = require('fs/promises');
  const oldFullPath = path.join(getManuscriptsDir(), oldPath);
  const parentDir = path.dirname(oldFullPath);
  const newFullPath = path.join(parentDir, newName);

  try {
    await fs.rename(oldFullPath, newFullPath);
    return { success: true, newPath: path.relative(getManuscriptsDir(), newFullPath) };
  } catch (error) {
    console.error('Failed to rename manuscript:', error);
    return { success: false, error: String(error) };
  }
});

// 移动文件（拖拽）
ipcMain.handle('manuscripts:move', async (_, { sourcePath, targetDir }: { sourcePath: string; targetDir: string }) => {
  const fs = require('fs/promises');
  const sourceFullPath = path.join(getManuscriptsDir(), sourcePath);
  const fileName = path.basename(sourceFullPath);
  const targetFullPath = path.join(getManuscriptsDir(), targetDir, fileName);

  try {
    await fs.mkdir(path.dirname(targetFullPath), { recursive: true });
    await fs.rename(sourceFullPath, targetFullPath);
    return { success: true, newPath: path.relative(getManuscriptsDir(), targetFullPath) };
  } catch (error) {
    console.error('Failed to move manuscript:', error);
    return { success: false, error: String(error) };
  }
});

// --------- Knowledge Base ---------
function getKnowledgeRedbookDir() {
  return getWorkspacePaths().knowledgeRedbook;
}

function getKnowledgeYoutubeDir() {
  return getWorkspacePaths().knowledgeYoutube;
}

async function ensureKnowledgeRedbookDir() {
  const fs = require('fs/promises');
  try {
    await fs.mkdir(getKnowledgeRedbookDir(), { recursive: true });
  } catch { }
}

async function ensureKnowledgeYoutubeDir() {
  const fs = require('fs/promises');
  try {
    await fs.mkdir(getKnowledgeYoutubeDir(), { recursive: true });
  } catch { }
}

ipcMain.handle('knowledge:list', async () => {
  const fs = require('fs/promises');
  await ensureKnowledgeRedbookDir();

  try {
    const dirs = await fs.readdir(getKnowledgeRedbookDir(), { withFileTypes: true });
    const notes = [];

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const metaPath = path.join(getKnowledgeRedbookDir(), dir.name, 'meta.json');
      try {
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        const noteDir = path.join(getKnowledgeRedbookDir(), dir.name);

        // Extract tags from meta.tags or content hashtags
        let tags: string[] = [];
        if (Array.isArray(meta.tags)) {
          tags = meta.tags;
        }
        // Also parse hashtags from content if present
        if (meta.content) {
          const hashtags = meta.content.match(/#[^\s#]+/g);
          if (hashtags) {
            // Remove the # prefix and merge
            const cleanTags = hashtags.map((t: string) => t.slice(1));
            tags = [...new Set([...tags, ...cleanTags])];
          }
        }

        const images = Array.isArray(meta.images)
          ? meta.images.map((img: string) => {
              if (typeof img !== 'string') return img;
              if (img.startsWith('http')) return img;
              const absolutePath = path.join(noteDir, img);
              const fileUrl = pathToFileURL(absolutePath).toString();
              return fileUrl.replace('file://', 'local-file://');
            })
          : [];

        let cover = meta.cover;
        if (cover && typeof cover === 'string' && !cover.startsWith('http')) {
          const absolutePath = path.join(noteDir, cover);
          const fileUrl = pathToFileURL(absolutePath).toString();
          cover = fileUrl.replace('file://', 'local-file://');
        }

        // Process video path
        let video = meta.video;
        if (video && typeof video === 'string' && !video.startsWith('http')) {
          const absolutePath = path.join(noteDir, video);
          const fileUrl = pathToFileURL(absolutePath).toString();
          video = fileUrl.replace('file://', 'local-file://');
        }

        notes.push({ id: dir.name, ...meta, images, cover, video, transcript: meta.transcript || '', tags });
      } catch {
        // Skip notes without valid meta
      }
    }

    return notes.sort((a: { createdAt?: string }, b: { createdAt?: string }) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
  } catch (error) {
    console.error('Failed to list notes:', error);
    return [];
  }
})

ipcMain.handle('knowledge:delete', async (_, noteId: string) => {
  const fs = require('fs/promises');
  const notePath = path.join(getKnowledgeRedbookDir(), noteId);

  try {
    await fs.rm(notePath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete note:', error);
    return { success: false };
  }
})

ipcMain.handle('knowledge:transcribe', async (_event, noteId: string) => {
  const fs = require('fs/promises');
  const noteDir = path.join(getKnowledgeRedbookDir(), noteId);
  const metaPath = path.join(noteDir, 'meta.json');
  try {
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent) as { video?: string; transcript?: string; transcriptFile?: string };
    if (!meta.video) {
      return { success: false, error: 'No video found' };
    }
    if (meta.transcript && meta.transcript.trim()) {
      return { success: true, transcript: meta.transcript };
    }
    const videoPath = path.join(noteDir, meta.video);
    const transcript = await transcribeVideoToText(videoPath);
    if (!transcript) {
      return { success: false, error: 'Transcription failed' };
    }
    meta.transcript = transcript;
    meta.transcriptFile = 'transcript.txt';
    await fs.writeFile(path.join(noteDir, meta.transcriptFile), transcript);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    // Index the transcript
    indexManager.addToQueue(normalizeVideo(
      noteId,
      meta,
      transcript,
      'user'
    ));

    win?.webContents.send('knowledge:note-updated', { noteId, hasTranscript: true });
    return { success: true, transcript };
  } catch (error) {
    console.error('Failed to transcribe note video:', error);
    return { success: false, error: String(error) };
  }
});

// --------- YouTube Knowledge Base ---------
ipcMain.handle('knowledge:list-youtube', async () => {
  const fs = require('fs/promises');
  await ensureKnowledgeYoutubeDir();

  try {
    const dirs = await fs.readdir(getKnowledgeYoutubeDir(), { withFileTypes: true });
    const videos = [];

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const metaPath = path.join(getKnowledgeYoutubeDir(), dir.name, 'meta.json');
      try {
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        const videoDir = path.join(getKnowledgeYoutubeDir(), dir.name);

        // Convert local thumbnail path to local-file protocol
        let thumbnailUrl = meta.thumbnailUrl;
        if (meta.thumbnail) {
          const absolutePath = path.join(videoDir, meta.thumbnail);
          const fileUrl = pathToFileURL(absolutePath).toString();
          thumbnailUrl = fileUrl.replace('file://', 'local-file://');
        }

        // Read subtitle content if available
        let subtitleContent = '';
        if (meta.subtitleFile) {
          try {
            subtitleContent = await fs.readFile(path.join(videoDir, meta.subtitleFile), 'utf-8');
          } catch { /* no subtitle */ }
        }

        videos.push({
          id: dir.name,
          ...meta,
          thumbnailUrl,
          subtitleContent
        });
      } catch {
        // Skip videos without valid meta
      }
    }

    return videos.sort((a: { createdAt?: string }, b: { createdAt?: string }) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
  } catch (error) {
    console.error('Failed to list YouTube videos:', error);
    return [];
  }
})

ipcMain.handle('knowledge:delete-youtube', async (_, videoId: string) => {
  const fs = require('fs/promises');
  const videoPath = path.join(getKnowledgeYoutubeDir(), videoId);

  try {
    await fs.rm(videoPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error('Failed to delete YouTube video:', error);
    return { success: false };
  }
})

ipcMain.handle('knowledge:read-youtube-subtitle', async (_, videoId: string) => {
  const fs = require('fs/promises');
  const videoDir = path.join(getKnowledgeYoutubeDir(), videoId);
  const metaPath = path.join(videoDir, 'meta.json');

  try {
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);

    if (!meta.subtitleFile) {
      return { success: true, subtitleContent: '', hasSubtitle: false };
    }

    const subtitleContent = await fs.readFile(path.join(videoDir, meta.subtitleFile), 'utf-8');
    return {
      success: true,
      subtitleContent,
      hasSubtitle: !!meta.hasSubtitle
    };
  } catch (error) {
    console.error('Failed to read YouTube subtitle:', error);
    return { success: false, error: String(error) };
  }
});

// 重新获取字幕
ipcMain.handle('knowledge:retry-youtube-subtitle', async (_, videoId: string) => {
  const fs = require('fs/promises');
  const videoDir = path.join(getKnowledgeYoutubeDir(), videoId);
  const metaPath = path.join(videoDir, 'meta.json');

  try {
    // 读取现有 meta
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);

    // 更新状态为处理中
    meta.status = 'processing';
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    // 通知前端状态变化
    win?.webContents.send('knowledge:youtube-video-updated', {
      noteId: videoId,
      status: 'processing'
    });

    // 后台重新下载字幕
    (async () => {
      console.log(`[YouTube] Retrying subtitle download for ${meta.videoId}...`);

      try {
        const { queueSubtitleDownload } = await import('./core/subtitleQueue');
        const subtitleResult = await queueSubtitleDownload(meta.videoId, videoDir);

        if (subtitleResult.success && subtitleResult.subtitleFile) {
          meta.subtitleFile = subtitleResult.subtitleFile;
          meta.hasSubtitle = true;
          meta.status = 'completed';
          console.log(`[YouTube] Subtitle retry succeeded for ${meta.videoId}: ${subtitleResult.subtitleFile}`);
        } else {
          meta.hasSubtitle = false;
          meta.status = 'completed';
          meta.subtitleError = subtitleResult.error || 'No subtitles available';
          console.log(`[YouTube] Subtitle retry failed for ${meta.videoId}: ${subtitleResult.error}`);
        }

        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

        // 通知前端
        win?.webContents.send('knowledge:youtube-video-updated', {
          noteId: videoId,
          status: 'completed',
          hasSubtitle: meta.hasSubtitle
        });
      } catch (err) {
        console.error(`[YouTube] Subtitle retry error for ${meta.videoId}:`, err);
        meta.status = 'completed';
        meta.subtitleError = String(err);
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

        win?.webContents.send('knowledge:youtube-video-updated', {
          noteId: videoId,
          status: 'completed',
          hasSubtitle: false
        });
      }
    })();

    return { success: true };
  } catch (error) {
    console.error('Failed to retry subtitle:', error);
    return { success: false, error: String(error) };
  }
})

// --------- Wander (Random Brainstorm) ---------
ipcMain.handle('wander:get-random', async () => {
  try {
    const items = await getAllKnowledgeItems();
    if (items.length < 3) {
      return items; // Return all if less than 3
    }

    // Fisher-Yates shuffle
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }

    return items.slice(0, 3);
  } catch (error) {
    console.error('Failed to get random wander items:', error);
    return [];
  }
});

ipcMain.handle('wander:brainstorm', async (_, items: any[]) => {
  try {
    // 使用 OpenAI 直接 API 调用，不再依赖 LangChain
    const settings = getSettings() as { api_key?: string; api_endpoint?: string; model_name?: string } | undefined;
    if (!settings?.api_key) {
      return { error: 'API Key not configured' };
    }

    const baseURL = settings.api_endpoint || 'https://api.openai.com/v1';
    const model = settings.model_name || 'gpt-4o';

    const itemsText = items.map((item, index) =>
      `Item ${index + 1}:
Title: ${item.title}
Type: ${item.type}
Content Summary: ${item.content?.slice(0, 500) || ''}...`
    ).join('\n\n');

    // 使用 OpenAI Chat API 进行结构化输出
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.api_key}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: WANDER_BRAINSTORM_PROMPT },
          { role: 'user', content: `这里是 3 个条目：\n\n${itemsText}` }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices?: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content || '{}';

    // 解析 JSON 结果
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = { content_direction: content, thinking_process: [], topic: { title: '', connections: [] } };
    }

    // 保存到历史记录
    const { saveWanderHistory } = await import('./db');
    const historyId = `wander-${Date.now()}`;
    saveWanderHistory(historyId, items, result);

    return { result: JSON.stringify(result), historyId };
  } catch (error) {
    console.error('Failed to brainstorm:', error);
    return { error: String(error) };
  }
});

// --------- Embedding & Similarity ---------
ipcMain.handle('embedding:compute', async (_, text: string) => {
  try {
    const embedding = await embeddingService.embedQuery(text);
    return { success: true, embedding };
  } catch (error) {
    console.error('Failed to compute embedding:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('embedding:get-sorted-sources', async (_, embedding: number[]) => {
  try {
    const { getSimilaritySortedSourceIds } = await import('./db');
    const sorted = getSimilaritySortedSourceIds(embedding);
    return { success: true, sorted };
  } catch (error) {
    console.error('Failed to get sorted sources:', error);
    return { success: false, error: String(error) };
  }
});

// 批量重建知识库索引
ipcMain.handle('embedding:rebuild-all', async () => {
  try {
    const items = await getAllKnowledgeItems();
    let indexed = 0;

    for (const item of items) {
      // 将 WanderItem 转换为 KnowledgeItem 格式
      const knowledgeItem = {
        id: item.id,
        sourceId: item.id,
        title: item.title,
        content: item.content,
        sourceType: item.type as 'note' | 'video' | 'file',
        scope: 'user' as const,
        displayData: {
          coverUrl: item.cover
        }
      };

      indexManager.addToQueue(knowledgeItem);
      indexed++;
    }

    return { success: true, queued: indexed };
  } catch (error) {
    console.error('Failed to rebuild embeddings:', error);
    return { success: false, error: String(error) };
  }
});

// 获取索引状态
ipcMain.handle('embedding:get-status', async () => {
  return indexManager.getStatus();
});

// 获取稿件缓存的 embedding
ipcMain.handle('embedding:get-manuscript-cache', async (_, filePath: string) => {
  try {
    const { getManuscriptEmbedding } = await import('./db');
    const cached = getManuscriptEmbedding(filePath);
    return { success: true, cached };
  } catch (error) {
    console.error('Failed to get manuscript embedding cache:', error);
    return { success: false, error: String(error) };
  }
});

// 保存稿件的 embedding
ipcMain.handle('embedding:save-manuscript-cache', async (_, { filePath, contentHash, embedding }: { filePath: string; contentHash: string; embedding: number[] }) => {
  try {
    const { saveManuscriptEmbedding } = await import('./db');
    saveManuscriptEmbedding(filePath, contentHash, embedding);
    return { success: true };
  } catch (error) {
    console.error('Failed to save manuscript embedding cache:', error);
    return { success: false, error: String(error) };
  }
});

// 获取相似度排序缓存
ipcMain.handle('similarity:get-cache', async (_, manuscriptId: string) => {
  try {
    const { getSimilarityCache, getKnowledgeVersion } = await import('./db');
    const cache = getSimilarityCache(manuscriptId);
    const currentVersion = getKnowledgeVersion();
    return { success: true, cache, currentKnowledgeVersion: currentVersion };
  } catch (error) {
    console.error('Failed to get similarity cache:', error);
    return { success: false, error: String(error) };
  }
});

// 保存相似度排序缓存
ipcMain.handle('similarity:save-cache', async (_, cache: { manuscriptId: string; contentHash: string; knowledgeVersion: number; sortedIds: string[] }) => {
  try {
    const { saveSimilarityCache } = await import('./db');
    saveSimilarityCache(cache);
    return { success: true };
  } catch (error) {
    console.error('Failed to save similarity cache:', error);
    return { success: false, error: String(error) };
  }
});

// 获取当前知识库版本
ipcMain.handle('similarity:get-knowledge-version', async () => {
  const { getKnowledgeVersion } = await import('./db');
  return getKnowledgeVersion();
});

// --------- Wander History ---------
ipcMain.handle('wander:list-history', async () => {
  const { listWanderHistory } = await import('./db');
  return listWanderHistory();
});

ipcMain.handle('wander:get-history', async (_, id: string) => {
  const { getWanderHistory } = await import('./db');
  return getWanderHistory(id);
});

ipcMain.handle('wander:delete-history', async (_, id: string) => {
  const { deleteWanderHistory } = await import('./db');
  deleteWanderHistory(id);
  return { success: true };
});

// --------- Archives (Profiles & Samples) ---------
const buildExcerpt = (content?: string, maxLength = 120) => {
  if (!content) return '';
  const trimmed = content.replace(/\s+/g, ' ').trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
};

const downloadImageToFile = async (url: string, outputPath: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const fs = require('fs/promises');
  await fs.writeFile(outputPath, buffer);
};

const downloadFile = async (url: string, outputPath: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  
  // 尝试使用流式写入以节省内存
  try {
    const { pipeline } = require('node:stream/promises');
    const { Readable } = require('node:stream');
    const fs = require('node:fs');
    
    // @ts-ignore - Readable.fromWeb is available in Node 18+ (Electron usually has it)
    if (response.body && Readable.fromWeb) {
      // @ts-ignore
      const nodeStream = Readable.fromWeb(response.body);
      const fileStream = fs.createWriteStream(outputPath);
      await pipeline(nodeStream, fileStream);
      return;
    }
  } catch (e) {
    console.warn('Stream download failed, falling back to buffer:', e);
  }

  // 回退到 Buffer 模式
  const buffer = Buffer.from(await response.arrayBuffer());
  const fs = require('fs/promises');
  await fs.writeFile(outputPath, buffer);
};

const transcribeVideoToText = async (videoPath: string): Promise<string | null> => {
  const settings = getSettings() as {
    api_endpoint?: string;
    api_key?: string;
    transcription_model?: string;
    transcription_endpoint?: string;
    transcription_key?: string;
  } | undefined;
  const endpoint = settings?.transcription_endpoint || settings?.api_endpoint;
  const apiKey = settings?.transcription_key || settings?.api_key;
  if (!endpoint || !apiKey) {
    console.warn('[Transcription] API not configured, skipping transcription');
    return null;
  }

  try {
    const fs = require('fs');

    // 使用 fetch 直接调用 API，无需 LangChain
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(videoPath);
    const blob = new Blob([fileBuffer], { type: 'audio/mp4' }); // Adjust type if needed, but blob usually sufficient
    formData.append('file', blob, 'audio.mp4');
    formData.append('model', settings.transcription_model || 'whisper-1');

    const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        body: formData
    };

    // Handle standard OpenAI structure
    const url = endpoint.endsWith('/') ? `${endpoint}audio/transcriptions` : `${endpoint}/audio/transcriptions`;

    // Compatibility fix: some custom endpoints might require different paths
    // But assuming standard OpenAI-compatible API for now.

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Transcription API failed: ${response.status} ${response.statusText} - ${errText}`);
    }

    const data = await response.json() as { text?: string };
    const text = data.text || '';
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;

  } catch (error) {
    console.error('[Transcription] Failed to transcribe video:', error);
    return null;
  }
};

const sanitizeFilenameSegment = (value: string) => {
  return value.replace(/[^a-zA-Z0-9-_]/g, '_');
};

const getArchiveDir = () => {
  const baseDir = getWorkspacePaths().base;
  return path.join(baseDir, 'archives');
};

const extractTagsFromText = (title = '', content = '') => {
  const tags = new Set<string>();
  const hashtagRegex = /#([^#\s]{1,20})#/g;
  const looseHashtagRegex = /#([^\s#]{1,20})/g;

  [title, content].forEach((text) => {
    let match;
    while ((match = hashtagRegex.exec(text))) {
      tags.add(match[1].trim());
    }
    while ((match = looseHashtagRegex.exec(text))) {
      tags.add(match[1].trim());
    }
  });

  title
    .split(/[\s,，。！？!?.、/|;；:：()\[\]【】]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 2 && chunk.length <= 12)
    .forEach((chunk) => tags.add(chunk));

  return Array.from(tags).filter(Boolean).slice(0, 6);
};

ipcMain.handle('archives:list', async () => {
  return listArchiveProfiles();
});

ipcMain.handle('archives:create', async (_, data: {
  name: string;
  platform?: string;
  goal?: string;
  domain?: string;
  audience?: string;
  toneTags?: string[];
}) => {
  const id = `archive_${Date.now()}`;
  return createArchiveProfile({
    id,
    name: data.name,
    platform: data.platform || '',
    goal: data.goal || '',
    domain: data.domain || '',
    audience: data.audience || '',
    tone_tags: data.toneTags || []
  });
});

ipcMain.handle('archives:update', async (_, data: {
  id: string;
  name: string;
  platform?: string;
  goal?: string;
  domain?: string;
  audience?: string;
  toneTags?: string[];
}) => {
  return updateArchiveProfile({
    id: data.id,
    name: data.name,
    platform: data.platform || '',
    goal: data.goal || '',
    domain: data.domain || '',
    audience: data.audience || '',
    tone_tags: data.toneTags || []
  });
});

ipcMain.handle('archives:delete', async (_, profileId: string) => {
  deleteArchiveProfile(profileId);
  return { success: true };
});

ipcMain.handle('archives:samples:list', async (_, profileId: string) => {
  return listArchiveSamples(profileId);
});

ipcMain.handle('archives:samples:create', async (_, data: {
  profileId: string;
  title?: string;
  content?: string;
  tags?: string[];
  platform?: string;
  sourceUrl?: string;
  sampleDate?: string;
  isFeatured?: boolean;
}) => {
  const id = `sample_${Date.now()}`;
  const tags = data.tags && data.tags.length > 0
    ? data.tags
    : extractTagsFromText(data.title || '', data.content || '');
  return createArchiveSample({
    id,
    profile_id: data.profileId,
    title: data.title || '',
    content: data.content || '',
    excerpt: buildExcerpt(data.content),
    tags,
    images: [],
    platform: data.platform || '',
    source_url: data.sourceUrl || '',
    sample_date: data.sampleDate || new Date().toISOString().slice(0, 10),
    is_featured: data.isFeatured ? 1 : 0
  });

  // Index the new sample
  // Fetch profile to get platform info
  const profiles = listArchiveProfiles();
  const profile = profiles.find(p => p.id === data.profileId) || { platform: data.platform };

  // Construct sample object for normalization (matching ArchiveSample interface approximately)
  const sampleObj = {
    id,
    profile_id: data.profileId,
    title: data.title,
    content: data.content,
    platform: data.platform,
    source_url: data.sourceUrl,
    sample_date: data.sampleDate,
    images: [], // Images not indexed for now
    created_at: Date.now()
  };

  indexManager.addToQueue(normalizeArchiveSample(sampleObj, profile));
});

ipcMain.handle('archives:samples:update', async (_, data: {
  id: string;
  profileId: string;
  title?: string;
  content?: string;
  tags?: string[];
  platform?: string;
  sourceUrl?: string;
  sampleDate?: string;
  isFeatured?: boolean;
}) => {
  const tags = data.tags && data.tags.length > 0
    ? data.tags
    : extractTagsFromText(data.title || '', data.content || '');
  const existingSamples = listArchiveSamples(data.profileId);
  const existingSample = existingSamples.find(sample => sample.id === data.id);
  const result = updateArchiveSample({
    id: data.id,
    profile_id: data.profileId,
    title: data.title || '',
    content: data.content || '',
    excerpt: buildExcerpt(data.content),
    tags,
    images: existingSample?.images || [],
    platform: data.platform || '',
    source_url: data.sourceUrl || '',
    sample_date: data.sampleDate || new Date().toISOString().slice(0, 10),
    is_featured: data.isFeatured ? 1 : 0
  });

  // Re-index the updated sample
  const profiles = listArchiveProfiles();
  const profile = profiles.find(p => p.id === data.profileId) || { platform: data.platform };

  const sampleObj = {
    id: data.id,
    profile_id: data.profileId,
    title: data.title,
    content: data.content,
    platform: data.platform,
    source_url: data.sourceUrl,
    sample_date: data.sampleDate,
    created_at: Date.now()
  };

  indexManager.addToQueue(normalizeArchiveSample(sampleObj, profile));

  return result;
});

ipcMain.handle('archives:samples:delete', async (_, sampleId: string) => {
  deleteArchiveSample(sampleId);
  return { success: true };
});

// --------- Vector Indexing Management ---------
// Forward status events to renderer
indexManager.on('status-update', (status) => {
  if (win) {
    win.webContents.send('indexing:status', status);
  }
});

ipcMain.handle('indexing:get-stats', async () => {
  return indexManager.getStatus();
});

ipcMain.handle('indexing:remove-item', async (_, itemId: string) => {
  indexManager.removeItem(itemId);
  return { success: true };
});

ipcMain.handle('indexing:clear-queue', async () => {
  indexManager.clearQueue();
  return { success: true };
});

ipcMain.handle('indexing:rebuild-all', async () => {
  const fs = require('fs/promises');

  // 1. Clear existing
  await indexManager.clearAndRebuild();

  // 2. Scan and re-add all items
  // (1) Knowledge Redbook
  try {
    const redbookDir = getKnowledgeRedbookDir();
    const dirs = await fs.readdir(redbookDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const metaPath = path.join(redbookDir, dir.name, 'meta.json');
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);

        indexManager.addToQueue(normalizeNote(
          dir.name,
          meta,
          meta.content || meta.transcript || ''
        ));
      } catch {}
    }
  } catch {}

  // (2) Knowledge YouTube
  try {
    const youtubeDir = getKnowledgeYoutubeDir();
    const dirs = await fs.readdir(youtubeDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const metaPath = path.join(youtubeDir, dir.name, 'meta.json');
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);

        let content = meta.description || '';
        if (meta.subtitleFile) {
           try {
             const subtitle = await fs.readFile(path.join(youtubeDir, dir.name, meta.subtitleFile), 'utf-8');
             content += `\n\n${subtitle}`;
           } catch {}
        }

        indexManager.addToQueue(normalizeVideo(
          dir.name,
          meta,
          content,
          'user'
        ));
      } catch {}
    }
  } catch {}

  // (3) Archives
  try {
    const archiveDir = getArchiveDir();
    const profiles = listArchiveProfiles();
    for (const profile of profiles) {
      const samples = listArchiveSamples(profile.id);
      for (const sample of samples) {
        indexManager.addToQueue(normalizeArchiveSample(sample, profile));
      }
    }
  } catch {}

  // (4) Advisors Knowledge (Local Files & Videos)
  try {
    const advisorsDir = getWorkspacePaths().advisors;
    const advisors = await fs.readdir(advisorsDir, { withFileTypes: true });

    for (const advisor of advisors) {
      if (!advisor.isDirectory()) continue;
      const advisorId = advisor.name;
      const knowledgeDir = path.join(advisorsDir, advisorId, 'knowledge');
      const configPath = path.join(advisorsDir, advisorId, 'config.json');

      // 1. Local Files
      try {
        const files = await fs.readdir(knowledgeDir);
        for (const file of files) {
          // Skip if it looks like a YouTube video ID (handled below via config)
          // actually, downloadVideo saves as {videoId}.txt, so we can just index all txt/md
          if (file.endsWith('.txt') || file.endsWith('.md')) {
            const content = await fs.readFile(path.join(knowledgeDir, file), 'utf-8');
            const fileId = `${advisorId}_${file}`;
            indexManager.addToQueue(normalizeFile(fileId, file, content, 'advisor', advisorId));
          }
        }
      } catch {}

      // 2. YouTube Videos (via config.json)
      try {
        const configRaw = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configRaw);
        if (config.videos) {
          for (const video of config.videos) {
            if (video.status === 'success' && video.subtitleFile) {
              const subtitlePath = path.join(knowledgeDir, video.subtitleFile);
              try {
                const transcript = await fs.readFile(subtitlePath, 'utf-8');
                // Use normalizeVideo but force scope='advisor'
                indexManager.addToQueue(normalizeVideo(
                  video.id,
                  { ...video, videoId: video.id },
                  transcript,
                  'advisor',
                  advisorId
                ));
              } catch {}
            }
          }
        }
      } catch {}
    }
  } catch {}

  return { success: true };
});

ipcMain.handle('indexing:rebuild-advisor', async (_, advisorId: string) => {
  const fs = require('fs/promises');
  const advisorsDir = getWorkspacePaths().advisors;
  const advisorDir = path.join(advisorsDir, advisorId);
  const knowledgeDir = path.join(advisorDir, 'knowledge');
  const configPath = path.join(advisorDir, 'config.json');

  // 1. Remove existing vectors for this advisor
  // Note: We need a way to delete by advisorId.
  // Current DB deleteVectors takes sourceId.
  // We can iterate and delete, or just rely on overwrite since IDs are deterministic.
  // To be safe and clean, we should ideally support deleteByAdvisorId, but overwrite is fine for "rebuild".

  // 2. Index Local Files
  try {
    const files = await fs.readdir(knowledgeDir);
    for (const file of files) {
      if (file.endsWith('.txt') || file.endsWith('.md')) {
        const content = await fs.readFile(path.join(knowledgeDir, file), 'utf-8');
        const fileId = `${advisorId}_${file}`;
        indexManager.addToQueue(normalizeFile(fileId, file, content, 'advisor', advisorId));
      }
    }
  } catch (e) {
    console.warn(`[IndexAdvisor] No local files for ${advisorId}`);
  }

  // 3. Index YouTube Videos
  try {
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configRaw);
    if (config.videos) {
      for (const video of config.videos) {
        if (video.status === 'success' && video.subtitleFile) {
          const subtitlePath = path.join(knowledgeDir, video.subtitleFile);
          try {
            const transcript = await fs.readFile(subtitlePath, 'utf-8');
            indexManager.addToQueue(normalizeVideo(
              video.id,
              { ...video, videoId: video.id },
              transcript,
              'advisor',
              advisorId
            ));
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn(`[IndexAdvisor] No config/videos for ${advisorId}`);
  }

  return { success: true };
});

// --------- Local HTTP Server for Plugin Integration ---------
import http from 'http'

const HTTP_PORT = 23456;
let httpServer: http.Server | null = null;

function startHttpServer() {
  const fs = require('fs/promises');

  httpServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/api/save-text") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          const noteId = `text_${Date.now()}`;
          const noteDir = path.join(getKnowledgeRedbookDir(), noteId);
          await fs.mkdir(noteDir, { recursive: true });

          const meta = {
            id: noteId,
            type: "text",
            title: data.title || "Text Clipping",
            content: data.text || "",
            sourceUrl: data.url || "",
            createdAt: new Date().toISOString(),
            author: "User",
            stats: { likes: 0, collects: 0 },
            images: []
          };

          await fs.writeFile(path.join(noteDir, "meta.json"), JSON.stringify(meta, null, 2));
          await fs.writeFile(path.join(noteDir, "content.md"), data.text || "");

          // Index the text
          indexManager.addToQueue(normalizeNote(noteId, meta, data.text || ""));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, noteId }));

          // Notify renderer
          if (win) win.webContents.send("knowledge-updated");
        } catch (err) {
          console.error("Failed to save text:", err);
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/notes') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const note = JSON.parse(body);
          const noteId = note.noteId || `note_${Date.now()}`;
          const noteDir = path.join(getKnowledgeRedbookDir(), noteId);

          await fs.mkdir(noteDir, { recursive: true });

          // Save meta.json
          const noteContent = note.content || note.text || note.noteText || '';
          const meta: { title: string; author: string; content: string; stats: { likes: number; collects?: number }; images: string[]; cover?: string; video?: string; videoUrl?: string; transcript?: string; transcriptFile?: string; createdAt: string } = {
            title: note.title || '无标题',
            author: note.author || '未知',
            content: noteContent || '',
            stats: note.stats || { likes: 0, collects: 0 },
            images: [],
            createdAt: new Date().toISOString(),
          };

          // Save cover if provided
          if (note.coverUrl && typeof note.coverUrl === 'string') {
            const imagesDir = path.join(noteDir, 'images');
            await fs.mkdir(imagesDir, { recursive: true });
            const coverPath = path.join(imagesDir, 'cover.jpg');
            try {
              if (note.coverUrl.startsWith('data:image')) {
                const base64Data = note.coverUrl.split(',')[1];
                await fs.writeFile(coverPath, Buffer.from(base64Data, 'base64'));
              } else if (note.coverUrl.startsWith('http')) {
                await downloadImageToFile(note.coverUrl, coverPath);
              }
              meta.cover = 'images/cover.jpg';
              meta.images.push(meta.cover);
            } catch (error) {
              console.error('Failed to download cover:', error);
            }
          }

          // Save images if provided
          if (note.images && Array.isArray(note.images)) {
            const imagesDir = path.join(noteDir, 'images');
            await fs.mkdir(imagesDir, { recursive: true });

            for (let i = 0; i < note.images.length; i++) {
              const imgData = note.images[i];
              const imgPath = path.join(imagesDir, `${i}.jpg`);
              if (imgData.startsWith('data:image')) {
                const base64Data = imgData.split(',')[1];
                await fs.writeFile(imgPath, Buffer.from(base64Data, 'base64'));
                meta.images.push(`images/${i}.jpg`);
              } else if (imgData.startsWith('http')) {
                try {
                  await downloadImageToFile(imgData, imgPath);
                  meta.images.push(`images/${i}.jpg`);
                } catch (error) {
                  console.error('Failed to download image:', error);
                  meta.images.push(imgData);
                }
              }
            }
          }

          // Save video if provided
          if (note.videoUrl && typeof note.videoUrl === 'string') {
            try {
              const videoName = 'video.mp4';
              const videoPath = path.join(noteDir, videoName);
              await downloadFile(note.videoUrl, videoPath);
              meta.video = videoName;
              meta.videoUrl = note.videoUrl;
            } catch (error) {
              console.error('Failed to download video:', error);
            }
          }

          const metaPath = path.join(noteDir, 'meta.json');
          await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
          await fs.writeFile(path.join(noteDir, 'content.md'), noteContent || '');

          // Index the note
          indexManager.addToQueue(normalizeNote(noteId, meta, noteContent || ''));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, noteId }));

          // Notify main window
          win?.webContents.send('knowledge:new-note', { noteId, title: meta.title });

          // Background transcription for video notes
          if (meta.video) {
            (async () => {
              const videoPath = path.join(noteDir, meta.video as string);
              const transcript = await transcribeVideoToText(videoPath);
              if (transcript) {
                meta.transcript = transcript;
                meta.transcriptFile = 'transcript.txt';
                await fs.writeFile(path.join(noteDir, meta.transcriptFile), transcript);
                await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

                // Index the transcript
                indexManager.addToQueue(normalizeVideo(
                  noteId,
                  meta,
                  transcript,
                  'user'
                ));

                win?.webContents.send('knowledge:note-updated', { noteId, hasTranscript: true });
              }
            })().catch((err) => {
              console.error('Failed to transcribe video:', err);
            });
          }
        } catch (error) {
          console.error('Failed to save note:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/api/archives') {
      const profiles = listArchiveProfiles().map((profile) => ({
        id: profile.id,
        name: profile.name,
        platform: profile.platform || '',
        goal: profile.goal || ''
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, profiles }));
    } else if (req.method === 'POST' && req.url === '/api/archives/samples') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const profiles = listArchiveProfiles();
          let profileId = payload.profileId as string | undefined;
          if (!profileId && profiles.length === 1) {
            profileId = profiles[0].id;
          }
          if (!profileId || !profiles.find(profile => profile.id === profileId)) {
            throw new Error('未找到可用的档案，请先在桌面端创建档案');
          }

          const title = payload.title || '未命名笔记';
          const content = payload.content || '';
          const archiveDir = getArchiveDir();
          await fs.mkdir(archiveDir, { recursive: true });
          const sampleId = `sample_${Date.now()}`;
          const sampleDir = path.join(archiveDir, sanitizeFilenameSegment(profileId), sanitizeFilenameSegment(sampleId));
          const sampleImagesDir = path.join(sampleDir, 'images');
          await fs.mkdir(sampleImagesDir, { recursive: true });
          const imagePaths: string[] = [];

          if (payload.images && Array.isArray(payload.images)) {
            for (let i = 0; i < payload.images.length; i++) {
              const imgUrl = payload.images[i];
              if (!imgUrl || typeof imgUrl !== 'string') continue;
              const imgPath = path.join(sampleImagesDir, `${i}.jpg`);
              if (imgUrl.startsWith('data:image')) {
                const base64Data = imgUrl.split(',')[1];
                await fs.writeFile(imgPath, Buffer.from(base64Data, 'base64'));
                imagePaths.push(path.relative(archiveDir, imgPath));
              } else if (imgUrl.startsWith('http')) {
                try {
                  await downloadImageToFile(imgUrl, imgPath);
                  imagePaths.push(path.relative(archiveDir, imgPath));
                } catch (error) {
                  console.error('Failed to download archive image:', error);
                }
              }
            }
          }

          const sample = createArchiveSample({
            id: sampleId,
            profile_id: profileId,
            title,
            content,
            excerpt: buildExcerpt(content),
            tags: extractTagsFromText(title, content),
            images: imagePaths,
            platform: payload.platform || '小红书',
            source_url: payload.source || '',
            sample_date: new Date().toISOString().slice(0, 10),
            is_featured: payload.isFeatured ? 1 : 0
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sampleId: sample.id }));
          win?.webContents.send('archives:sample-created', { profileId, sampleId: sample.id });

          // Index the new sample
          // Fetch profile to get platform info
          const profile = profiles.find(p => p.id === profileId) || { platform: payload.platform };

          // Construct sample object for normalization (matching ArchiveSample interface approximately)
          const sampleObj = {
            id: sampleId,
            profile_id: profileId,
            title: title,
            content: content,
            platform: payload.platform,
            source_url: payload.source,
            sample_date: payload.sampleDate,
            images: [], // Images not indexed for now
            created_at: Date.now()
          };

          indexManager.addToQueue(normalizeArchiveSample(sampleObj, profile));

        } catch (error) {
          console.error('Failed to save archive sample:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', app: 'RedConvert' }));
    } else if (req.method === 'POST' && req.url === '/api/youtube-notes') {
      // YouTube video save endpoint - 立即返回成功，后台异步处理
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { videoId, videoUrl, title, description, thumbnailUrl } = data;

          if (!videoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Missing videoId' }));
            return;
          }

          await ensureKnowledgeYoutubeDir();
          const noteId = `youtube_${videoId}`;
          const videoDir = path.join(getKnowledgeYoutubeDir(), noteId);
          const metaPath = path.join(videoDir, 'meta.json');

          // ========== 去重检查 ==========
          try {
            await fs.access(metaPath);
            // 文件存在，说明视频已添加过
            console.log(`[YouTube] Video ${videoId} already exists, skipping`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, noteId, duplicate: true, message: '该视频已存在' }));
            return;
          } catch {
            // 文件不存在，继续添加
          }

          await fs.mkdir(videoDir, { recursive: true });

          // 先保存基础 meta.json，状态为 processing
          const initialMeta = {
            id: noteId,
            videoId,
            videoUrl,
            title: title || 'Untitled Video',
            description: description || '',
            thumbnailUrl,
            thumbnail: '',
            subtitleFile: '',
            hasSubtitle: false,
            status: 'processing', // 处理中状态
            createdAt: new Date().toISOString()
          };

          await fs.writeFile(path.join(videoDir, 'meta.json'), JSON.stringify(initialMeta, null, 2));

          // 立即返回成功响应
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, noteId }));

          // 通知前端：新视频已添加（处理中状态）
          win?.webContents.send('knowledge:new-youtube-video', { noteId, title: initialMeta.title, status: 'processing' });

          // ========== 后台异步处理 ==========
          (async () => {
            console.log(`[YouTube] Starting background processing for ${videoId}`);
            let localThumbnail = '';
            let subtitleFile = '';
            let hasSubtitle = false;

            // 1. 下载缩略图
            if (thumbnailUrl) {
              try {
                const thumbnailPath = path.join(videoDir, 'thumbnail.jpg');
                await downloadImageToFile(thumbnailUrl, thumbnailPath);
                localThumbnail = 'thumbnail.jpg';
                console.log(`[YouTube] Thumbnail downloaded for ${videoId}`);
              } catch (err) {
                console.error('[YouTube] Failed to download thumbnail:', err);
              }
            }

            // 2. 下载字幕
            try {
              const { queueSubtitleDownload } = await import('./core/subtitleQueue');
              console.log(`[YouTube] Downloading subtitle for ${videoId}...`);
              const subtitleResult = await queueSubtitleDownload(videoId, videoDir);
              if (subtitleResult.success && subtitleResult.subtitleFile) {
                subtitleFile = subtitleResult.subtitleFile;
                hasSubtitle = true;
                console.log(`[YouTube] Subtitle downloaded for ${videoId}: ${subtitleFile}`);
              } else {
                console.log(`[YouTube] No subtitle available for ${videoId}`);
              }
            } catch (err) {
              console.error('[YouTube] Failed to download subtitle:', err);
            }

            // 3. 更新 meta.json 为完成状态
            const finalMeta = {
              ...initialMeta,
              thumbnail: localThumbnail,
              subtitleFile,
              hasSubtitle,
              status: 'completed' // 处理完成
            };

            await fs.writeFile(path.join(videoDir, 'meta.json'), JSON.stringify(finalMeta, null, 2));
            console.log(`[YouTube] Processing completed for ${videoId}`);

            // 通知前端：视频处理完成
            win?.webContents.send('knowledge:youtube-video-updated', {
              noteId,
              status: 'completed',
              hasSubtitle,
              thumbnail: localThumbnail
            });
          })().catch(err => {
            console.error(`[YouTube] Background processing failed for ${videoId}:`, err);
            // 更新状态为失败
            fs.writeFile(
              path.join(videoDir, 'meta.json'),
              JSON.stringify({ ...initialMeta, status: 'failed', error: String(err) }, null, 2)
            ).catch(() => {});
            win?.webContents.send('knowledge:youtube-video-updated', { noteId, status: 'failed' });
          });

        } catch (error) {
          console.error('Failed to save YouTube video:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    try {
      console.log(`HTTP Server running at http://127.0.0.1:${HTTP_PORT}`);
    } catch {}
  });

  httpServer.on('error', (err) => {
    try {
      console.error('HTTP Server error:', err);
    } catch {}
  });
}

app.whenReady().then(() => {
  ensureKnowledgeRedbookDir();
  ensureKnowledgeYoutubeDir();
  startHttpServer();
});
