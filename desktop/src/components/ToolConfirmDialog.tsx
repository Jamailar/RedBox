import { AlertTriangle, Terminal, FileEdit, Info, X, Check } from 'lucide-react';
import { clsx } from 'clsx';

interface ToolConfirmDialogProps {
    request: ToolConfirmRequest | null;
    onConfirm: (callId: string) => void;
    onCancel: (callId: string) => void;
}

const TYPE_ICONS = {
    exec: Terminal,
    edit: FileEdit,
    info: Info,
};

const TYPE_COLORS = {
    exec: 'border-yellow-500/50 bg-yellow-500/5',
    edit: 'border-blue-500/50 bg-blue-500/5',
    info: 'border-gray-500/50 bg-gray-500/5',
};

export function ToolConfirmDialog({ request, onConfirm, onCancel }: ToolConfirmDialogProps) {
    if (!request) return null;

    const Icon = TYPE_ICONS[request.details.type] || AlertTriangle;
    const colorClass = TYPE_COLORS[request.details.type] || TYPE_COLORS.info;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className={clsx(
                "w-full max-w-lg mx-4 rounded-xl border-2 shadow-2xl overflow-hidden",
                colorClass
            )}>
                {/* Header */}
                <div className="px-6 py-4 bg-surface-secondary border-b border-border flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-surface-primary">
                        <Icon className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-semibold text-text-primary">
                            {request.details.title}
                        </h3>
                        <p className="text-xs text-text-tertiary">
                            Tool: <span className="font-mono text-accent-primary">{request.name}</span>
                        </p>
                    </div>
                </div>

                {/* Content */}
                <div className="px-6 py-4 bg-surface-primary">
                    <div className="space-y-4">
                        {/* Description */}
                        <div className="text-sm text-text-secondary whitespace-pre-wrap font-mono bg-surface-secondary p-3 rounded-lg border border-border max-h-48 overflow-auto">
                            {request.details.description}
                        </div>

                        {/* Impact Warning */}
                        {request.details.impact && (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                                    {request.details.impact}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="px-6 py-4 bg-surface-secondary border-t border-border flex items-center justify-end gap-3">
                    <button
                        onClick={() => onCancel(request.callId)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary bg-surface-primary border border-border rounded-lg hover:bg-surface-secondary transition-colors"
                    >
                        <X className="w-4 h-4" />
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(request.callId)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/90 rounded-lg transition-colors"
                    >
                        <Check className="w-4 h-4" />
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}
