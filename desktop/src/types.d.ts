export { };
// Type definitions
export interface VideoEntry {
  id: string;
  title: string;
  publishedAt: string;
  status: 'pending' | 'downloading' | 'success' | 'failed';
  retryCount: number;
  errorMessage?: string;
  subtitleFile?: string;
}

declare global {
  interface ChatSession {
    id: string;
    title: string;
    updatedAt: string;
  }

  interface ChatMessage {
    id: string;
    session_id: string;
    role: string;
    content: string;
    tool_call_id?: string;
    created_at: string;
  }

  interface Window {
    ipcRenderer: {
      saveSettings: (settings: { api_endpoint: string; api_key: string; model_name: string; workspace_dir?: string; active_space_id?: string; role_mapping?: Record<string, string> | string; transcription_model?: string; transcription_endpoint?: string; transcription_key?: string; embedding_endpoint?: string; embedding_key?: string; embedding_model?: string; image_provider?: string; image_endpoint?: string; image_api_key?: string; image_model?: string; image_size?: string; image_quality?: string }) => Promise<unknown>;
      getSettings: () => Promise<{ api_endpoint: string; api_key: string; model_name: string; workspace_dir?: string; active_space_id?: string; role_mapping?: string; transcription_model?: string; transcription_endpoint?: string; transcription_key?: string; embedding_endpoint?: string; embedding_key?: string; embedding_model?: string; image_provider?: string; image_endpoint?: string; image_api_key?: string; image_model?: string; image_size?: string; image_quality?: string } | undefined>;
      getAppVersion: () => Promise<string>;
      fetchModels: (config: { apiKey: string, baseURL: string }) => Promise<{ id: string }[]>;
      startChat: (message: string, modelConfig?: unknown) => void;
      cancelChat: () => void;
      confirmTool: (callId: string, confirmed: boolean) => void;
      listSkills: () => Promise<SkillDefinition[]>;
      on: (channel: string, func: (...args: any[]) => void) => void;
      off: (channel: string, func: (...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;

      // YouTube Import
      checkYtdlp: () => Promise<{ installed: boolean; version?: string; path?: string }>;
      installYtdlp: () => Promise<{ success: boolean; error?: string }>;
      updateYtdlp: () => Promise<{ success: boolean; error?: string }>;
      fetchYoutubeInfo: (channelUrl: string) => Promise<{ success: boolean; data?: any; error?: string }>;
      downloadYoutubeSubtitles: (params: { channelUrl: string; videoCount: number; advisorId: string }) => Promise<{ success: boolean; successCount?: number; failCount?: number; error?: string }>;
      readYoutubeSubtitle: (videoId: string) => Promise<{ success: boolean; subtitleContent?: string; hasSubtitle?: boolean; error?: string }>;

      // Video Management
      refreshVideos: (advisorId: string, limit?: number) => Promise<{ success: boolean; videos?: VideoEntry[]; error?: string }>;
      getVideos: (advisorId: string) => Promise<{ success: boolean; videos?: VideoEntry[]; youtubeChannel?: { url: string; channelId: string; lastRefreshed: string }; error?: string }>;
      downloadVideo: (advisorId: string, videoId: string) => Promise<{ success: boolean; subtitleFile?: string; error?: string }>;
      retryFailedVideos: (advisorId: string) => Promise<{ success: boolean; successCount?: number; failCount?: number; error?: string }>;

      // Chat Service API
      chat: {
        send: (data: { sessionId?: string; message: string; displayContent?: string; attachment?: unknown; modelConfig?: unknown }) => void;
        cancel: (data?: { sessionId?: string } | string) => void;
        confirmTool: (callId: string, confirmed: boolean) => void;
        getSessions: () => Promise<ChatSession[]>;
        createSession: (title?: string) => Promise<ChatSession>;
        getOrCreateContextSession: (params: { contextId: string; contextType: string; title: string; initialContext: string }) => Promise<ChatSession>;
        deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
        getMessages: (sessionId: string) => Promise<ChatMessage[]>;
        clearMessages: (sessionId: string) => Promise<{ success: boolean }>;
        compactContext: (sessionId: string) => Promise<{ success: boolean; compacted: boolean; message: string; compactRounds?: number; compactUpdatedAt?: string }>;
      };
      redclawRunner: {
        getStatus: () => Promise<{
          enabled: boolean;
          intervalMinutes: number;
          keepAliveWhenNoWindow: boolean;
          maxProjectsPerTick: number;
          isTicking: boolean;
          currentProjectId: string | null;
          lastTickAt: string | null;
          nextTickAt: string | null;
          lastError: string | null;
          projectStates: Record<string, {
            projectId: string;
            enabled: boolean;
            prompt?: string;
            lastRunAt?: string;
            lastResult?: 'success' | 'error' | 'skipped';
            lastError?: string;
          }>;
        }>;
        start: (payload?: { intervalMinutes?: number; keepAliveWhenNoWindow?: boolean; maxProjectsPerTick?: number }) => Promise<unknown>;
        stop: () => Promise<unknown>;
        runNow: (payload?: { projectId?: string }) => Promise<unknown>;
        setProject: (payload: { projectId: string; enabled: boolean; prompt?: string }) => Promise<unknown>;
        setConfig: (payload: { intervalMinutes?: number; keepAliveWhenNoWindow?: boolean; maxProjectsPerTick?: number }) => Promise<unknown>;
      };
    };
  }

  interface SkillDefinition {
    name: string;
    description: string;
    location: string;
    body: string;
    isBuiltin?: boolean;
    disabled?: boolean;
  }

  interface ToolConfirmationDetails {
    type: 'edit' | 'exec' | 'info';
    title: string;
    description: string;
    impact?: string;
  }

  interface ToolConfirmRequest {
    callId: string;
    name: string;
    details: ToolConfirmationDetails;
  }
}
