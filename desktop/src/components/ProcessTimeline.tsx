import React from 'react';
import { Loader2 } from 'lucide-react';

// --- Types ---

export type ProcessItemType = 'phase' | 'thought' | 'tool-call' | 'skill';

export interface ProcessItem {
  id: string;
  type: ProcessItemType;
  title?: string;
  content: string;
  status: 'running' | 'done' | 'failed';
  toolData?: {
    name: string;
    input: unknown;
    output?: string;
  };
  skillData?: {
    name: string;
    description: string;
  };
  duration?: number;
  timestamp: number;
}

// --- Helper: Get user-friendly status text ---

const getStatusText = (items: ProcessItem[]): string => {
  // Find the last running item to determine current action
  const runningItem = [...items].reverse().find(item => item.status === 'running');

  if (!runningItem) {
    return '正在思考...';
  }

  if (runningItem.type === 'thought') {
    return '正在思考...';
  }

  if (runningItem.type === 'tool-call' && runningItem.toolData?.name) {
    const name = runningItem.toolData.name;

    if (name === 'save_memory') return '正在记录...';
    if (name === 'read_file') return '正在查阅...';
    if (name === 'web_search' || name === 'duckduckgo_search') return '正在搜索...';
    if (name === 'write_file' || name === 'edit_file') return '正在编辑...';
    if (name === 'bash' || name === 'run_command') return '正在执行...';
    if (name === 'list_dir' || name === 'explore_workspace') return '正在浏览...';
    if (name === 'grep') return '正在查找...';
    if (name === 'calculator') return '正在计算...';

    return '正在处理...';
  }

  if (runningItem.type === 'skill') {
    return '正在准备...';
  }

  return '正在处理...';
};

// --- Main Component ---

interface ProcessTimelineProps {
  items: ProcessItem[];
  isStreaming?: boolean;
}

export function ProcessTimeline({ items, isStreaming }: ProcessTimelineProps) {
  // Don't show anything if no items or not streaming
  if (!items || items.length === 0) return null;

  // Check if any item is still running
  const hasRunningItem = items.some(item => item.status === 'running');

  // Only show indicator while actively processing
  if (!isStreaming && !hasRunningItem) {
    return null; // Hide completely when done
  }

  const statusText = getStatusText(items);

  return (
    <div className="flex items-center gap-2 py-2 px-1 text-sm text-text-tertiary animate-in fade-in duration-200">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-primary" />
      <span>{statusText}</span>
    </div>
  );
}
