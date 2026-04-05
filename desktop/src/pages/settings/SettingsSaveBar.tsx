import { Save } from 'lucide-react';

interface SettingsSaveBarProps {
    activeTab: 'general' | 'ai' | 'knowledge' | 'tools' | 'memory' | 'experimental' | 'project';
    status: 'idle' | 'saving' | 'saved' | 'error';
}

export function SettingsSaveBar({ activeTab, status }: SettingsSaveBarProps) {
    if (activeTab !== 'general' && activeTab !== 'ai') {
        return null;
    }

    return (
        <div className="fixed bottom-0 left-48 right-0 p-4 bg-surface-primary border-t border-border flex items-center justify-between z-10 transition-all">
            <div className="text-xs">
                {status === 'saved' && <span className="text-status-success">保存成功</span>}
                {status === 'error' && <span className="text-status-error">保存失败</span>}
            </div>

            <button
                type="submit"
                disabled={status === 'saving'}
                className="flex items-center px-6 py-2 bg-text-primary text-background text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm"
            >
                <Save className="w-4 h-4 mr-2" />
                {status === 'saving' ? '保存中...' : '保存配置'}
            </button>
        </div>
    );
}
