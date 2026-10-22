/**
 * @file tableUtils.ts
 * @description Akalin UI - Internal Table Navigation and Action Utilities
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface InternalTableNavProps<T = any> {
  data: T[];
  isActive?: boolean;
  onEdit?: (item: T, e?: any) => void;
  onDelete?: (item: T) => void;
  onAddNew?: (e?: any) => void;
  onAddChild?: (item: T, e?: any) => void;
  onArrowRight?: (item: T) => void;
  onArrowLeft?: (item: T) => void;
  highlightedId?: string | number | null;
  storageKey?: string;
  initialSelectedId?: string | number | null;
}

export const useInternalTableNavigation = <T = any>({
  data,
  isActive = true,
  onEdit,
  onDelete,
  onAddNew,
  onAddChild,
  onArrowRight,
  onArrowLeft,
  highlightedId = null,
  storageKey,
  initialSelectedId = null
}: InternalTableNavProps<T>) => {
  const [selectedIndex, setSelectedIndexState] = useState(0);
  const initialTargetIdRef = useRef<string | number | null>(null);
  const hasInitializedTargetRef = useRef(false);
  const hasRestoredRef = useRef(false);

  const setSelectedIndex = useCallback((valOrUpdater: number | ((prev: number) => number)) => {
    hasRestoredRef.current = true;
    setSelectedIndexState(valOrUpdater);
  }, []);

  const stateRef = useRef({ data, selectedIndex, onEdit, onDelete, onAddNew, onAddChild, onArrowRight, onArrowLeft });
  useEffect(() => {
    stateRef.current = { data, selectedIndex, onEdit, onDelete, onAddNew, onAddChild, onArrowRight, onArrowLeft };
  });

  const lastHighlightedId = useRef<string | number | null>(null);

  useEffect(() => {
    if (highlightedId && highlightedId !== lastHighlightedId.current && data && data.length > 0) {
      const index = data.findIndex((item: any) => String(item?.id ?? item?.Id ?? item?.kod) === String(highlightedId));
      if (index !== -1) {
        setSelectedIndex(index);
        lastHighlightedId.current = highlightedId;
      }
    }
    if (!highlightedId) {
      lastHighlightedId.current = null;
    }
  }, [highlightedId, data, setSelectedIndex]);

  if (!hasInitializedTargetRef.current) {
    initialTargetIdRef.current = initialSelectedId ?? (storageKey ? (() => {
      try {
        return sessionStorage.getItem(storageKey);
      } catch (e) {
        return null;
      }
    })() : null);
    hasInitializedTargetRef.current = true;
  }

  useEffect(() => {
    const targetId = initialSelectedId || initialTargetIdRef.current;
    if (targetId && data && data.length > 0) {
      const index = data.findIndex((item: any) =>
        String(item?.id ?? item?.Id ?? item?.kod) === String(targetId)
      );
      if (index !== -1) {
        setSelectedIndex(index);
        hasRestoredRef.current = true;
      }
    }
  }, [initialSelectedId, data, setSelectedIndex]);

  useEffect(() => {
    if (initialTargetIdRef.current && !hasRestoredRef.current) {
      return;
    }
    if (storageKey && data && data[selectedIndex]) {
      const item = data[selectedIndex];
      const itemId = (item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod;
      if (itemId) {
        try {
          sessionStorage.setItem(storageKey, String(itemId));
        } catch (e) {}
      }
    }
  }, [selectedIndex, data, storageKey]);

  useEffect(() => {
    if (data && data.length > 0) {
      if (selectedIndex >= data.length) {
        setSelectedIndex(Math.max(0, data.length - 1));
      }
    } else {
      setSelectedIndex(0);
    }
  }, [data, selectedIndex, setSelectedIndex]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
      }

      const { data: currentData, selectedIndex: currentIndex, onEdit: editCb, onDelete: delCb, onAddNew: addCb } = stateRef.current;
      if (!currentData || currentData.length === 0) {
        if (e.key === 'Insert' && addCb) {
          e.preventDefault();
          addCb(e);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, currentData.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          setSelectedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setSelectedIndex(currentData.length - 1);
          break;
        case 'Enter':
          if (editCb && currentData[currentIndex]) {
            e.preventDefault();
            editCb(currentData[currentIndex], e);
          }
          break;
        case 'Delete':
          if (delCb && currentData[currentIndex]) {
            e.preventDefault();
            delCb(currentData[currentIndex]);
          }
          break;
        case 'Insert':
          if (addCb) {
            e.preventDefault();
            addCb(e);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, setSelectedIndex]);

  return { selectedIndex, setSelectedIndex };
};

export const useInternalTableAction = (onRefresh?: () => void) => {
  const [highlightedId, setHighlightedId] = useState<string | number | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'RECORD_ADDED') {
        const newId = event.data.id;
        if (newId) {
          setHighlightedId(newId);
          if (typeof onRefresh === 'function') {
            onRefresh();
          }
          setTimeout(() => {
            setHighlightedId(null);
          }, 5000);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRefresh]);

  return {
    highlightedId,
    setHighlightedId,
    triggerAction: setHighlightedId
  };
};
