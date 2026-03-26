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
      saveSettings: (settings: { api_endpoint: string; api_key: string; model_name: string; model_name_wander?: string; model_name_chatroom?: string; model_name_knowledge?: string; model_name_redclaw?: string; workspace_dir?: string; active_space_id?: string; role_mapping?: Record<string, string> | string; transcription_model?: string; transcription_endpoint?: string; transcription_key?: string; embedding_endpoint?: string; embedding_key?: string; embedding_model?: string; ai_sources_json?: string; default_ai_source_id?: string; image_provider?: string; image_endpoint?: string; image_api_key?: string; image_model?: string; image_provider_template?: string; image_aspect_ratio?: string; image_size?: string; image_quality?: string; mcp_servers_json?: string; redclaw_compact_target_tokens?: number; wander_deep_think_enabled?: boolean; chat_max_tokens_default?: number; chat_max_tokens_deepseek?: number }) => Promise<unknown>;
      getSettings: () => Promise<{ api_endpoint: string; api_key: string; model_name: string; model_name_wander?: string; model_name_chatroom?: string; model_name_knowledge?: string; model_name_redclaw?: string; workspace_dir?: string; active_space_id?: string; role_mapping?: string; transcription_model?: string; transcription_endpoint?: string; transcription_key?: string; embedding_endpoint?: string; embedding_key?: string; embedding_model?: string; ai_sources_json?: string; default_ai_source_id?: string; image_provider?: string; image_endpoint?: string; image_api_key?: string; image_model?: string; image_provider_template?: string; image_aspect_ratio?: string; image_size?: string; image_quality?: string; mcp_servers_json?: string; redclaw_compact_target_tokens?: number; wander_deep_think_enabled?: boolean; chat_max_tokens_default?: number; chat_max_tokens_deepseek?: number } | undefined>;
      getAppVersion: () => Promise<string>;
      checkAppUpdate: (force?: boolean) => Promise<{ success: boolean; hasUpdate: boolean; throttled?: boolean; inFlight?: boolean; message?: string; notice?: { currentVersion: string; latestVersion: string; htmlUrl: string; name: string; publishedAt: string; body: string } }>;
      openAppReleasePage: (url?: string) => Promise<{ success: boolean; error?: string }>;
      fetchModels: (config: { apiKey: string, baseURL: string, presetId?: string, protocol?: 'openai' | 'anthropic' | 'gemini', purpose?: 'chat' | 'image' }) => Promise<{ id: string }[]>;
      detectAiProtocol: (config: { baseURL: string; presetId?: string; protocol?: string }) => Promise<{ success: boolean; protocol: 'openai' | 'anthropic' | 'gemini'; error?: string }>;
      testAiConnection: (config: { apiKey: string; baseURL: string; presetId?: string; protocol?: 'openai' | 'anthropic' | 'gemini' }) => Promise<{ success: boolean; protocol: 'openai' | 'anthropic' | 'gemini'; models: Array<{ id: string }>; message: string }>;
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
      getVideos: (advisorId: string) => Promise<{ success: boolean; videos?: VideoEntry[]; youtubeChannel?: { url: string; channelId: string; lastRefreshed?: string; backgroundEnabled?: boolean; refreshIntervalMinutes?: number; subtitleDownloadIntervalSeconds?: number; maxVideosPerRefresh?: number; maxDownloadsPerRun?: number; lastBackgroundRunAt?: string; lastBackgroundError?: string }; error?: string }>;
      downloadVideo: (advisorId: string, videoId: string) => Promise<{ success: boolean; subtitleFile?: string; error?: string }>;
      retryFailedVideos: (advisorId: string) => Promise<{ success: boolean; successCount?: number; failCount?: number; error?: string }>;
      updateAdvisorYoutubeSettings: (advisorId: string, settings: { backgroundEnabled?: boolean; refreshIntervalMinutes?: number; subtitleDownloadIntervalSeconds?: number; maxVideosPerRefresh?: number; maxDownloadsPerRun?: number }) => Promise<{ success: boolean; youtubeChannel?: unknown; error?: string }>;
      getAdvisorYoutubeRunnerStatus: () => Promise<{ success: boolean; status?: { enabled: boolean; isTicking: boolean; tickIntervalMinutes: number; lastTickAt: string | null; nextTickAt: string | null; lastError: string | null }; error?: string }>;
      runAdvisorYoutubeNow: (advisorId?: string) => Promise<{ success: boolean; processed?: number; error?: string }>;

      // Chat Service API
      chat: {
        send: (data: { sessionId?: string; message: string; displayContent?: string; attachment?: unknown; modelConfig?: unknown }) => void;
        pickAttachment: (payload?: { sessionId?: string }) => Promise<{ success?: boolean; canceled?: boolean; error?: string; attachment?: unknown }>;
        cancel: (data?: { sessionId?: string } | string) => void;
        confirmTool: (callId: string, confirmed: boolean) => void;
        getSessions: () => Promise<ChatSession[]>;
        createSession: (title?: string) => Promise<ChatSession>;
        getOrCreateContextSession: (params: { contextId: string; contextType: string; title: string; initialContext: string }) => Promise<ChatSession>;
        deleteSession: (sessionId: string) => Promise<{ success: boolean }>;
        getMessages: (sessionId: string) => Promise<ChatMessage[]>;
        clearMessages: (sessionId: string) => Promise<{ success: boolean }>;
        compactContext: (sessionId: string) => Promise<{ success: boolean; compacted: boolean; message: string; compactRounds?: number; compactUpdatedAt?: string }>;
        getContextUsage: (sessionId: string) => Promise<{
          success: boolean;
          error?: string;
          sessionId?: string;
          contextType?: string;
          messageCount?: number;
          compactBaseMessageCount?: number;
          compactRounds?: number;
          compactUpdatedAt?: string | null;
          estimatedTotalTokens?: number;
          compactSummaryTokens?: number;
          activeHistoryTokens?: number;
          compactThreshold?: number;
          compactRatio?: number;
        }>;
        getRuntimeState: (sessionId: string) => Promise<{
          success: boolean;
          error?: string;
          sessionId?: string;
          isProcessing: boolean;
          partialResponse: string;
          updatedAt: number;
        }>;
      };
      redclawRunner: {
        getStatus: () => Promise<{
          enabled: boolean;
          intervalMinutes: number;
          keepAliveWhenNoWindow: boolean;
          maxProjectsPerTick: number;
          maxAutomationPerTick?: number;
          isTicking: boolean;
          currentProjectId: string | null;
          currentAutomationTaskId?: string | null;
          lastTickAt: string | null;
          nextTickAt: string | null;
          nextMaintenanceAt?: string | null;
          lastError: string | null;
          heartbeat?: {
            enabled: boolean;
            intervalMinutes: number;
            suppressEmptyReport: boolean;
            reportToMainSession: boolean;
            prompt?: string;
            lastRunAt?: string;
            nextRunAt?: string;
            lastDigest?: string;
          };
          scheduledTasks?: Record<string, {
            id: string;
            name: string;
            enabled: boolean;
            mode: 'interval' | 'daily' | 'weekly' | 'once';
            prompt: string;
            projectId?: string;
            intervalMinutes?: number;
            time?: string;
            weekdays?: number[];
            runAt?: string;
            createdAt: string;
            updatedAt: string;
            lastRunAt?: string;
            lastResult?: 'success' | 'error' | 'skipped';
            lastError?: string;
            nextRunAt?: string;
          }>;
          longCycleTasks?: Record<string, {
            id: string;
            name: string;
            enabled: boolean;
            status: 'running' | 'paused' | 'completed';
            objective: string;
            stepPrompt: string;
            projectId?: string;
            intervalMinutes: number;
            totalRounds: number;
            completedRounds: number;
            createdAt: string;
            updatedAt: string;
            lastRunAt?: string;
            lastResult?: 'success' | 'error' | 'skipped';
            lastError?: string;
            nextRunAt?: string;
          }>;
          projectStates: Record<string, {
            projectId: string;
            enabled: boolean;
            prompt?: string;
            lastRunAt?: string;
            lastResult?: 'success' | 'error' | 'skipped';
            lastError?: string;
          }>;
        }>;
        start: (payload?: {
          intervalMinutes?: number;
          keepAliveWhenNoWindow?: boolean;
          maxProjectsPerTick?: number;
          maxAutomationPerTick?: number;
          heartbeatEnabled?: boolean;
          heartbeatIntervalMinutes?: number;
        }) => Promise<unknown>;
        stop: () => Promise<unknown>;
        runNow: (payload?: { projectId?: string }) => Promise<unknown>;
        setProject: (payload: { projectId: string; enabled: boolean; prompt?: string }) => Promise<unknown>;
        setConfig: (payload: {
          intervalMinutes?: number;
          keepAliveWhenNoWindow?: boolean;
          maxProjectsPerTick?: number;
          maxAutomationPerTick?: number;
          heartbeatEnabled?: boolean;
          heartbeatIntervalMinutes?: number;
          heartbeatSuppressEmptyReport?: boolean;
          heartbeatReportToMainSession?: boolean;
          heartbeatPrompt?: string;
        }) => Promise<unknown>;
        listScheduled: () => Promise<{
          success: boolean;
          error?: string;
          tasks: Array<{
            id: string;
            name: string;
            enabled: boolean;
            mode: 'interval' | 'daily' | 'weekly' | 'once';
            prompt: string;
            projectId?: string;
            intervalMinutes?: number;
            time?: string;
            weekdays?: number[];
            runAt?: string;
            createdAt: string;
            updatedAt: string;
            lastRunAt?: string;
            lastResult?: 'success' | 'error' | 'skipped';
            lastError?: string;
            nextRunAt?: string;
          }>;
        }>;
        addScheduled: (payload: {
          name: string;
          mode: 'interval' | 'daily' | 'weekly' | 'once';
          prompt: string;
          projectId?: string;
          intervalMinutes?: number;
          time?: string;
          weekdays?: number[];
          runAt?: string;
          enabled?: boolean;
        }) => Promise<{ success: boolean; error?: string }>;
        removeScheduled: (payload: { taskId: string }) => Promise<{ success: boolean; error?: string }>;
        setScheduledEnabled: (payload: { taskId: string; enabled: boolean }) => Promise<{ success: boolean; error?: string }>;
        runScheduledNow: (payload: { taskId: string }) => Promise<{ success: boolean; error?: string }>;
        listLongCycle: () => Promise<{
          success: boolean;
          error?: string;
          tasks: Array<{
            id: string;
            name: string;
            enabled: boolean;
            status: 'running' | 'paused' | 'completed';
            objective: string;
            stepPrompt: string;
            projectId?: string;
            intervalMinutes: number;
            totalRounds: number;
            completedRounds: number;
            createdAt: string;
            updatedAt: string;
            lastRunAt?: string;
            lastResult?: 'success' | 'error' | 'skipped';
            lastError?: string;
            nextRunAt?: string;
          }>;
        }>;
        addLongCycle: (payload: {
          name: string;
          objective: string;
          stepPrompt: string;
          projectId?: string;
          intervalMinutes?: number;
          totalRounds?: number;
          enabled?: boolean;
        }) => Promise<{ success: boolean; error?: string }>;
        removeLongCycle: (payload: { taskId: string }) => Promise<{ success: boolean; error?: string }>;
        setLongCycleEnabled: (payload: { taskId: string; enabled: boolean }) => Promise<{ success: boolean; error?: string }>;
        runLongCycleNow: (payload: { taskId: string }) => Promise<{ success: boolean; error?: string }>;
      };
      mcp: {
        list: () => Promise<{ success: boolean; servers: Array<{
          id: string;
          name: string;
          enabled: boolean;
          transport: 'stdio' | 'sse' | 'streamable-http';
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          url?: string;
          oauth?: {
            enabled?: boolean;
            tokenPath?: string;
          };
        }> }>;
        save: (servers: unknown[]) => Promise<{ success: boolean; servers?: unknown[]; error?: string }>;
        test: (server: unknown) => Promise<{ success: boolean; message: string; detail?: string }>;
        discoverLocal: () => Promise<{ success: boolean; items: Array<{ sourcePath: string; count: number; servers: unknown[] }>; error?: string }>;
        importLocal: () => Promise<{ success: boolean; imported?: number; total?: number; sources?: string[]; servers?: unknown[]; error?: string }>;
        oauthStatus: (serverId: string) => Promise<{ success: boolean; connected?: boolean; tokenPath?: string; error?: string }>;
      };
    };
  }

  interface SkillDefinition {
    name: string;
    description: string;
    location: string;
    body: string;
    baseDir?: string;
    aliases?: string[];
    sourceScope?: string;
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
