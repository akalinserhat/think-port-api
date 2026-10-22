import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import { createPortal } from 'react-dom';
import BaseSeciciInput from './BaseSeciciInput';

export interface TreeDropdownNode {
    id: string | number;
    label: string | React.ReactNode;
    isGroup?: boolean;
    children?: TreeDropdownNode[];
    rawValue?: any;
    suffix?: string | React.ReactNode;
    searchableText?: string;
}

export interface BaseTreeDropdownSeciciProps {
    id?: string;
    value?: any;
    onChange?: (id: any, rawValue: any) => void;
    treeData: TreeDropdownNode[];
    disabled?: boolean;
    required?: boolean;
    placeholder?: string;
    clearable?: boolean;
    displayText?: string;
    extraAction?: { label: string; icon?: React.ReactNode; onClick: (expandedNodes?: Record<string | number, boolean>) => void; };
    usePortal?: boolean;
    inputClassName?: string;
    inputStyle?: React.CSSProperties;
}

const BaseTreeDropdownSecici: React.FC<BaseTreeDropdownSeciciProps> = ({
    id,
    value,
    onChange,
    treeData,
    disabled = false,
    required = false,
    placeholder = "Seçiniz...",
    clearable = true,
    displayText,
    extraAction,
    usePortal = false,
    inputClassName,
    inputStyle
}) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedNodes, setExpandedNodes] = useState<Record<string | number, boolean>>({});
    const [touched, setTouched] = useState(false);
    
    const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});
    
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const searchStringRef = useRef<string>('');

    // Dışarı tıklayınca kapat
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                containerRef.current && !containerRef.current.contains(e.target as Node) &&
                (!menuRef.current || !menuRef.current.contains(e.target as Node))
            ) {
                setIsDropdownOpen(false);
                setTouched(true);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Portal kullanıldığında pozisyon güncelleme
    const updatePosition = () => {
        if (usePortal && containerRef.current && isDropdownOpen) {
            const rect = containerRef.current.getBoundingClientRect();
            setDropdownStyles({
                position: 'fixed',
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
                zIndex: 9999,
                background: 'var(--bg-primary)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                maxHeight: '280px',
                overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            });
        } else if (!usePortal) {
            setDropdownStyles({
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 1000,
                background: 'var(--bg-primary)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                marginTop: '4px',
                maxHeight: '280px',
                overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            });
        }
    };

    useEffect(() => {
        if (isDropdownOpen) {
            updatePosition();
            if (usePortal) {
                window.addEventListener('scroll', updatePosition, true);
                window.addEventListener('resize', updatePosition);
            }
        }
        return () => {
            if (usePortal) {
                window.removeEventListener('scroll', updatePosition, true);
                window.removeEventListener('resize', updatePosition);
            }
        };
    }, [isDropdownOpen, usePortal]);

    // Ekranın dışına taşıyorsa yukarı aç (Portal için)
    useEffect(() => {
        if (isDropdownOpen && usePortal && menuRef.current) {
            setTimeout(() => {
                if (!menuRef.current) return;
                const rect = menuRef.current.getBoundingClientRect();
                const isOutOfViewport = rect.bottom > (window.innerHeight || document.documentElement.clientHeight);
                if (isOutOfViewport && containerRef.current) {
                    const inputRect = containerRef.current.getBoundingClientRect();
                    setDropdownStyles(prev => ({
                        ...prev,
                        top: inputRect.top - rect.height - 4
                    }));
                }
            }, 50);
        }
    }, [isDropdownOpen, usePortal]);

    // Recursive path bulucu
    const findNodePath = (nodes: TreeDropdownNode[], targetId: any): (string | number)[] | null => {
        if (targetId === undefined || targetId === null || targetId === '') return null;
        for (const node of nodes) {
            if (node.id !== undefined && node.id !== null && node.id.toString() === targetId.toString()) {
                return [node.id];
            }
            if (node.children && node.children.length > 0) {
                const path = findNodePath(node.children, targetId);
                if (path) {
                    return [node.id, ...path];
                }
            }
        }
        return null;
    };

    // Value dışarıdan değiştiğinde ebeveyn grupları aç
    useEffect(() => {
        if (value !== undefined && value !== null && value !== '' && treeData.length > 0) {
            const path = findNodePath(treeData, value);
            if (path && path.length > 1) {
                setExpandedNodes(prev => {
                    const next = { ...prev };
                    // Son eleman (hedef node) hariç üst grupları aç
                    for (let i = 0; i < path.length - 1; i++) {
                        next[path[i]] = true;
                    }
                    return next;
                });
            }
        }
    }, [value, treeData]);

    const getVisibleNodes = (nodes: TreeDropdownNode[], state: Record<string | number, boolean>, depth = 0): (TreeDropdownNode & { depth: number })[] => {
        let result: (TreeDropdownNode & { depth: number })[] = [];
        nodes.forEach(node => {
            result.push({ ...node, depth });
            if (node.isGroup && state[node.id] && node.children && node.children.length > 0) {
                result = result.concat(getVisibleNodes(node.children, state, depth + 1));
            }
        });
        return result;
    };

    const visibleItems = useMemo(() => {
        return getVisibleNodes(treeData, expandedNodes);
    }, [treeData, expandedNodes]);

    // Dropdown açıldığında seçili öğeyi odakla
    useEffect(() => {
        if (isDropdownOpen) {
            if (value !== undefined && value !== null && value !== '') {
                const idx = visibleItems.findIndex(n => n.id?.toString() === value?.toString());
                setFocusedIndex(idx >= 0 ? idx : 0);
            } else {
                setFocusedIndex(0);
            }
        } else {
            setFocusedIndex(-1);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDropdownOpen]);

    const toggleGroup = (id: string | number) => {
        setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleSelect = (option: TreeDropdownNode | 'EXTRA_ACTION') => {
        searchStringRef.current = '';
        setSearchQuery('');

        if (option === 'EXTRA_ACTION' && extraAction) {
            setIsDropdownOpen(false);
            extraAction.onClick(expandedNodes);
        } else if (option !== 'EXTRA_ACTION') {
            if (onChange) {
                onChange(option.id, option.rawValue);
            }
            setIsDropdownOpen(false);
            setTouched(true);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (disabled) return;
        const totalItems = visibleItems.length + (extraAction ? 1 : 0);

        // Alphanumeric search (Typeahead)
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (!isDropdownOpen) setIsDropdownOpen(true);

            searchStringRef.current += e.key.toLocaleLowerCase('tr-TR');
            setSearchQuery(searchStringRef.current);
            
            const searchStr = searchStringRef.current;
            const matchIndex = visibleItems.findIndex(opt => {
                const textToSearch = opt.searchableText || (typeof opt.label === 'string' ? opt.label : '');
                return textToSearch.toLocaleLowerCase('tr-TR').includes(searchStr);
            });

            if (matchIndex >= 0) {
                setFocusedIndex(matchIndex);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                searchStringRef.current = '';
                setSearchQuery('');
                if (!isDropdownOpen) {
                    setIsDropdownOpen(true);
                } else {
                    setFocusedIndex(prev => (prev < totalItems - 1 ? prev + 1 : prev));
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                searchStringRef.current = '';
                setSearchQuery('');
                if (isDropdownOpen) {
                    setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
                }
                break;
            case 'Enter': {
                e.preventDefault();
                if (!isDropdownOpen) {
                    setIsDropdownOpen(true);
                    break;
                }
                if (extraAction && focusedIndex === visibleItems.length) {
                    handleSelect('EXTRA_ACTION');
                } else {
                    const item = visibleItems[focusedIndex];
                    if (!item) break;
                    if (item.isGroup) {
                        toggleGroup(item.id);
                    } else {
                        handleSelect(item);
                    }
                }
                break;
            }
            case 'ArrowRight': {
                e.preventDefault();
                if (!isDropdownOpen) break;
                const item = visibleItems[focusedIndex];
                if (item?.isGroup && !expandedNodes[item.id]) {
                    setExpandedNodes(prev => ({ ...prev, [item.id]: true }));
                }
                break;
            }
            case 'ArrowLeft': {
                e.preventDefault();
                if (!isDropdownOpen) break;
                const item = visibleItems[focusedIndex];
                if (item?.isGroup && expandedNodes[item.id]) {
                    setExpandedNodes(prev => ({ ...prev, [item.id]: false }));
                }
                break;
            }
            case 'Escape':
            case 'Tab':
                searchStringRef.current = '';
                setSearchQuery('');
                setIsDropdownOpen(false);
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setTouched(true);
                }
                break;
            case 'Backspace':
                e.preventDefault();
                if (searchStringRef.current.length > 0) {
                    searchStringRef.current = searchStringRef.current.slice(0, -1);
                    setSearchQuery(searchStringRef.current);
                    
                    const searchStr = searchStringRef.current;
                    if (searchStr.length > 0) {
                        const matchIndex = visibleItems.findIndex(opt => {
                            const textToSearch = opt.searchableText || (typeof opt.label === 'string' ? opt.label : '');
                            return textToSearch.toLocaleLowerCase('tr-TR').includes(searchStr);
                        });
                        if (matchIndex >= 0) {
                            setFocusedIndex(matchIndex);
                        }
                    }
                }
                break;
        }
    };

    // Odaklanan item'ı kaydır
    useEffect(() => {
        if (isDropdownOpen && focusedIndex >= 0) {
            const el = document.querySelector('.tree-node.focused');
            if (el) el.scrollIntoView({ block: 'nearest' });
        }
    }, [focusedIndex, isDropdownOpen]);

    // Flat list üzerinde arama yapıp resolved value bulma
    let resolvedDisplayText = displayText;
    if (!resolvedDisplayText) {
        let foundNode: TreeDropdownNode | null = null;
        const findSelected = (nodes: TreeDropdownNode[]) => {
            for (const n of nodes) {
                if (foundNode) return;
                if (n.id !== undefined && n.id !== null && value !== undefined && value !== null && n.id.toString() === value.toString()) {
                    foundNode = n;
                    return;
                }
                if (n.children && n.children.length > 0) {
                    findSelected(n.children);
                }
            }
        };
        findSelected(treeData);

        if (foundNode) {
            resolvedDisplayText = typeof (foundNode as TreeDropdownNode).label === 'string' 
                ? (foundNode as TreeDropdownNode).label as string
                : `Seçildi (${value})`;
        } else if (value !== undefined && value !== null && value !== '') {
            resolvedDisplayText = `Seçildi (${value})`;
        } else {
            resolvedDisplayText = '';
        }
    }

    const hasError = required && touched && !value;

    const renderHighlightedLabel = (label: string | React.ReactNode, query: string) => {
        if (!query) return label;
        if (typeof label !== 'string') return label;

        const lowerLabel = label.toLocaleLowerCase('tr-TR');
        const lowerQuery = query.toLocaleLowerCase('tr-TR');
        const idx = lowerLabel.indexOf(lowerQuery);
        if (idx === -1) return label;

        return (
            <>
                {label.substring(0, idx)}
                <span style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent-primary)', borderRadius: '4px', padding: '0 2px', fontWeight: 'bold' }}>
                    {label.substring(idx, idx + query.length)}
                </span>
                {label.substring(idx + query.length)}
            </>
        );
    };

    const renderMenuContent = () => (
        <>
            {visibleItems.length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Kayıt bulunamadı.
                </div>
            ) : (
                visibleItems.map((node, idx) => {
                    const isSelected = value?.toString() === node.id?.toString();
                    const isExpanded = expandedNodes[node.id];
                    const isFocused = idx === focusedIndex;

                    return (
                        <div
                            key={node.id}
                            className={`tree-node ${node.isGroup ? 'branch' : 'leaf'} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
                            style={{ paddingLeft: `${node.depth * 16 + 12}px` }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelect(node);
                            }}
                            onMouseEnter={() => setFocusedIndex(idx)}
                        >
                            <span className="tree-icon-wrapper" onMouseDown={(e) => { 
                                e.preventDefault(); 
                                e.stopPropagation(); 
                                if (node.isGroup) toggleGroup(node.id); 
                            }}>
                                {node.isGroup ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{width: 14, display: 'inline-block'}}></span>}
                            </span>
                            <span className="tree-node-label" style={{ fontWeight: node.isGroup ? '600' : '400' }}>
                                {renderHighlightedLabel(node.label, searchQuery)}
                            </span>
                            {node.suffix && (
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                                    {node.suffix}
                                </span>
                            )}
                            {isSelected && <Check size={14} className="tree-check-icon" />}
                        </div>
                    );
                })
            )}

            {extraAction && (
                <div 
                    className={`tree-node leaf ${focusedIndex === visibleItems.length ? 'focused' : ''}`}
                    style={{ 
                        paddingLeft: '12px', 
                        borderTop: '1px solid var(--glass-border)', 
                        color: 'var(--accent-primary)', 
                        fontWeight: 'bold' 
                    }}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect('EXTRA_ACTION');
                    }}
                    onMouseEnter={() => setFocusedIndex(visibleItems.length)}
                >
                    {extraAction.icon || <span style={{ marginRight: '8px' }}>+</span>}
                    {extraAction.label}
                </div>
            )}
        </>
    );

    return (
        <div 
            ref={containerRef}
            style={{ position: 'relative', width: '100%' }}
            onBlur={(e) => {
                if (
                    containerRef.current && !containerRef.current.contains(e.relatedTarget as Node) &&
                    (!menuRef.current || !menuRef.current.contains(e.relatedTarget as Node))
                ) {
                    setIsDropdownOpen(false);
                    setTouched(true);
                }
            }}
        >
            <BaseSeciciInput
                id={id}
                value={resolvedDisplayText}
                onChange={() => {}}
                onFocus={() => {}}
                onBlur={() => {}}
                onKeyDown={disabled ? undefined : handleKeyDown}
                onMenuClick={() => {
                    if (!disabled) setIsDropdownOpen(prev => !prev);
                }}
                onClick={() => {
                    if (!disabled) setIsDropdownOpen(prev => !prev);
                }}
                hasSelection={!!value}
                onClear={() => {
                    if (onChange) onChange(null, null);
                    setIsDropdownOpen(false);
                    setTouched(true);
                }}
                disabled={disabled}
                readOnly={true}
                error={hasError}
                placeholder={placeholder}
                isMenuOpen={isDropdownOpen}
                inputClassName={inputClassName || 'form-input'}
                inputStyle={{ 
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    caretColor: 'transparent',
                    ...inputStyle
                }}
            />

            {hasError && (
                <span style={{ fontSize: '12px', color: 'var(--danger, #ef4444)', marginTop: '4px', display: 'block' }}>
                    Bu alan zorunludur.
                </span>
            )}

            {isDropdownOpen && !disabled && (
                usePortal ? createPortal(
                    <div ref={menuRef} className="custom-tree-dropdown fade-in-fast" tabIndex={-1} style={dropdownStyles}>
                        {renderMenuContent()}
                    </div>,
                    document.body
                ) : (
                    <div ref={menuRef} className="custom-tree-dropdown fade-in-fast" style={dropdownStyles}>
                        {renderMenuContent()}
                    </div>
                )
            )}
        </div>
    );
};

export default BaseTreeDropdownSecici;
