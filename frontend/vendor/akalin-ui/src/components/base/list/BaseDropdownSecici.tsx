import React, { useState, useEffect, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { DocumentHeaderFieldContext } from '../../../pages/base/BaseDocumentPage';

export interface DropdownOption {
    id: string | number;
    label: string | React.ReactNode;
    rawValue?: any; 
}

export interface DropdownExtraAction {
    icon?: React.ReactNode;
    label: string;
    onClick: () => void;
}

export interface BaseDropdownSeciciProps {
    id?: string;
    value?: any;
    onChange?: (id: any, rawValue: any) => void;
    options: DropdownOption[];
    disabled?: boolean;
    placeholder?: string;
    clearable?: boolean;
    className?: string;
    style?: React.CSSProperties;
    error?: boolean | string;
    extraAction?: DropdownExtraAction;
    displayText?: string;
    openOnClick?: boolean;
}

const BaseDropdownSecici: React.FC<BaseDropdownSeciciProps> = ({
    id,
    value,
    onChange,
    options = [],
    disabled = false,
    placeholder = "Seçiniz...",
    clearable = false,
    className,
    style,
    error,
    extraAction,
    displayText,
    openOnClick = true
}) => {
    const headerFieldContext = useContext(DocumentHeaderFieldContext);
    const effectiveError = Boolean(error || headerFieldContext?.hasError);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchStringRef = useRef<string>('');

    // Dışarı tıklayınca kapat
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const isOutsideContainer = containerRef.current && !containerRef.current.contains(event.target as Node);
            const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(event.target as Node);
            
            if (isOutsideContainer && isOutsideDropdown) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Dropdown açıldığında seçili öğeyi odakla
    useEffect(() => {
        if (isDropdownOpen) {
            if (value !== undefined && value !== null) {
                const idx = options.findIndex(o => o.id?.toString() === value?.toString());
                setFocusedIndex(idx >= 0 ? idx : 0);
            } else {
                setFocusedIndex(0);
            }
        }
    }, [isDropdownOpen, value, options]);

    // Odaklanan item'ı kaydır
    useEffect(() => {
        if (isDropdownOpen && focusedIndex >= 0) {
            // Portal olduğu için document.body üzerinden arıyoruz (ve id veya benzersiz sınıf olmadığı için tree-node focused'a gidiyoruz)
            const el = document.body.querySelector('.custom-tree-dropdown .tree-node.focused');
            if (el) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [focusedIndex, isDropdownOpen]);

    const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});

    useEffect(() => {
        if (!isDropdownOpen) return;
        
        const updatePosition = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setDropdownStyles({
                    position: 'fixed',
                    top: `${rect.bottom + 4}px`,
                    left: `${rect.left}px`,
                    width: `${rect.width}px`,
                    zIndex: 9999
                });
            }
        };

        updatePosition();
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [isDropdownOpen, options.length]);

    const handleSelect = (optionId: any) => {
        searchStringRef.current = '';
        setSearchQuery('');
        
        if (optionId === 'EXTRA_ACTION' && extraAction) {
            setIsDropdownOpen(false);
            extraAction.onClick();
        } else {
            if (onChange) {
                const selectedOpt = options.find(o => o.id === optionId);
                onChange(optionId, selectedOpt?.rawValue);
            }
            setIsDropdownOpen(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (disabled) return;
        const totalItems = options.length + (extraAction ? 1 : 0);

        // Alphanumeric search (Typeahead)
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (!isDropdownOpen) {
                setIsDropdownOpen(true);
            }

            searchStringRef.current += e.key.toLocaleLowerCase('tr-TR');
            setSearchQuery(searchStringRef.current);
            
            const searchStr = searchStringRef.current;
            const matchIndex = options.findIndex(opt => {
                const labelStr = typeof opt.label === 'string' ? opt.label : (opt.rawValue?.ad || opt.rawValue?.kdvOrani || opt.rawValue?.Label || '');
                return labelStr.toString().toLocaleLowerCase('tr-TR').includes(searchStr);
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
            case 'Enter':
                e.preventDefault();
                if (isDropdownOpen) {
                    if (extraAction && focusedIndex === options.length) {
                        handleSelect('EXTRA_ACTION');
                    } else if (options[focusedIndex]) {
                        handleSelect(options[focusedIndex].id);
                    }
                } else {
                    setIsDropdownOpen(true);
                }
                break;
            case 'Escape':
            case 'Tab':
                searchStringRef.current = '';
                setSearchQuery('');
                setIsDropdownOpen(false);
                break;
            case 'Backspace':
                e.preventDefault();
                if (searchStringRef.current.length > 0) {
                    searchStringRef.current = searchStringRef.current.slice(0, -1);
                    setSearchQuery(searchStringRef.current);
                    
                    const searchStr = searchStringRef.current;
                    if (searchStr.length > 0) {
                        const matchIndex = options.findIndex(opt => {
                            const labelStr = typeof opt.label === 'string' ? opt.label : (opt.rawValue?.ad || opt.rawValue?.kdvOrani || opt.rawValue?.Label || '');
                            return labelStr.toString().toLocaleLowerCase('tr-TR').includes(searchStr);
                        });
                        if (matchIndex >= 0) {
                            setFocusedIndex(matchIndex);
                        }
                    }
                }
                break;
        }
    };

    let resolvedDisplayText = displayText;
    if (!resolvedDisplayText) {
        const selectedOpt = options.find(o => o.id?.toString() === value?.toString());
        resolvedDisplayText = selectedOpt ? (typeof selectedOpt.label === 'string' ? selectedOpt.label : `Seçildi (${value})`) : (value ? `Seçildi (${value})` : '');
    }

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
                <span className="tree-search-highlight">
                    {label.substring(idx, idx + query.length)}
                </span>
                {label.substring(idx + query.length)}
            </>
        );
    };

    return (
        <div 
            ref={containerRef} 
            className={`relative w-full ${className || ''}`}
            style={style}
            onBlur={(e) => {
                const isOutsideContainer = containerRef.current && !containerRef.current.contains(e.relatedTarget as Node);
                const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(e.relatedTarget as Node);

                if (isOutsideContainer && isOutsideDropdown) {
                    setIsDropdownOpen(false);
                }
            }}
            tabIndex={-1}
        >
            <div className={`dropdown-secici-wrapper ${effectiveError ? 'is-invalid' : ''}`}>
                <input
                    id={id || 'dropdown-secici'}
                    type="text"
                    className={`form-input ${effectiveError ? 'is-invalid' : ''} ${clearable && value ? 'has-clear' : ''}`}
                    value={resolvedDisplayText || ''}
                    onChange={() => {}}
                    onKeyDown={handleKeyDown}
                    onClick={() => {
                        if (openOnClick && !disabled && !isDropdownOpen) {
                            setIsDropdownOpen(true);
                        }
                    }}
                    disabled={disabled}
                    readOnly
                    placeholder={placeholder || 'Seçiniz...'}
                    autoComplete="off"
                />
                <div className="dropdown-action-container">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (disabled) return;
                            if (clearable && value) {
                                // For dropdowns, immediately clear without alert, as standard dropdowns do
                                if (onChange) onChange(null, null);
                            } else {
                                setIsDropdownOpen(!isDropdownOpen);
                            }
                        }}
                        disabled={disabled}
                        tabIndex={-1}
                        title={(clearable && value) ? "Seçimi Temizle" : "Seçim Menüsü"}
                        className="dropdown-action-btn"
                    >
                        {(clearable && value) ? <X size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>
            </div>

            {isDropdownOpen && createPortal(
                <div 
                    ref={dropdownRef} 
                    className="custom-tree-dropdown fade-in-fast" 
                    style={dropdownStyles}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) {
                            e.nativeEvent.stopImmediatePropagation();
                        }
                    }}
                >
                    <div className="tree-content">
                        {options.map((o, idx) => {
                            const isSelected = value?.toString() === o.id?.toString();
                            return (
                                <div
                                    key={o.id}
                                    className={`tree-node ${focusedIndex === idx ? 'focused' : ''} ${isSelected ? 'selected' : ''}`}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) {
                                            e.nativeEvent.stopImmediatePropagation();
                                        }
                                        handleSelect(o.id);
                                    }}
                                    onMouseEnter={() => setFocusedIndex(idx)}
                                >
                                    <div className="tree-node-content flex justify-between items-center w-full">
                                        <div className={`tree-node-label flex-1 flex items-center ${isSelected ? 'font-semibold' : ''}`}>
                                            {renderHighlightedLabel(o.label, searchQuery)}
                                        </div>
                                        {isSelected && <Check size={18} className="tree-check-icon" />}
                                    </div>
                                </div>
                            );
                        })}
                        
                        {extraAction && (
                            <div 
                                className={`tree-node tree-node-extra-action ${focusedIndex === options.length ? 'focused' : ''}`}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) {
                                        e.nativeEvent.stopImmediatePropagation();
                                    }
                                    handleSelect('EXTRA_ACTION');
                                }}
                                onMouseEnter={() => setFocusedIndex(options.length)}
                            >
                                <div className="tree-node-content flex items-center">
                                    {extraAction.icon && <span className="mr-2 flex items-center">{extraAction.icon}</span>}
                                    <span className="tree-node-label">{extraAction.label}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default BaseDropdownSecici;
