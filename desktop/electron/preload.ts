import { ipcRenderer, contextBridge } from 'electron'

// Track active listeners per channel for proper cleanup
const listeners: { [channel: string]: ((...args: unknown[]) => void)[] } = {};

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (...args: unknown[]) => void) {
    // Create wrapper that forwards events
    const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(_event, ...args);
    // Store for cleanup
    if (!listeners[channel]) listeners[channel] = [];
    (listener as unknown as { _wrapper: typeof wrapper })._wrapper = wrapper;
    listeners[channel].push(listener);
    ipcRenderer.on(channel, wrapper);
  },
  off(channel: string, listener: (...args: unknown[]) => void) {
    const wrapper = (listener as unknown as { _wrapper: (...args: unknown[]) => void })._wrapper;
    if (wrapper) {
      ipcRenderer.off(channel, wrapper as Parameters<typeof ipcRenderer.off>[1]);
    }
    if (listeners[channel]) {
      listeners[channel] = listeners[channel].filter(l => l !== listener);
    }
  },
  removeAllListeners(channel: string) {
    ipcRenderer.removeAllListeners(channel);
    delete listeners[channel];
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // Database / Settings
  saveSettings: (settings: unknown) => ipcRenderer.invoke('db:save-settings', settings),
  getSettings: () => ipcRenderer.invoke('db:get-settings'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  // AI (Legacy)
  fetchModels: (config: { apiKey: string, baseURL: string }) => ipcRenderer.invoke('ai:fetch-models', config),
  startChat: (message: string, modelConfig?: unknown) => ipcRenderer.send('ai:start-chat', message, modelConfig),
  cancelChat: () => ipcRenderer.send('ai:cancel'),
  confirmTool: (callId: string, confirmed: boolean) => ipcRenderer.send('ai:confirm-tool', callId, confirmed),

  // New Chat Service (Gemini CLI features)
  chat: {
    send: (data: { sessionId?: string; message: string; displayContent?: string; attachment?: unknown; modelConfig?: unknown }) => ipcRenderer.send('chat:send-message', data),
    cancel: (data?: { sessionId?: string } | string) => ipcRenderer.send('chat:cancel', data),
    confirmTool: (callId: string, confirmed: boolean) => ipcRenderer.send('chat:confirm-tool', { callId, confirmed }),
    getSessions: () => ipcRenderer.invoke('chat:get-sessions'),
    createSession: (title?: string) => ipcRenderer.invoke('chat:create-session', title),
    getOrCreateContextSession: (params: { contextId: string; contextType: string; title: string; initialContext: string }) => ipcRenderer.invoke('chat:getOrCreateContextSession', params),
    deleteSession: (sessionId: string) => ipcRenderer.invoke('chat:delete-session', sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke('chat:get-messages', sessionId),
    clearMessages: (sessionId: string) => ipcRenderer.invoke('chat:clear-messages', sessionId),
    compactContext: (sessionId: string) => ipcRenderer.invoke('chat:compact-context', sessionId),
  },

  redclawRunner: {
    getStatus: () => ipcRenderer.invoke('redclaw:runner-status'),
    start: (payload?: { intervalMinutes?: number; keepAliveWhenNoWindow?: boolean; maxProjectsPerTick?: number }) => ipcRenderer.invoke('redclaw:runner-start', payload || {}),
    stop: () => ipcRenderer.invoke('redclaw:runner-stop'),
    runNow: (payload?: { projectId?: string }) => ipcRenderer.invoke('redclaw:runner-run-now', payload || {}),
    setProject: (payload: { projectId: string; enabled: boolean; prompt?: string }) => ipcRenderer.invoke('redclaw:runner-set-project', payload),
    setConfig: (payload: { intervalMinutes?: number; keepAliveWhenNoWindow?: boolean; maxProjectsPerTick?: number }) => ipcRenderer.invoke('redclaw:runner-set-config', payload || {}),
  },

  // Skills
  listSkills: () => ipcRenderer.invoke('skills:list'),

  // YouTube Import
  checkYtdlp: () => ipcRenderer.invoke('youtube:check-ytdlp'),
  installYtdlp: () => ipcRenderer.invoke('youtube:install'),
  updateYtdlp: () => ipcRenderer.invoke('youtube:update'),
  fetchYoutubeInfo: (channelUrl: string) => ipcRenderer.invoke('advisors:fetch-youtube-info', { channelUrl }),
  downloadYoutubeSubtitles: (params: { channelUrl: string; videoCount: number; advisorId: string }) => ipcRenderer.invoke('advisors:download-youtube-subtitles', params),
  readYoutubeSubtitle: (videoId: string) => ipcRenderer.invoke('knowledge:read-youtube-subtitle', videoId),

  // Video Management
  refreshVideos: (advisorId: string, limit?: number) => ipcRenderer.invoke('advisors:refresh-videos', { advisorId, limit }),
  getVideos: (advisorId: string) => ipcRenderer.invoke('advisors:get-videos', { advisorId }),
  downloadVideo: (advisorId: string, videoId: string) => ipcRenderer.invoke('advisors:download-video', { advisorId, videoId }),
  retryFailedVideos: (advisorId: string) => ipcRenderer.invoke('advisors:retry-failed', { advisorId }),

})
