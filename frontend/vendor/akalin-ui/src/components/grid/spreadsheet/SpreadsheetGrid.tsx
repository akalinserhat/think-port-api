// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Columns, GripVertical, ArrowUp, ArrowDown, MoreVertical, X, Plus, Trash2, Settings } from 'lucide-react';
import ActionMenu from '../../menu/ActionMenu';
import SpreadsheetGridRowEdit from './SpreadsheetGridRowEdit';
import SpreadsheetCardView from './SpreadsheetCardView';
import { SpreadsheetAddAction } from './SpreadsheetAddNewRow';
import EkleFloatCircleButton from '../../button/EkleFloatCircleButton';

export interface SpreadsheetGridProps {
    columns: any[];
    data: any[];
    rowActions?: any[];
    striped?: boolean;
    bordered?: boolean;
    onAddRow?: () => void;
    onCustomAddAction?: () => void;
    customAddIcon?: any;
    autoAddRow?: boolean;
    autoAddRowWhenEmpty?: boolean;
    maxOneEmptyRow?: boolean;
    onRemoveRow?: (index: number) => void;
    isEmptyRow?: (row: any) => boolean;
    validateBeforeAdd?: (data: any[], activeRowIndex?: number) => boolean | {
        canAdd: boolean;
        invalidRowIndex?: number;
        invalidColId?: string;
        invalidColIndex?: number;
        errorMessage?: string;
    };
    initialVisibleColumns?: string[];
    initialColumnWidths?: Record<string, number>;
    onConfigChange?: (config: any) => void;
    onSort?: (field: string, direction: 'asc' | 'desc' | null) => void;
    mobileCardRender?: (row: any, index: number) => React.ReactNode;
    additionalAddActions?: any[];
    useFloatAddButton?: boolean;
    onRowClick?: (row: any, index: number, e?: React.MouseEvent) => void;
    onRowDoubleClick?: (row: any, index: number, e?: React.MouseEvent) => void;
    selectedRowIndex?: number;
    settingsColumnPosition?: SpreadsheetSettingsColumnPosition;
    pinSettingsColumn?: boolean;
    isInvalid?: boolean;
    error?: string | boolean;
}

export type SpreadsheetSettingsColumnPosition = 'fixed' | 'inline' | 'end';

const SpreadsheetGrid: React.FC<SpreadsheetGridProps> = ({
    columns,
    data,
    rowActions,
    striped = false,
    bordered = true,
    onAddRow,
    onCustomAddAction,
    customAddIcon,
    autoAddRow = true,
    autoAddRowWhenEmpty = true,
    maxOneEmptyRow = true,
    onRemoveRow,
    isEmptyRow,
    validateBeforeAdd,
    initialVisibleColumns,
    initialColumnWidths,
    onConfigChange,
    onSort,
    mobileCardRender,
    additionalAddActions,
    useFloatAddButton = false,
    onRowClick,
    onRowDoubleClick,
    selectedRowIndex,
    settingsColumnPosition = 'fixed',
    pinSettingsColumn,
    isInvalid = false,
    error
}) => {
    const isPinned = pinSettingsColumn !== undefined
        ? pinSettingsColumn
        : (settingsColumnPosition !== 'inline' && settingsColumnPosition !== 'end');
    const { t } = useTranslation();
    const tbodyRef = useRef(null);
    const [selectedRow, setSelectedRow] = useState<number | null>(selectedRowIndex ?? null);

    useEffect(() => {
        if (selectedRowIndex !== undefined && selectedRowIndex !== null && selectedRowIndex >= 0) {
            setSelectedRow(selectedRowIndex);
            const rowEl = tbodyRef.current?.children[selectedRowIndex] as HTMLElement;
            if (rowEl) {
                try {
                    rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } catch (err) {}
            }
        }
    }, [selectedRowIndex]);
    const [visibleColumns, setVisibleColumns] = useState(() => {
        if (initialVisibleColumns && initialVisibleColumns.length > 0) return initialVisibleColumns;
        return columns.map((c, i) => c.id || i.toString());
    });
    const [columnWidths, setColumnWidths] = useState(() => {
        const widths = {};
        columns.forEach((c, i) => {
            const w = c.width;
            if (w === undefined || w === 'auto' || w === '100%') {
                widths[c.id || i.toString()] = '100%';
            } else {
                widths[c.id || i.toString()] = typeof w === 'string' ? parseInt(w) || 100 : w;
            }
        });
        // Merge with initialColumnWidths if any
        if (initialColumnWidths) {
            Object.keys(initialColumnWidths).forEach(key => {
                widths[key] = initialColumnWidths[key];
            });
        }
        return widths;
    });
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });

    const [isResizing, setIsResizing] = useState(false);
    // currentResizer: { colId: string, startX: number, startWidth: number }
    const [currentResizer, setCurrentResizer] = useState<{ colId: string; startX: number; startWidth: number } | null>(null);

    const [draggedColId, setDraggedColId] = useState(null);
    const [dragOverColId, setDragOverColId] = useState(null);

    const [sortConfig, setSortConfig] = useState(null);

    const columnWidthsRef = useRef(columnWidths);
    const visibleColumnsRef = useRef(visibleColumns);
    const lastFocusedRowIndexRef = useRef(-1);
    const pendingFocusNewRow = useRef(false);

    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [mobileEditRowIndex, setMobileEditRowIndex] = useState(null);

    const computedRowActions = rowActions || (onRemoveRow ? [{
        icon: <Trash2 size={16} />,
        danger: true,
        label: t('Satırı Sil', 'Satırı Sil'),
        onClick: (row, rowIndex) => onRemoveRow(rowIndex)
    }] : []);

    const activeColumns = visibleColumns
        .map(id => columns.find((c, i) => (c.id || i.toString()) === id))
        .filter(Boolean);

    const tableMinWidth = React.useMemo(() => {
        let total = 40; // settings column (40px)
        activeColumns.forEach(col => {
            const colId = col.id || columns.indexOf(col).toString();
            const w = columnWidths[colId];
            if (typeof w === 'number') {
                total += w;
            } else if (typeof w === 'string' && w.endsWith('px')) {
                total += parseFloat(w) || 0;
            } else {
                total += 120; // default min width for auto/100% columns
            }
        });
        return total;
    }, [activeColumns, columnWidths, columns]);

    const focusInputInCell = (rIndex, cIndex) => {
        const row = tbodyRef.current?.children[rIndex];
        if (row) {
            const cell = row.children[cIndex];
            const input = cell?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
            if (input) {
                input.focus({ preventScroll: true });
                if (typeof input.select === 'function') {
                    input.select();
                }
                return true;
            } else if (cell) {
                cell.focus?.({ preventScroll: true });
                return true;
            }
        }
        return false;
    };

    const focusFirstInputInRow = (rIndex) => {
        const row = tbodyRef.current?.children[rIndex];
        if (row) {
            for (let c = 0; c < activeColumns.length; c++) {
                if (focusInputInCell(rIndex, c)) {
                    try {
                        row.scrollIntoView({ block: 'nearest' });
                    } catch (err) {}
                    return true;
                }
            }
        }
        return false;
    };

    const checkCanAddRow = (targetRowIndex?: number): boolean => {
        if (!validateBeforeAdd) return true;

        const currentRowIndex = targetRowIndex !== undefined 
            ? targetRowIndex 
            : (selectedRow !== null ? selectedRow : (data?.length ? data.length - 1 : 0));

        const result = validateBeforeAdd(data, currentRowIndex);

        if (result === false) {
            return false;
        }

        if (typeof result === 'object' && result !== null) {
            if (!result.canAdd) {
                let targetColIdx = result.invalidColIndex;
                if (targetColIdx === undefined && result.invalidColId) {
                    targetColIdx = activeColumns.findIndex(c => (c.id || '') === result.invalidColId);
                }

                const targetRow = result.invalidRowIndex !== undefined ? result.invalidRowIndex : currentRowIndex;

                if (targetColIdx !== undefined && targetColIdx >= 0) {
                    setTimeout(() => {
                        focusInputInCell(targetRow, targetColIdx);
                    }, 50);
                } else {
                    setTimeout(() => {
                        focusFirstInputInRow(targetRow);
                    }, 50);
                }
                return false;
            }
        }

        return true;
    };

    const handleAddRequest = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (!checkCanAddRow()) {
            return;
        }

        const emptyRowIndex = (isEmptyRow && data) ? data.findIndex(row => isEmptyRow(row)) : -1;
        const hasEmpty = emptyRowIndex !== -1;

        if (maxOneEmptyRow && hasEmpty) {
            // Zaten boş bir satır var, sadece ona odaklan
            if (isMobile) {
                setMobileEditRowIndex(emptyRowIndex);
            } else {
                setTimeout(() => {
                    focusFirstInputInRow(emptyRowIndex);
                }, 50);
            }
            return;
        }

        if (onCustomAddAction) {
            onCustomAddAction();
        } else if (onAddRow) {
            onAddRow();
            if (isMobile) {
                setMobileEditRowIndex(data.length);
            } else {
                // Yeni satırın DOM'a eklenmesini beklemek için ref ile işaretliyoruz.
                // data.length değişimini izleyen useEffect focus'u atacak.
                pendingFocusNewRow.current = true;
            }
        }
    };

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const prevDataLengthForAutoAddRef = useRef(data?.length || 0);
    const initialAutoAddAttempted = useRef(false);

    useEffect(() => {
        const currentLength = data?.length || 0;
        if (autoAddRowWhenEmpty && currentLength === 0) {
            if (!initialAutoAddAttempted.current || prevDataLengthForAutoAddRef.current > 0) {
                initialAutoAddAttempted.current = true;
                if (onAddRow) {
                    onAddRow();
                } else if (onCustomAddAction) {
                    onCustomAddAction();
                }
            }
        }
        prevDataLengthForAutoAddRef.current = currentLength;
    }, [data?.length, autoAddRowWhenEmpty, onAddRow, onCustomAddAction]);

    // Yeni satır eklenince (pendingFocusNewRow işaretliyse) DOM güncellemesi bekleniyor.
    // data.length arttığında DOM hazır olduğundan focus güvenle atılabilir.
    const prevDataLengthRef = useRef(data?.length || 0);
    useEffect(() => {
        const currentLength = data?.length || 0;
        if (pendingFocusNewRow.current && currentLength > prevDataLengthRef.current) {
            pendingFocusNewRow.current = false;
            setTimeout(() => {
                focusFirstInputInRow(currentLength - 1);
            }, 30);
        }
        prevDataLengthRef.current = currentLength;
    }); // Bağımlılık yok — her render'da kontrol et, hafif ve güvenli.

    useEffect(() => {
        columnWidthsRef.current = columnWidths;
    }, [columnWidths]);

    useEffect(() => {
        visibleColumnsRef.current = visibleColumns;
    }, [visibleColumns]);

    const toggleColumn = (colId) => {
        setVisibleColumns(prev => {
            const newVisible = prev.includes(colId) ? prev.filter(id => id !== colId) : [...prev, colId];
            if (onConfigChange) onConfigChange(newVisible, columnWidths);
            return newVisible;
        });
    };

    const handleMouseDown = (e, colId) => {
        e.preventDefault();
        e.stopPropagation();

        const resizerEl = e.currentTarget;
        const thisTh = resizerEl.closest('th');
        const actualWidth = thisTh ? thisTh.offsetWidth : (typeof columnWidths[colId] === 'number' ? columnWidths[colId] : 100);

        setIsResizing(true);
        setCurrentResizer({ colId, startX: e.clientX, startWidth: actualWidth });
    };

    const handleMouseMove = (e) => {
        if (!isResizing || !currentResizer) return;
        const { colId, startX, startWidth } = currentResizer;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, Math.round(startWidth + diff));
        setColumnWidths(prev => {
            if (prev[colId] === newWidth) return prev;
            const updated = { ...prev, [colId]: newWidth };
            columnWidthsRef.current = updated;
            return updated;
        });
    };

    const handleMouseUp = () => {
        if (isResizing) {
            setIsResizing(false);
            setCurrentResizer(null);
            if (onConfigChange) onConfigChange(visibleColumnsRef.current, columnWidthsRef.current);
        }
    };

    const handleDoubleClick = (e, colId, colIndex) => {
        e.stopPropagation();
        let maxWidth = 50;

        const col = columns.find(c => (c.id || columns.indexOf(c).toString()) === colId);
        const headerText = col?.header || '';

        const measureDiv = document.createElement('div');
        measureDiv.style.position = 'absolute';
        measureDiv.style.visibility = 'hidden';
        measureDiv.style.whiteSpace = 'nowrap';
        measureDiv.style.fontFamily = "'Inter', sans-serif";
        document.body.appendChild(measureDiv);

        measureDiv.style.fontWeight = '600';
        measureDiv.style.fontSize = '12px';
        measureDiv.innerText = headerText;
        maxWidth = Math.max(maxWidth, measureDiv.clientWidth + 35);

        measureDiv.style.fontWeight = '400';
        measureDiv.style.fontSize = '13px';

        if (tbodyRef.current) {
            const rows = tbodyRef.current.children;
            for (let i = 0; i < rows.length; i++) {
                const cell = rows[i].children[colIndex];
                if (!cell) continue;

                const input = cell.querySelector('input, select');
                let text = '';
                if (input) {
                    if (input.tagName === 'SELECT') {
                        text = input.options[input.selectedIndex]?.text || '';
                    } else {
                        text = input.value;
                    }
                } else {
                    text = cell.textContent || '';
                }

                if (text) {
                    measureDiv.innerText = text;
                    maxWidth = Math.max(maxWidth, measureDiv.clientWidth + 45);
                }
            }
        }

        document.body.removeChild(measureDiv);

        setColumnWidths(prev => {
            const newWidths = { ...prev, [colId]: maxWidth };
            if (onConfigChange) {
                onConfigChange(visibleColumnsRef.current, newWidths);
            }
            return newWidths;
        });
    };

    useEffect(() => {
        if (isResizing) {
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, currentResizer]);

    // Async prop sync (e.g., when config is fetched from API after mount)
    useEffect(() => {
        if (initialVisibleColumns && initialVisibleColumns.length > 0) {
            setVisibleColumns(prev => {
                // Sadece gerçekten değiştiyse state'i güncelle (infinite render'ı engellemek için)
                if (JSON.stringify(prev) !== JSON.stringify(initialVisibleColumns)) {
                    return initialVisibleColumns;
                }
                return prev;
            });
        }
    }, [initialVisibleColumns]);

    useEffect(() => {
        if (initialColumnWidths) {
            setColumnWidths(prev => {
                let hasChanges = false;
                const newWidths = { ...prev };
                Object.keys(initialColumnWidths).forEach(key => {
                    if (newWidths[key] !== initialColumnWidths[key]) {
                        newWidths[key] = initialColumnWidths[key];
                        hasChanges = true;
                    }
                });
                return hasChanges ? newWidths : prev;
            });
        }
    }, [initialColumnWidths]);

    const handleKeyDown = (e, rowIndex, colIndex) => {
        if (e.defaultPrevented) return;

        const isLastRow = rowIndex === data.length - 1;
        const isLastFocusable = activeColumns[colIndex]?.isLastFocusable || colIndex === activeColumns.length - 1;
        const activeInput = e.target;

        const triggerAdd = () => {
            if (!checkCanAddRow(rowIndex)) {
                return;
            }
            if (onCustomAddAction) {
                onCustomAddAction();
            } else if (autoAddRow) {
                handleAddRequest();
            }
        };

        if (e.key === 'Tab' && !e.shiftKey && isLastRow && isLastFocusable) {
            e.preventDefault();
            if (!checkCanAddRow(rowIndex)) {
                return;
            }
            if (isEmptyRow && !isEmptyRow(data[rowIndex])) {
                triggerAdd();
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (isLastFocusable) {
                if (isLastRow) {
                    if (!checkCanAddRow(rowIndex)) {
                        return;
                    }
                    if (isEmptyRow && !isEmptyRow(data[rowIndex])) {
                        triggerAdd();
                    }
                } else {
                    focusFirstInputInRow(rowIndex + 1);
                }
            } else {
                let nextCol = colIndex + 1;
                while (nextCol < activeColumns.length) {
                    if (focusInputInCell(rowIndex, nextCol)) break;
                    nextCol++;
                }
            }
            return;
        }

        // Navigation keys
        const isInput = activeInput.tagName === 'INPUT' || activeInput.tagName === 'TEXTAREA';

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (rowIndex > 0) {
                focusInputInCell(rowIndex - 1, colIndex);
                if (isLastRow && isEmptyRow && isEmptyRow(data[rowIndex])) {
                    if (onRemoveRow) onRemoveRow(rowIndex);
                }
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (rowIndex < data.length - 1) {
                if (!focusInputInCell(rowIndex + 1, colIndex)) {
                    // Bulunduğumuz sütunda odaklanılacak eleman yoksa satır başından başlayarak ilk müsait elemanı bul
                    for (let c = 0; c < activeColumns.length; c++) {
                        if (focusInputInCell(rowIndex + 1, c)) break;
                    }
                }
            } else if (isLastRow) {
                const isCurrentEmpty = isEmptyRow ? isEmptyRow(data[rowIndex]) : false;
                if (!isCurrentEmpty) {
                    if (!checkCanAddRow(rowIndex)) {
                        return;
                    }
                    triggerAdd();
                }
            }
        } else if (e.key === 'ArrowLeft') {
            if (isInput && activeInput.type !== 'number' && (activeInput.selectionStart > 0 || activeInput.selectionEnd > 0)) {
                return;
            }
            e.preventDefault();
            let nextCol = colIndex - 1;
            while (nextCol >= 0) {
                if (focusInputInCell(rowIndex, nextCol)) break;
                nextCol--;
            }
        } else if (e.key === 'ArrowRight') {
            if (isInput && activeInput.type !== 'number' && activeInput.selectionStart < activeInput.value.length) {
                return;
            }
            e.preventDefault();
            let nextCol = colIndex + 1;
            while (nextCol < activeColumns.length) {
                if (focusInputInCell(rowIndex, nextCol)) break;
                nextCol++;
            }
        }
    };


    const handleDragStart = (e, colId) => {
        if (isResizing || e.target.closest?.('.spreadsheet-resize-handle')) {
            e.preventDefault();
            return;
        }
        setDraggedColId(colId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', colId);
    };

    const handleHeaderClick = (e, colId) => {
        if (e.ctrlKey || e.metaKey) {
            setSortConfig(null);
            if (onSort) onSort(null, null);
            return;
        }

        let direction = 'asc';
        if (sortConfig && sortConfig.key === colId && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key: colId, direction });
        if (onSort) onSort(colId, direction);
    };

    const handleDragOver = (e, colId) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverColId !== colId) {
            setDragOverColId(colId);
        }
    };

    const handleDrop = (e, targetColId) => {
        e.preventDefault();
        setDragOverColId(null);
        const droppedId = e.dataTransfer.getData('text/plain') || draggedColId;
        if (!droppedId || droppedId === targetColId) return;

        setVisibleColumns(prev => {
            const newCols = [...prev];
            const dragIndex = newCols.indexOf(droppedId);
            const dropIndex = newCols.indexOf(targetColId);

            if (dragIndex !== -1 && dropIndex !== -1) {
                newCols.splice(dragIndex, 1);
                newCols.splice(dropIndex, 0, droppedId);
                if (onConfigChange) onConfigChange(newCols, columnWidthsRef.current);
                return newCols;
            }
            return prev;
        });
        setDraggedColId(null);
    };

    const handleDragEnd = () => {
        setDraggedColId(null);
        setDragOverColId(null);
    };

    const handleFocusIn = (e) => {
        const tr = e.target.closest('tr');
        if (tr && tbodyRef.current) {
            const index = Array.from(tbodyRef.current.children).indexOf(tr);
            const prevIndex = lastFocusedRowIndexRef.current;

            // Eğer farklı bir satıra geçildiyse ve önceki satır tablonun SON satırı ise ve BOŞ ise onu sil
            if (prevIndex !== -1 && prevIndex !== index && prevIndex === data.length - 1) {
                if (isEmptyRow && isEmptyRow(data[prevIndex])) {
                    if (onRemoveRow) {
                        onRemoveRow(prevIndex);
                    }
                }
            }
            lastFocusedRowIndexRef.current = index;
        }
    };

    // Satırın boş olup olmadığını tespit eden yardımcı kontrol
    const isRowEmpty = (r: any): boolean => {
        if (!r) return true;
        if (typeof isEmptyRow === 'function') {
            return isEmptyRow(r);
        }
        return Object.entries(r).every(([key, val]) => {
            if (key === 'id' || key === 'siraNo' || key === 'key' || key === '_id' || key === 'kalemTuru') return true;
            return val === null || val === undefined || val === '' || val === 0;
        });
    };

    const hasNoRows = !data || data.length === 0 || data.every(r => isRowEmpty(r));

    return (
        <div className={`spreadsheet-container ${(isInvalid || Boolean(error)) ? 'has-error' : ''}`} style={{ position: 'relative' }}>
            {/* Sütun Menüsü */}
            {showColumnMenu && createPortal(
                <div className="spreadsheet-overlay">
                    <div
                        className="spreadsheet-overlay-backdrop"
                        onClick={(e) => { e.stopPropagation(); setShowColumnMenu(false); }}
                    />
                    <div 
                        className="spreadsheet-column-menu"
                        style={{
                            top: menuPosition.top,
                            left: menuPosition.left
                        }}
                    >
                        <div className="spreadsheet-column-menu-header">
                            <span>{t('auto_sutun_gorunumu_ff99')}</span>
                            <button onClick={() => setShowColumnMenu(false)} className="spreadsheet-column-menu-close"><X size={14} /></button>
                        </div>
                        {columns.filter(col => col.header).map((col, idx) => {
                            const colId = col.id || idx.toString();
                            return (
                                <label key={colId} className="spreadsheet-column-menu-item">
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.includes(colId)}
                                        onChange={() => toggleColumn(colId)}
                                    />
                                    {col.header}
                                </label>
                            );
                        })}
                    </div>
                </div>,
                document.body
            )}

            {/* Mobil Edit Modal */}
            <SpreadsheetGridRowEdit
                isOpen={isMobile && mobileEditRowIndex !== null}
                onClose={() => setMobileEditRowIndex(null)}
                rowIndex={mobileEditRowIndex}
                data={data}
                activeColumns={activeColumns}
                isEmptyRow={isEmptyRow}
                onRemoveRow={onRemoveRow}
            />

            {/* Grid veya Mobil Liste */}
            {isMobile ? (
                <SpreadsheetCardView
                    data={data}
                    isEmptyRow={isEmptyRow}
                    setMobileEditRowIndex={setMobileEditRowIndex}
                    mobileCardRender={mobileCardRender}
                    autoAddRow={autoAddRow}
                    onAddRow={onAddRow}
                    onCustomAddAction={onCustomAddAction}
                    handleAddRequest={handleAddRequest}
                    customAddIcon={customAddIcon}
                    additionalAddActions={additionalAddActions}
                />
            ) : (
                <div
                    className={bordered ? "spreadsheet-table-wrapper spreadsheet-table-wrapper-bordered" : "spreadsheet-table-wrapper"}
                    onClick={(e) => {
                        // Sadece grid'in boş alanına tıklanırsa (hücrenin kendisine değil, tablo arka planına)
                        if (autoAddRow && (e.target === e.currentTarget || e.target.tagName === 'TABLE' || e.target.tagName === 'TBODY')) {
                            handleAddRequest(e);
                        }
                    }}
                >
                    <table className="spreadsheet-table" style={{ minWidth: tableMinWidth }}>
                        <colgroup>
                            {activeColumns.map((col, idx) => {
                                const colId = col.id || idx.toString();
                                const widthVal = columnWidths[colId];
                                return <col key={colId} style={{ width: typeof widthVal === 'number' ? `${widthVal}px` : widthVal }} />;
                            })}
                            <col className="spreadsheet-settings-col" style={{ width: '40px' }} />
                        </colgroup>
                        <thead className="spreadsheet-thead">
                            <tr className="spreadsheet-header-row">
                                {activeColumns.map((col, idx) => {
                                    const colId = col.id || idx.toString();
                                    const widthVal = columnWidths[colId];
                                    return (
                                        <th
                                            key={colId}
                                            draggable={!isResizing}
                                            onDragStart={(e) => handleDragStart(e, colId)}
                                            onDragEnter={(e) => e.preventDefault()}
                                            onDragOver={(e) => handleDragOver(e, colId)}
                                            onDrop={(e) => handleDrop(e, colId)}
                                            onDragEnd={handleDragEnd}
                                            className="spreadsheet-th"
                                            style={{
                                                width: typeof widthVal === 'number' ? `${widthVal}px` : widthVal,
                                                minWidth: typeof widthVal === 'number' ? `${widthVal}px` : undefined,
                                                opacity: draggedColId === colId ? 0.5 : 1,
                                                background: dragOverColId === colId ? 'rgba(99, 102, 241, 0.05)' : '',
                                                boxShadow: dragOverColId === colId ? 'inset 4px 0 0 var(--accent-primary)' : 'none',
                                            }}
                                        >
                                            {/* position:relative wrapper - resizer handle'ların absolute konumlanması için */}
                                            <div className="spreadsheet-th-cell">
                                                <div className="spreadsheet-th-content">
                                                    {/* Drag Handle */}
                                                    <div className="spreadsheet-drag-handle">
                                                        <GripVertical size={14} />
                                                    </div>

                                                    {/* Header Content */}
                                                    <div
                                                        className="spreadsheet-th-label-wrapper"
                                                        onClick={(e) => handleHeaderClick(e, colId)}
                                                    >
                                                        <span 
                                                            className="spreadsheet-th-label"
                                                            style={{ textAlign: col.align || 'left' }}
                                                        >
                                                            {col.header}
                                                        </span>
                                                        {sortConfig?.key === colId && (
                                                            <span className="spreadsheet-sort-icon">
                                                                {sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {/* Sağ Resizer Handle */}
                                                <div
                                                    draggable={false}
                                                    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                    onMouseDown={(e) => handleMouseDown(e, colId)}
                                                    onDoubleClick={(e) => handleDoubleClick(e, colId, idx)}
                                                    className={`spreadsheet-resize-handle ${isResizing && currentResizer?.colId === colId ? 'is-active' : ''}`}
                                                    style={{ cursor: 'col-resize' }}
                                                />
                                            </div>
                                        </th>
                                    );
                                })}

                                {/* Sütun Ayarları/Aksiyonlar Sütunu (Sabit/Sağda veya Sütunların En Sağında) */}
                                <th className={`spreadsheet-th spreadsheet-settings-column ${isPinned ? 'is-pinned' : 'is-inline'}`}>
                                    <button
                                        type="button"
                                        className="spreadsheet-column-settings-btn"
                                        onClick={(e) => {
                                             e.stopPropagation();
                                             if (!showColumnMenu) {
                                                 const rect = e.currentTarget.getBoundingClientRect();
                                                 setMenuPosition({
                                                     top: rect.bottom + 4,
                                                     left: Math.max(8, rect.right - 200) // 200px is the menu width
                                                 });
                                             }
                                             setShowColumnMenu(!showColumnMenu);
                                        }}
                                        title={t('Sütun Ayarları', 'Sütun Ayarları')}
                                    >
                                        <Settings size={16} />
                                    </button>
                                </th>
                            </tr>
                        </thead>
                        <tbody ref={tbodyRef} onFocusCapture={handleFocusIn}>
                            {data.map((row, rowIndex) => {
                                const isCurrentRowEmpty = isRowEmpty(row);
                                return (
                                <tr
                                    key={row.id || rowIndex}
                                    id={`spreadsheet-row-${row.id || rowIndex}`}
                                    data-row-id={row.id}
                                    data-row-index={rowIndex}
                                    className={`spreadsheet-row ${isCurrentRowEmpty ? 'is-empty-row' : ''} ${striped ? 'striped-row' : ''} ${(selectedRow === rowIndex || selectedRowIndex === rowIndex) ? 'selected active-row' : ''}`}
                                    onClick={(e) => {
                                        setSelectedRow(rowIndex);
                                        if (onRowClick) onRowClick(row, rowIndex, e);
                                    }}
                                    onDoubleClick={(e) => {
                                        if (onRowDoubleClick) {
                                            onRowDoubleClick(row, rowIndex, e);
                                        } else if (computedRowActions && computedRowActions.length > 0) {
                                            const defaultAction = computedRowActions[0];
                                            if (defaultAction && defaultAction.onClick) {
                                                defaultAction.onClick(row, rowIndex);
                                            }
                                        }
                                    }}
                                >
                                    {activeColumns.map((col, colIndex) => {
                                        // Hiçbir satır olmadığı durumda veya bu satır henüz doldurulmamış boş bir satır ise zorunlu alanlar / geçersiz hücreler işaretlenmez
                                        const isCellInvalid = (hasNoRows || isCurrentRowEmpty)
                                            ? false
                                            : (typeof col.isInvalid === 'function' 
                                                ? col.isInvalid(row, rowIndex) 
                                                : (col.isInvalid !== undefined 
                                                    ? Boolean(col.isInvalid) 
                                                    : Boolean(col.required && (row[col.id] === undefined || row[col.id] === null || row[col.id] === ''))
                                                  )
                                              );
                                        const customCellClass = typeof col.cellClassName === 'function' ? col.cellClassName(row, rowIndex) : (col.cellClassName || '');
                                        return (
                                            <td
                                                key={col.id || colIndex}
                                                className={`spreadsheet-cell ${isCellInvalid ? 'is-invalid' : ''} ${customCellClass}`}
                                                style={{
                                                    padding: col.padding !== undefined ? col.padding : 0,
                                                    borderRight: '1px solid var(--glass-border)',
                                                    borderBottom: '1px solid var(--glass-border)',
                                                    verticalAlign: 'middle',
                                                    textAlign: col.align || 'left',
                                                    overflow: 'hidden'
                                                }}
                                                onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                                            >
                                                {typeof col.render === 'function' ? col.render(row, rowIndex) : (col.id ? row[col.id] : '')}
                                            </td>
                                        );
                                    })}
                                    {/* Sağ Sütun: Satır Menüsü */}
                                    <td 
                                        className={`spreadsheet-cell spreadsheet-row-actions-cell ${isPinned ? 'is-pinned' : 'is-inline'}`}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Tab' && !e.shiftKey && rowIndex === data.length - 1) {
                                                e.preventDefault();
                                                if (!checkCanAddRow(rowIndex)) {
                                                    return;
                                                }
                                                if (isEmptyRow && !isEmptyRow(data[rowIndex])) {
                                                    if (onCustomAddAction) {
                                                        onCustomAddAction();
                                                    } else if (autoAddRow) {
                                                        handleAddRequest();
                                                    }
                                                }
                                            }
                                        }}
                                    >
                                        {computedRowActions.length > 0 && (
                                            <div className="spreadsheet-row-actions spreadsheet-row-actions-container">
                                                <ActionMenu
                                                    triggerIcon={<MoreVertical size={16} />}
                                                    actions={computedRowActions.map((action) => ({
                                                        icon: action.icon,
                                                        label: action.label || t('İşlem', 'İşlem'),
                                                        variant: (action.danger || action.className?.includes('danger')) ? 'danger' : 'secondary',
                                                        onClick: (e) => {
                                                            if (e && e.stopPropagation) e.stopPropagation();
                                                            if (action.onClick) action.onClick(row, rowIndex);
                                                        }
                                                    }))}
                                                />
                                            </div>
                                        )}
                                    </td>
                                </tr>
                                );
                            })}
                            {data.length === 0 && (
                                <tr>
                                    <td 
                                        colSpan={activeColumns.length + 1} 
                                        className="spreadsheet-empty-row"
                                        onClick={(e) => {
                                            if (autoAddRow) {
                                                handleAddRequest(e);
                                            }
                                        }}
                                        style={{ cursor: autoAddRow ? 'pointer' : 'default' }}
                                    >
                                        <div className="spreadsheet-add-button-wrapper" style={{ marginBottom: (autoAddRow && (onAddRow || onCustomAddAction)) ? '12px' : '0' }}>
                                            {t('auto_kayit_bulunamadi_3696', 'Kayıt bulunamadı.')}
                                            <div className="spreadsheet-empty-text">
                                                {autoAddRow 
                                                    ? t('auto_yeni_satir_icin_tiklayin', 'Yeni satır eklemek için buraya dokunun veya tıklayın.')
                                                    : t('auto_yeni_satir_eklemek_i_4e86', 'Yeni satır eklemek için satır sonundaki menüyü veya mobil cihazda iseniz ekle düğmesini kullanabilirsiniz.')}
                                            </div>
                                        </div>
                                        {autoAddRow && !useFloatAddButton && (onAddRow || onCustomAddAction) && (
                                            <button
                                                type="button"
                                                className="btn btn-outline"
                                                onClick={handleAddRequest}
                                            >
                                                {t('auto__yeni_satir_ekle_582f', '+ Yeni Satır Ekle')}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {!autoAddRow && (onAddRow || onCustomAddAction) && isMobile && (
                <button
                    type="button"
                    onClick={handleAddRequest}
                    className="spreadsheet-mobile-add-btn"
                >
                    {customAddIcon ? customAddIcon : <Plus size={24} />}
                </button>
            )}

            {useFloatAddButton && (onAddRow || onCustomAddAction) && !isMobile && (
                <EkleFloatCircleButton onClick={handleAddRequest} position="absolute-bottom-right" />
            )}
        </div>
    );
};

export default SpreadsheetGrid;
