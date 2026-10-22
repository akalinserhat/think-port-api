import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Pin } from 'lucide-react';
import BaseButton, { BaseButtonProps } from './BaseButton';

export interface MenuButtonItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onClick: (e: React.MouseEvent) => void | Promise<void>;
}

export interface BaseMenuButtonProps extends Omit<BaseButtonProps, 'onClick' | 'text' | 'icon'> {
    items: MenuButtonItem[];
    defaultPinnedId?: string;
    onPinChange?: (pinnedId: string) => void;
}

const BaseMenuButton: React.FC<BaseMenuButtonProps> = ({
    items,
    defaultPinnedId,
    onPinChange,
    disabled,
    style,
    className = '',
    variant = 'primary',
    ...rest
}) => {
    const [pinnedId, setPinnedId] = useState<string>(defaultPinnedId || items[0]?.id);
    const [isOpen, setIsOpen] = useState(false);
    const [coords, setCoords] = useState<{ top?: number | 'auto', bottom?: number | 'auto', right: number, minWidth: number, maxHeight?: number }>({ top: 0, right: 0, minWidth: 0 });
    
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<any>(null);

    const pinnedItem = items.find(i => i.id === pinnedId) || items[0];

    const updateCoords = useCallback(() => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            const spaceAbove = rect.top - 8;
            const estimatedHeight = items.length * 44 + 16;
            
            let isUpwards = false;
            let maxHeight = spaceBelow;

            if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
                isUpwards = true;
                maxHeight = spaceAbove;
            }

            setCoords({
                top: isUpwards ? 'auto' : rect.bottom + 4,
                bottom: isUpwards ? window.innerHeight - rect.top + 4 : 'auto',
                right: window.innerWidth - rect.right,
                minWidth: rect.width,
                maxHeight: maxHeight
            });
        }
    }, [items.length]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const isOutsideContainer = containerRef.current && !containerRef.current.contains(event.target as Node);
            const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(event.target as Node);
            
            if (isOutsideContainer && isOutsideDropdown) {
                setIsOpen(false);
            }
        };

        const handleScrollOrResize = () => {
            if (isOpen) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [isOpen]);

    const handleToggle = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isOpen) {
            updateCoords();
        }
        setIsOpen(!isOpen);
    };

    const handleItemClick = (e: React.MouseEvent, item: MenuButtonItem) => {
        e.stopPropagation();
        setIsOpen(false);
        item.onClick(e);
    };

    const handlePinToggle = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setPinnedId(id);
        if (onPinChange) {
            onPinChange(id);
        }
    };

    const handleMainClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (pinnedItem) {
            pinnedItem.onClick(e);
        }
    };

    // Long press logic
    const startPress = (e: React.MouseEvent | React.TouchEvent) => {
        if (disabled) return;
        timerRef.current = setTimeout(() => {
            updateCoords();
            setIsOpen(true);
        }, 500); // 500ms for long press
    };

    const cancelPress = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    if (!items || items.length === 0) return null;

    // Dinamik kenarlık rengi (açık/koyu renge göre uyumlu ayraç)
    const dividerColor = variant === 'outline' || variant === 'transparent' ? 'var(--glass-border)' : 'rgba(255, 255, 255, 0.2)';

    const isSingleItem = items.length === 1;

    return (
        <div ref={containerRef} style={{ display: 'inline-flex', alignItems: 'stretch', ...style }} className={className}>
            <BaseButton
                {...rest}
                variant={variant}
                text={pinnedItem.label}
                icon={pinnedItem.icon}
                disabled={disabled}
                onClick={handleMainClick}
                onMouseDown={isSingleItem ? undefined : startPress}
                onMouseUp={isSingleItem ? undefined : cancelPress}
                onMouseLeave={isSingleItem ? undefined : cancelPress}
                onTouchStart={isSingleItem ? undefined : startPress}
                onTouchEnd={isSingleItem ? undefined : cancelPress}
                style={{ 
                    flex: 1,
                    justifyContent: 'center',
                    ...(isSingleItem ? {} : {
                        borderTopRightRadius: 0, 
                        borderBottomRightRadius: 0,
                        borderRight: `1px solid ${dividerColor}`
                    })
                }}
            />
            {!isSingleItem && (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={handleToggle}
                    className={`btn btn-${variant}`}
                    style={{
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        padding: '0 8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <ChevronDown size={18} />
                </button>
            )}

            {isOpen && !isSingleItem && createPortal(
                <div
                    ref={dropdownRef}
                    className="surface-card"
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        bottom: coords.bottom,
                        right: coords.right,
                        minWidth: coords.minWidth,
                        maxHeight: coords.maxHeight,
                        overflowY: 'auto',
                        zIndex: 9999,
                        padding: '4px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--glass-border)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        animation: 'fadeIn 0.15s ease-out'
                    }}
                >
                    {items.map(item => (
                        <div
                            key={item.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                background: 'transparent'
                            }}
                            className="menu-item-hover"
                            onClick={(e) => handleItemClick(e, item)}
                        >
                            {item.icon && <span style={{ marginRight: '8px', display: 'flex' }}>{item.icon}</span>}
                            <span style={{ flex: 1, fontSize: '14px', fontWeight: '500' }}>{item.label}</span>
                            <div 
                                onClick={(e) => handlePinToggle(e, item.id)}
                                style={{ 
                                    padding: '4px', 
                                    borderRadius: '4px', 
                                    marginLeft: '12px',
                                    color: pinnedId === item.id ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                                    background: pinnedId === item.id ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                                    cursor: 'pointer'
                                }}
                                className="pin-btn-hover"
                                title={pinnedId === item.id ? "Sabitlenmiş Seçenek" : "Sabitle"}
                            >
                                {pinnedId === item.id ? <Pin size={16} fill="currentColor" /> : <Pin size={16} />}
                            </div>
                        </div>
                    ))}
                </div>,
                document.body
            )}

            <style>{`
                .menu-item-hover:hover {
                    background: var(--hover-bg) !important;
                }
                .pin-btn-hover:hover {
                    color: var(--accent-primary) !important;
                    background: rgba(99, 102, 241, 0.05) !important;
                }
            `}</style>
        </div>
    );
};

export default BaseMenuButton;
