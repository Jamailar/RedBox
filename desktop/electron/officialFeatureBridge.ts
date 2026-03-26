import type { IpcMain, Shell } from 'electron';

export interface OfficialFeatureSettingsContext {
  getSettings: () => Record<string, unknown> | undefined;
  saveSettings: (settings: Record<string, unknown>) => void;
  normalizeSettingsInput: (settings: Record<string, unknown>) => Record<string, unknown>;
}

export interface OfficialFeatureRegisterContext extends OfficialFeatureSettingsContext {
  ipcMain: IpcMain;
  shell: Shell;
}

export interface OfficialTranscriptionAuthContext {
  endpoint: string;
  apiKey: string;
}

export interface OfficialTranscriptionAuthResult {
  handled: boolean;
  officialGateway?: boolean;
  authMode?: 'api-key' | 'access-token';
  apiKey?: string;
  error?: string;
}

export interface OfficialFeatureModule {
  registerOfficialFeatures?: (context: OfficialFeatureRegisterContext) => Promise<void> | void;
  syncOfficialAiRoutingOnStartup?: (context: OfficialFeatureSettingsContext) => Promise<void> | void;
  prepareOfficialTranscriptionAuth?: (
    context: OfficialTranscriptionAuthContext,
  ) => Promise<OfficialTranscriptionAuthResult> | OfficialTranscriptionAuthResult;
}

let cachedOfficialFeatureModulePromise: Promise<OfficialFeatureModule | null> | null = null;

export const loadOfficialFeatureModule = async (): Promise<OfficialFeatureModule | null> => {
  if (!cachedOfficialFeatureModulePromise) {
    cachedOfficialFeatureModulePromise = (async () => {
      try {
        const modulePath = '../private/electron/registerOfficialFeatures';
        const loaded = await import(modulePath);
        return loaded as OfficialFeatureModule;
      } catch {
        return null;
      }
    })();
  }
  return cachedOfficialFeatureModulePromise;
};
