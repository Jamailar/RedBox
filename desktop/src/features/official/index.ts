import type { ComponentType } from 'react';

export interface OfficialAiPanelProps {
  onReloadSettings: () => Promise<void> | void;
}

export interface OfficialAiPanelModule {
  default: ComponentType<OfficialAiPanelProps>;
  tabLabel?: string;
}

export const hasOfficialAiPanel = true;

let cachedOfficialAiPanelPromise: Promise<OfficialAiPanelModule | null> | null = null;

export const loadOfficialAiPanelModule = async (): Promise<OfficialAiPanelModule | null> => {
  if (!cachedOfficialAiPanelPromise) {
    cachedOfficialAiPanelPromise = (async () => {
      try {
        const modulePath = '../../../private/renderer/OfficialAiPanel';
        const loaded = await import(/* @vite-ignore */ modulePath);
        return loaded as OfficialAiPanelModule;
      } catch {
        return null;
      }
    })();
  }
  return cachedOfficialAiPanelPromise;
};
