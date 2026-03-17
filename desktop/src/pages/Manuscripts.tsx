import { useEffect, useState, useCallback, useRef } from 'react';
import {
    FolderPlus, FilePlus, ChevronRight,
    File, Folder, Trash2, Edit3, PanelLeft, Edit,
    PanelRight, MessageSquare, Users, BookOpen,
    GitGraph, CheckCircle2, Archive, PenTool, LayoutList, FolderTree
} from 'lucide-react';
import { clsx } from 'clsx';
// Replaced MDEditor with CodeMirrorEditor
import { CodeMirrorEditor } from '../components/manuscripts/CodeMirrorEditor';
import { GraphView } from '../components/manuscripts/GraphView';
// import { Chat } from './Chat';
// import { CreativeChat } from './CreativeChat';
import { Knowledge } from './Knowledge';
import { PendingChatMessage } from '../App';

// ========== Types ==========

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: FileNode[];
    status?: 'writing' | 'completed' | 'abandoned';
}

interface ManuscriptsState {
    tree: FileNode[];
    selectedFile: string | null;
    expandedFolders: Set<string>;
    fileContent: string;
    fileMetadata: any;
    isModified: boolean;
    isLoading: boolean;
    isSaving: boolean;
}

// ========== Component ==========

interface ManuscriptsProps {
    pendingFile?: string | null;
    onFileConsumed?: () => void;
}

export function Manuscripts({ pendingFile, onFileConsumed }: ManuscriptsProps) {
    const [state, setState] = useState<ManuscriptsState>({
        tree: [],
        selectedFile: localStorage.getItem("manuscripts:lastOpenedFile"),
        expandedFolders: new Set(),
        fileContent: '',
        fileMetadata: {},
        isModified: false,
        isLoading: true,
        isSaving: false,
    });

    // 处理从其他页面传入的待打开文件
    useEffect(() => {
        if (pendingFile) {
            setState(prev => ({ ...prev, selectedFile: pendingFile }));
            onFileConsumed?.();
        }
    }, [pendingFile, onFileConsumed]);

    const [viewMode, setViewMode] = useState<'editor' | 'graph'>('editor');
    const [sidebarMode, setSidebarMode] = useState<'folders' | 'status'>('folders'); // New state for sidebar mode

    const [isSidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem("manuscripts:sidebarOpen");
        return saved ? JSON.parse(saved) : true;
    });

    useEffect(() => {
        localStorage.setItem("manuscripts:sidebarOpen", JSON.stringify(isSidebarOpen));
    }, [isSidebarOpen]);

    // Persist selected file
    useEffect(() => {
        if (state.selectedFile) {
            localStorage.setItem("manuscripts:lastOpenedFile", state.selectedFile);
        } else {
            localStorage.removeItem("manuscripts:lastOpenedFile");
        }
    }, [state.selectedFile]);

    // Restore file content on mount
    useEffect(() => {
        if (state.selectedFile && !state.fileContent) {
            window.ipcRenderer.invoke("manuscripts:read", state.selectedFile)
                .then((result: any) => {
                    const content = typeof result === 'string' ? result : result.content;
                    const metadata = typeof result === 'string' ? {} : result.metadata;

                    setState(prev => ({
                        ...prev,
                        fileContent: content || "",
                        fileMetadata: metadata || {},
                        isModified: false
                    }));
                })
                .catch(e => {
                    console.error("Failed to restore file:", e);
                    setState(prev => ({ ...prev, selectedFile: null }));
                });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
    }, [isSidebarOpen]);
    
    // Persistent State Initialization
    const [isRightPanelOpen, setRightPanelOpen] = useState(() => {
        const saved = localStorage.getItem('manuscripts:panelOpen');
        return saved ? JSON.parse(saved) : false;
    });
    
    const [rightPanelWidth, setRightPanelWidth] = useState(() => {
        const saved = localStorage.getItem('manuscripts:panelWidth');
        return saved ? parseInt(saved, 10) : 450;
    });

    const [isDragging, setIsDragging] = useState(false);

    // const [activeRightTab, setActiveRightTab] = useState<'chat' | 'creative' | 'knowledge'>(() => {
    //     const saved = localStorage.getItem('manuscripts:activeTab');
    //     return (saved as 'chat' | 'creative' | 'knowledge') || 'chat';
    // });

    const [pendingChatMsg, setPendingChatMsg] = useState<PendingChatMessage | null>(null);

    const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
        const saved = localStorage.getItem('manuscripts:leftPanelWidth');
        return saved ? parseInt(saved, 10) : 200;
    });
    const [isLeftDragging, setIsLeftDragging] = useState(false);

    // File-Bound Chat Session State
    const [linkedSessionId, setLinkedSessionId] = useState<string | null>(null);

    const [titleValue, setTitleValue] = useState('');
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Persistence Effects
    useEffect(() => {
        localStorage.setItem('manuscripts:panelOpen', JSON.stringify(isRightPanelOpen));
    }, [isRightPanelOpen]);

    useEffect(() => {
        localStorage.setItem('manuscripts:panelWidth', rightPanelWidth.toString());
    }, [rightPanelWidth]);

    useEffect(() => {
        localStorage.setItem('manuscripts:leftPanelWidth', leftPanelWidth.toString());
    }, [leftPanelWidth]);

    // useEffect(() => {
    //     localStorage.setItem('manuscripts:activeTab', activeRightTab);
    // }, [activeRightTab]);

    // Resizing Logic
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isLeftDragging && containerRef.current) {
                // Calculate width relative to the container's left edge
                const containerRect = containerRef.current.getBoundingClientRect();
                const relativeX = e.clientX - containerRect.left;
                const newWidth = Math.max(150, Math.min(400, relativeX));
                setLeftPanelWidth(newWidth);
            } else if (isDragging) {
                const max = window.innerWidth * 0.8;
                const newWidth = Math.max(300, Math.min(max, window.innerWidth - e.clientX));
                setRightPanelWidth(newWidth);
            }
        };
        const handleMouseUp = () => {
            setIsDragging(false);
            setIsLeftDragging(false);
        };

        if (isDragging || isLeftDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isDragging, isLeftDragging]);

    // Load file tree
    const loadTree = useCallback(async () => {
        try {
            const tree = await window.ipcRenderer.invoke('manuscripts:list') as FileNode[];
            setState(prev => ({ ...prev, tree: tree || [], isLoading: false }));
            return tree || [];
        } catch (e) {
            console.error('Failed to load manuscripts tree:', e);
            setState(prev => ({ ...prev, tree: [], isLoading: false }));
            return [];
        }
    }, []);

    useEffect(() => {
        loadTree();
    }, [loadTree]);

    // Sync title with selected file
    useEffect(() => {
        if (state.selectedFile) {
            const name = state.selectedFile.split('/').pop() || '';
            // Remove extension for display if it's .md
            const display = name.endsWith('.md') ? name.slice(0, -3) : name;
            setTitleValue(display);

            // Fetch/Create linked chat session
            // Wait for metadata to be loaded (which contains ID)
            if (state.fileMetadata && state.fileMetadata.id) {
                window.ipcRenderer.invoke('chat:getOrCreateFileSession', {
                    filePath: state.selectedFile,
                    fileId: state.fileMetadata.id
                })
                .then((session: any) => {
                    if (session && session.id) {
                        setLinkedSessionId(session.id);
                    }
                })
                .catch(err => console.error('Failed to get file session:', err));
            } else {
                 // Fallback if no ID yet (should satisfy rare race condition or legacy files)
                 window.ipcRenderer.invoke('chat:getOrCreateFileSession', { filePath: state.selectedFile })
                .then((session: any) => {
                    if (session && session.id) {
                        setLinkedSessionId(session.id);
                    }
                })
                .catch(err => console.error('Failed to get file session:', err));
            }

        } else {
            setTitleValue('');
            setLinkedSessionId(null);
        }
    }, [state.selectedFile, state.fileMetadata?.id]); // Add metadata.id dependency

    // Auto-save
    useEffect(() => {
        if (!state.selectedFile || !state.isModified) return;

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = setTimeout(async () => {
            setState(prev => ({ ...prev, isSaving: true }));
            try {
                await window.ipcRenderer.invoke('manuscripts:save', {
                    path: state.selectedFile,
                    content: state.fileContent,
                    metadata: state.fileMetadata
                });
                setState(prev => ({ ...prev, isModified: false, isSaving: false }));
            } catch (e) {
                console.error('Auto-save failed:', e);
                setState(prev => ({ ...prev, isSaving: false }));
            }
        }, 1000);

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [state.fileContent, state.selectedFile, state.isModified]);

    // File Operations
    const handleSelectFile = async (filePath: string) => {
        if (state.selectedFile === filePath) return;

        // Save previous if modified
        if (state.selectedFile && state.isModified) {
            await window.ipcRenderer.invoke('manuscripts:save', {
                path: state.selectedFile,
                content: state.fileContent,
                metadata: state.fileMetadata
            });
        }

        try {
            const result = await window.ipcRenderer.invoke('manuscripts:read', filePath) as any;
            const content = typeof result === 'string' ? result : result.content;
            const metadata = typeof result === 'string' ? {} : result.metadata;

            setState(prev => ({
                ...prev,
                selectedFile: filePath,
                fileContent: content || '',
                fileMetadata: metadata || {},
                isModified: false
            }));
        } catch (e) {
            console.error('Failed to read file:', e);
        }
    };

    const toggleFolder = (path: string) => {
        setState(prev => {
            const newExpanded = new Set(prev.expandedFolders);
            if (newExpanded.has(path)) newExpanded.delete(path);
            else newExpanded.add(path);
            return { ...prev, expandedFolders: newExpanded };
        });
    };

    const handleCreate = async (type: 'file' | 'folder') => {
        const baseName = type === 'folder' ? "新建文件夹" : "未命名";
        let name = baseName;
        let counter = 1;

        // Check existence in root level
        const existingNames = new Set(state.tree.map(node => node.name));

        while (existingNames.has(type === 'file' ? `${name}.md` : name)) {
             name = `${baseName} (${counter})`;
             counter++;
        }

        try {
            if (type === 'folder') {
                await window.ipcRenderer.invoke('manuscripts:create-folder', { parentPath: '', name: name });
                await loadTree();
            } else {
                const fileName = `${name}.md`;
                const result = await window.ipcRenderer.invoke('manuscripts:create-file', { parentPath: '', name: fileName }) as { success: boolean, path?: string };
                await loadTree();

                if (result.success && result.path) {
                    handleSelectFile(result.path);
                }
            }
        } catch (e) {
            console.error('Create failed:', e);
        }
    };

    const handleDelete = async (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        if (!confirm('Delete this item?')) return;
        try {
            await window.ipcRenderer.invoke('manuscripts:delete', path);
            if (state.selectedFile === path) {
                setState(prev => ({ ...prev, selectedFile: localStorage.getItem("manuscripts:lastOpenedFile"), fileContent: '' }));
            }
            await loadTree();
        } catch (e) {
            console.error('Delete failed:', e);
        }
    };

    const handleTitleRename = async () => {
        if (!state.selectedFile || !titleValue.trim()) return;

        const currentName = state.selectedFile.split('/').pop() || '';
        const currentStem = currentName.endsWith('.md') ? currentName.slice(0, -3) : currentName;

        if (titleValue.trim() === currentStem) return; // No change

        const isMd = currentName.endsWith('.md');
        const newName = isMd ? `${titleValue.trim()}.md` : titleValue.trim();

        try {
            const result = await window.ipcRenderer.invoke('manuscripts:rename', {
                oldPath: state.selectedFile,
                newName: newName
            }) as { success: boolean, newPath?: string };

            if (result.success && result.newPath) {
                setState(prev => ({
                    ...prev,
                    selectedFile: result.newPath!
                }));
            }

            await loadTree();
        } catch (e) {
            console.error('Rename failed:', e);
            // Revert title on error
            setTitleValue(currentStem);
        }
    };

    // const handleNavigateToChat = (msg: any) => {
    //     setPendingChatMsg(msg);
    //     setActiveRightTab('chat');
    //     if (!isRightPanelOpen) {
    //         setRightPanelOpen(true);
    //     }
    // };

    const handleCreateFromGraph = async (name: string, x: number, y: number) => {
        const fileName = name.endsWith('.md') ? name : `${name}.md`;
        try {
            const result = await window.ipcRenderer.invoke('manuscripts:create-file', { parentPath: '', name: fileName }) as { success: boolean, path?: string };

            if (result.success && result.path) {
                const currentLayout = (await window.ipcRenderer.invoke('manuscripts:get-layout') || {}) as Record<string, { x: number, y: number }>;
                await window.ipcRenderer.invoke('manuscripts:save-layout', {
                    ...currentLayout,
                    [result.path]: { x, y }
                });
                await loadTree();
            }
        } catch (e) {
            console.error('Failed to create file from graph:', e);
        }
    };

    const handleRenameNode = async (oldPath: string, newName: string) => {
        const currentName = oldPath.split('/').pop() || '';
        const isMd = currentName.endsWith('.md');
        const finalName = (isMd && !newName.endsWith('.md')) ? `${newName}.md` : newName;

        try {
            const result = await window.ipcRenderer.invoke('manuscripts:rename', {
                oldPath,
                newName: finalName
            }) as { success: boolean, newPath?: string };

            if (result.success) {
                await loadTree();
                // Update selected file if it was renamed
                if (state.selectedFile === oldPath && result.newPath) {
                    setState(prev => ({ ...prev, selectedFile: result.newPath! }));
                }

                // Also update layout if needed?
                // The layout keys are paths. If path changes, we might lose position if we don't migrate it.
                // However, manuscripts:rename implementation in backend doesn't seem to update layout.json automatically.
                // We should probably handle layout migration here.

                const currentLayout = (await window.ipcRenderer.invoke('manuscripts:get-layout') || {}) as Record<string, { x: number, y: number }>;
                if (currentLayout[oldPath]) {
                    // Explicitly cast to object to allow destructuring with spread
                    const layoutObj = currentLayout as Record<string, any>;
                    const { [oldPath]: pos, ...rest } = layoutObj;
                    if (result.newPath) {
                        await window.ipcRenderer.invoke('manuscripts:save-layout', {
                            ...rest,
                            [result.newPath]: pos
                        });
                    }
                }
            }
        } catch (e) {
            console.error('Rename failed:', e);
        }
    };

    // Render Helpers
    const renderNode = (node: FileNode, depth: number = 0) => {
        const isExpanded = state.expandedFolders.has(node.path);
        const isSelected = state.selectedFile === node.path;
        const displayName = node.name.endsWith('.md') ? node.name.slice(0, -3) : node.name;

        // Status indicator color
        let statusColor = "text-text-tertiary";
        if (node.status === 'completed') statusColor = "text-green-500";
        if (node.status === 'abandoned') statusColor = "text-red-400";
        if (node.status === 'writing') statusColor = "text-blue-400";

        return (
            <div key={node.path}>
                <div
                    className={clsx(
                        "flex items-center px-3 py-1.5 text-sm cursor-pointer rounded-md transition-colors group",
                        isSelected ? "bg-accent-primary/10 text-accent-primary font-medium" : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                    )}
                    style={{ paddingLeft: `${depth * 12 + 12}px` }}
                    onClick={() => node.isDirectory ? toggleFolder(node.path) : handleSelectFile(node.path)}
                >
                    {node.isDirectory ? (
                        <>
                            <span className={clsx("mr-1.5 transition-transform", isExpanded && "rotate-90")}>
                                <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                            </span>
                            <Folder className={clsx("w-4 h-4 mr-2", isExpanded ? "text-text-primary" : "text-text-tertiary")} />
                        </>
                    ) : (
                        <>
                            <span className="w-5" />
                            <File className={clsx("w-3.5 h-3.5 mr-2 opacity-50", statusColor)} />
                        </>
                    )}

                    <span className="flex-1 truncate">{displayName}</span>

                    <button
                        onClick={(e) => handleDelete(e, node.path)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 hover:text-red-500 rounded"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>

                {node.isDirectory && isExpanded && node.children && (
                    <div>{node.children.map(child => renderNode(child, depth + 1))}</div>
                )}
            </div>
        );
    };

    const getAllFiles = (nodes: FileNode[]): FileNode[] => {
        let files: FileNode[] = [];
        for (const node of nodes) {
            if (node.isDirectory && node.children) {
                files = [...files, ...getAllFiles(node.children)];
            } else if (!node.isDirectory) {
                files.push(node);
            }
        }
        return files;
    };

    const renderStatusGroup = (title: string, status: string, icon: React.ReactNode, files: FileNode[]) => {
        const isExpanded = state.expandedFolders.has(`status:${status}`);

        return (
            <div key={status} className="mb-2">
                <div
                    className="flex items-center px-3 py-1.5 text-xs font-semibold text-text-tertiary uppercase tracking-wider cursor-pointer hover:text-text-primary"
                    onClick={() => toggleFolder(`status:${status}`)}
                >
                    <span className={clsx("mr-1.5 transition-transform", isExpanded && "rotate-90")}>
                        <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                    <span className="mr-2">{icon}</span>
                    {title} <span className="ml-1 opacity-50">({files.length})</span>
                </div>

                {isExpanded && (
                    <div className="mt-1">
                        {files.map(node => renderNode({ ...node, isDirectory: false }, 0))}
                    </div>
                )}
            </div>
        );
    };

    const renderSidebarContent = () => {
        if (sidebarMode === 'folders') {
            return state.tree.map(node => renderNode(node));
        }

        const allFiles = getAllFiles(state.tree);
        const writing = allFiles.filter(f => !f.status || f.status === 'writing');
        const completed = allFiles.filter(f => f.status === 'completed');
        const abandoned = allFiles.filter(f => f.status === 'abandoned');

        return (
            <div className="py-2">
                {renderStatusGroup('Writing', 'writing', <PenTool className="w-3 h-3" />, writing)}
                {renderStatusGroup('Completed', 'completed', <CheckCircle2 className="w-3 h-3" />, completed)}
                {renderStatusGroup('Abandoned', 'abandoned', <Archive className="w-3 h-3" />, abandoned)}
            </div>
        );
    };

    return (
        <div ref={containerRef} className="flex h-full min-h-0 bg-background overflow-hidden">
            {/* Sidebar */}
            <div
                className={clsx(
                    "flex flex-col border-r border-border bg-surface-secondary/10 overflow-hidden h-full",
                    isSidebarOpen ? "opacity-100" : "w-0 opacity-0 border-r-0"
                )}
                style={{ width: isSidebarOpen ? leftPanelWidth : 0, transition: isLeftDragging ? 'none' : 'width 300ms, opacity 300ms' }}
            >
                <div className="flex flex-col h-full" style={{ width: leftPanelWidth }}>
                    <div className="p-3 border-b border-border flex items-center justify-between">
                        <div className="flex gap-1">
                             <button
                                onClick={() => setSidebarMode(m => m === 'folders' ? 'status' : 'folders')}
                                className={clsx(
                                    "p-1 hover:bg-surface-secondary rounded transition-colors",
                                    sidebarMode === 'status' ? "text-accent-primary bg-accent-primary/10" : "text-text-tertiary"
                                )}
                                title={sidebarMode === 'folders' ? "View by Status" : "View by Folder"}
                            >
                                {sidebarMode === 'folders' ? <FolderTree className="w-4 h-4" /> : <LayoutList className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex gap-1 ml-auto">
                            <button
                                onClick={() => setViewMode(prev => prev === 'editor' ? 'graph' : 'editor')}
                                className={clsx(
                                    "p-1 hover:bg-surface-secondary rounded transition-colors mr-2",
                                    viewMode === 'graph' ? "bg-accent-primary/10 text-accent-primary" : "text-text-tertiary"
                                )}
                                title={viewMode === 'editor' ? "Switch to Graph View" : "Switch to List View"}
                            >
                                <GitGraph className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleCreate('file')} className="p-1 hover:bg-surface-secondary rounded" title="New File">
                                <FilePlus className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleCreate('folder')} className="p-1 hover:bg-surface-secondary rounded" title="New Folder">
                                <FolderPlus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto p-2">
                        {renderSidebarContent()}
                    </div>
                </div>
            </div>

            {/* Left Resize Handle */}
            {isSidebarOpen && (
                <div
                    className={clsx(
                        "w-1 cursor-col-resize z-50 transition-colors flex flex-col justify-center items-center hover:bg-accent-primary/50",
                        isLeftDragging ? "bg-accent-primary" : "bg-transparent"
                    )}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setIsLeftDragging(true);
                    }}
                >
                </div>
            )}

            {/* Editor Area */}
            <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden bg-surface-primary relative">
                <div className="absolute top-1 left-3 z-20 flex items-center gap-2">
                    <button
                        onClick={() => setSidebarOpen(!isSidebarOpen)}
                        className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded-md transition-colors"
                        title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
                    >
                        <PanelLeft className="w-5 h-5" />
                    </button>
                    {!isSidebarOpen && (
                        <button
                            onClick={() => handleCreate('file')}
                            className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded-md transition-colors"
                            title="New Manuscript"
                        >
                            <Edit className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {/* Right Panel Toggle (visible when panel is closed) */}
                {!isRightPanelOpen && (
                    <div className="absolute top-1 right-3 z-20 flex items-center gap-2">
                        <button
                            onClick={() => setRightPanelOpen(true)}
                            className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded-md transition-colors"
                            title="Open Tools Panel"
                        >
                            <PanelRight className="w-5 h-5" />
                        </button>
                    </div>
                )}

                {viewMode === 'graph' ? (
                    <div className="flex-1 min-h-0 overflow-hidden relative">
                        <GraphView
                            files={state.tree}
                            onOpenFile={(path) => {
                                handleSelectFile(path);
                                setViewMode('editor');
                            }}
                            onCreateFile={handleCreateFromGraph}
                            onRenameFile={handleRenameNode}
                        />
                    </div>
                ) : (
                    <>
                        {state.selectedFile ? (
                            <>
                                <div className="px-8 pt-8 pb-2 border-b border-transparent hover:border-border transition-colors flex items-center gap-4">
                                     <input
                                        value={titleValue}
                                        onChange={e => setTitleValue(e.target.value)}
                                        onBlur={handleTitleRename}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.currentTarget.blur();
                                            }
                                        }}
                                        className="text-3xl font-bold text-text-primary bg-transparent outline-none flex-1 placeholder-text-tertiary/50"
                                        placeholder="Untitled"
                                     />

                                     {/* Status Selector */}
                                     <div className="flex items-center">
                                        <select
                                            value={state.fileMetadata.status || 'writing'}
                                            onChange={(e) => {
                                                const newStatus = e.target.value;
                                                setState(prev => ({
                                                    ...prev,
                                                    fileMetadata: { ...prev.fileMetadata, status: newStatus },
                                                    isModified: true
                                                }));
                                                // Trigger auto-save immediately for status change
                                                // Actually useEffect auto-save will handle it since isModified is true
                                                // But let's also update the tree so sidebar reflects it immediately

                                                // We need to update the tree state locally to reflect the status change in sidebar
                                                // Recursive update
                                                const updateTreeStatus = (nodes: FileNode[]): FileNode[] => {
                                                    return nodes.map(node => {
                                                        if (node.path === state.selectedFile) {
                                                            return { ...node, status: newStatus as any };
                                                        }
                                                        if (node.children) {
                                                            return { ...node, children: updateTreeStatus(node.children) };
                                                        }
                                                        return node;
                                                    });
                                                };

                                                setState(prev => ({
                                                    ...prev,
                                                    tree: updateTreeStatus(prev.tree),
                                                    fileMetadata: { ...prev.fileMetadata, status: newStatus },
                                                    isModified: true
                                                }));
                                            }}
                                            className={clsx(
                                                "text-xs font-medium px-2 py-1 rounded border outline-none cursor-pointer appearance-none text-center min-w-[80px]",
                                                (!state.fileMetadata.status || state.fileMetadata.status === 'writing') && "bg-blue-50 text-blue-600 border-blue-200",
                                                state.fileMetadata.status === 'completed' && "bg-green-50 text-green-600 border-green-200",
                                                state.fileMetadata.status === 'abandoned' && "bg-red-50 text-red-600 border-red-200"
                                            )}
                                        >
                                            <option value="writing">写作中</option>
                                            <option value="completed">已完成</option>
                                            <option value="abandoned">已废弃</option>
                                        </select>
                                     </div>
                                </div>
                                <div className="flex-1 min-h-0 overflow-hidden relative">
                                    <CodeMirrorEditor
                                        value={state.fileContent}
                                        onChange={(val) => setState(prev => ({ ...prev, fileContent: val, isModified: true }))}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
                                <Edit3 className="w-12 h-12 mb-4 opacity-20" />
                                <p>选择文件开始编辑</p>
                            </div>
                        )}
                    </>
                )}

                {/* Saving Indicator */}
                {state.isSaving && (
                    <div className="absolute bottom-4 right-8 text-xs text-text-tertiary bg-surface-secondary/50 px-2 py-1 rounded">
                        保存中...
                    </div>
                )}
            </div>

            {/* Resize Handle */}
            {isRightPanelOpen && (
                <div
                    className={clsx(
                        "w-1 cursor-col-resize z-50 transition-colors flex flex-col justify-center items-center hover:bg-accent-primary/50",
                        isDragging ? "bg-accent-primary" : "bg-border"
                    )}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                    }}
                >
                    {/* Visual Grip Indicator (optional) */}
                    <div className="h-8 w-0.5 bg-text-tertiary/20 rounded-full" />
                </div>
            )}

            {/* Right Panel (Split View) */}
            <div
                className={clsx(
                    "flex flex-col min-h-0 bg-surface-primary overflow-hidden h-full shadow-xl",
                    // Use transition for opacity but not width (to keep dragging smooth)
                    isRightPanelOpen ? "opacity-100" : "opacity-0 w-0"
                )}
                style={{ width: isRightPanelOpen ? rightPanelWidth : 0 }}
            >
                {/* Right Panel Header - Minimal */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface-secondary/30">
                    <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        知识库
                    </span>
                    <button
                        onClick={() => setRightPanelOpen(false)}
                        className="p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded transition-colors"
                        title="Close Panel"
                    >
                        <PanelRight className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Right Panel Content */}
                <div className="flex-1 min-h-0 overflow-hidden relative">
                    <div className="h-full w-full">
                        <Knowledge isEmbedded={true} referenceContent={state.fileContent} />
                    </div>
                </div>
            </div>
        </div>
    );
}
