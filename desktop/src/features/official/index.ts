import type { ComponentType } from 'react';
import { hasOfficialAiPanel as generatedHasOfficialAiPanel } from './generatedOfficialAiPanel';

export interface OfficialAiPanelProps {
  onReloadSettings: () => Promise<void> | void;
}

export interface OfficialAiPanelModule {
  default: ComponentType<OfficialAiPanelProps>;
  tabLabel?: string;
}

export const hasOfficialAiPanel = generatedHasOfficialAiPanel;

let cachedOfficialAiPanelPromise: Promise<OfficialAiPanelModule | null> | null = null;

export const loadOfficialAiPanelModule = async (): Promise<OfficialAiPanelModule | null> => {
  if (!cachedOfficialAiPanelPromise) {
    cachedOfficialAiPanelPromise = (async () => {
      try {
        if (!generatedHasOfficialAiPanel) {
          return null;
        }
        const loaded = await import('./generatedOfficialAiPanel');
        return loaded as OfficialAiPanelModule;
      } catch {
        return null;
      }
    })();
  }
  return cachedOfficialAiPanelPromise;
};
