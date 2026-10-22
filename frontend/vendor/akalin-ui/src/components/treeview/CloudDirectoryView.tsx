import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseTreeView, TreeItem } from '../base/treeview/BaseTreeView';
import { Folder, ChevronRight, Lock, HardDrive, FolderPlus } from 'lucide-react';

export interface CloudFolderItem extends Omit<TreeItem, 'id'> {
    id: number;
    klasorAdi: string;
    klasorTuru?: number; // 1 = System, 2 = User
    altKlasorler?: CloudFolderItem[];
}

export interface CloudDirectoryViewProps {
    folders: CloudFolderItem[];
    selectedFolder: CloudFolderItem | null;
    onSelectFolder: (folder: CloudFolderItem | null) => void;
    onAddFolder?: () => void;
    showAddFolderButton?: boolean;
}

const findAncestorIds = (items: CloudFolderItem[], targetId: number, currentPath: number[] = []): number[] | null => {
    for (const item of items) {
        if (item.id === targetId) {
            return currentPath;
        }
        if (item.altKlasorler && item.altKlasorler.length > 0) {
            const found = findAncestorIds(item.altKlasorler, targetId, [...currentPath, item.id]);
            if (found) return found;
        }
    }
    return null;
};

const CloudDirectoryViewInner: React.FC<CloudDirectoryViewProps> = ({ 
    folders, 
    selectedFolder, 
    onSelectFolder, 
    onAddFolder,
    showAddFolderButton = true
}) => {
    const { t } = useTranslation();
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<number>>(() => new Set());

    // Transform CloudFolderItem array to TreeItem array expected by BaseTreeView
    // We map altKlasorler to children for the base component
    const mapToTreeItem = useCallback((f: CloudFolderItem): TreeItem => ({
        ...f,
        id: f.id,
        children: f.altKlasorler ? f.altKlasorler.map(mapToTreeItem) : undefined
    }), []);

    const treeData = useMemo(() => folders.map(mapToTreeItem), [folders, mapToTreeItem]);

    // Seçili klasörün tüm üst klasörlerini otomatik aç
    useEffect(() => {
        if (selectedFolder) {
            const ancestors = findAncestorIds(folders, selectedFolder.id) || [];
            setExpandedFolderIds(prev => {
                const next = new Set(prev);
                ancestors.forEach(id => next.add(id));
                return next;
            });
        }
    }, [selectedFolder, folders]);

    // Seçili klasör görünür alanda değilse kaydır
    useEffect(() => {
        if (selectedFolder) {
            const timer = setTimeout(() => {
                const el = document.querySelector('.cloud-dir-item-selected');
                el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 80);
            return () => clearTimeout(timer);
        }
    }, [selectedFolder]);

    const handleToggleFolder = useCallback((folderId: number) => {
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    }, []);

    const isItemExpanded = useCallback((item: TreeItem) => {
        return expandedFolderIds.has(Number(item.id));
    }, [expandedFolderIds]);

    const renderTreeItem = (item: TreeItem, level: number, isExpanded: boolean, onToggleExpand: () => void) => {
        const folder = item as CloudFolderItem;
        const isSelected = selectedFolder?.id === folder.id;
        const hasChildren = folder.altKlasorler && folder.altKlasorler.length > 0;

        return (
            <div className="cloud-dir-item-wrapper" style={{ '--level': level } as React.CSSProperties}>
                {level > 0 && Array.from({ length: level }).map((_, i) => (
                    <div key={i} className="cloud-dir-guide" style={{ left: `${(i * 16) + 12}px` }} />
                ))}
                <div
                    className={`cloud-dir-item ${isSelected ? 'cloud-dir-item-selected' : ''}`}
                    style={{ paddingLeft: `${(level * 16) + 8}px` }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelectFolder(folder);
                    }}
                >
                    <div
                        className="cloud-dir-toggle"
                        onClick={(e) => {
                            if (hasChildren) {
                                e.stopPropagation();
                                handleToggleFolder(folder.id);
                                onToggleExpand();
                            }
                        }}
                    >
                        {hasChildren ? (
                            <ChevronRight
                                size={14}
                                className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                            />
                        ) : (
                            <div className="cloud-dir-toggle-placeholder" />
                        )}
                    </div>
                    
                    <div className="cloud-dir-icon-container">
                        <Folder
                            size={16}
                            className="cloud-dir-folder"
                            fill={isSelected ? "var(--accent-primary)" : "var(--text-muted)"}
                            color={isSelected ? "var(--accent-primary)" : "var(--text-muted)"}
                        />
                        {folder.klasorTuru === 1 && (
                            <div className="cloud-dir-lock-badge">
                                <Lock size={8} fill="currentColor" />
                            </div>
                        )}
                    </div>

                    <span className="cloud-dir-label" title={folder.klasorAdi}>
                        {folder.klasorAdi}
                    </span>

                    {showAddFolderButton && onAddFolder && (
                        <button
                            className="cloud-dir-action-btn"
                            title={t('CloudDirectory_addSubFolder', 'Alt Klasör Ekle')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelectFolder(folder);
                                onAddFolder();
                            }}
                        >
                            <FolderPlus size={14} />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="cloud-directory-container">
            <div className="cloud-directory-header">
                <span className="cloud-directory-title">{t('Klasorler', 'Klasörler')}</span>
                {showAddFolderButton && onAddFolder && (
                    <button 
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelectFolder(null); // Deselect to add to root
                            onAddFolder();
                        }}
                        className="cloud-directory-header-btn"
                        title={t('CloudDirectory_addRootFolder', 'Ana Dizine Klasör Ekle')}
                    >
                        <FolderPlus size={16} />
                    </button>
                )}
            </div>
            
            <div className="cloud-directory-content">
                <div 
                    className={`cloud-dir-root-item ${!selectedFolder ? 'cloud-dir-root-selected' : ''}`}
                    onClick={() => onSelectFolder(null)}
                >
                    <div className="cloud-dir-root-icon">
                        <HardDrive size={16} className={!selectedFolder ? "text-primary" : "text-muted"} />
                    </div>
                    <span className="cloud-dir-root-label">{t('FilesOnClouds_rootDirectory', 'Kök Dizin')}</span>
                    
                    {showAddFolderButton && onAddFolder && (
                        <button
                            className="cloud-dir-action-btn"
                            title={t('CloudDirectory_addRootFolder', 'Ana Dizine Klasör Ekle')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelectFolder(null);
                                onAddFolder();
                            }}
                        >
                            <FolderPlus size={14} />
                        </button>
                    )}
                </div>
                
                <div className="cloud-directory-tree">
                    <BaseTreeView 
                        data={treeData} 
                        renderItem={renderTreeItem} 
                        isItemExpanded={isItemExpanded}
                    />
                </div>
            </div>
        </div>
    );
};

export const CloudDirectoryView = React.memo(CloudDirectoryViewInner);
