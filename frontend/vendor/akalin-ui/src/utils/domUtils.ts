/**
 * @file domUtils.ts
 * @description Akalin UI - DOM, Title and Focus Helpers
 */

/**
 * Extracts plain text from a ReactNode or any value.
 */
export const extractTextFromNode = (node: any): string => {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTextFromNode).filter(Boolean).join(' ');
  }
  if (typeof node === 'object' && node.props && node.props.children) {
    return extractTextFromNode(node.props.children);
  }
  return '';
};

/**
 * Sets document.title formatted as "[Title] | Akalin UI".
 */
export const updateDocumentTitle = (title?: any, brandSuffix = 'Akalin UI'): void => {
  if (typeof document === 'undefined') return;
  const clean = extractTextFromNode(title).trim();
  if (clean) {
    document.title = `${clean} | ${brandSuffix}`;
  }
};

/**
 * Automatically focuses the first interactive, visible input within a container or document.
 */
export const autoFocusFirstInput = (container?: HTMLElement | null): void => {
  if (typeof document === 'undefined') return;

  const rootNode = container || document;
  const activeEl = document.activeElement;

  if (activeEl && activeEl !== document.body && activeEl !== document.documentElement) {
    const tag = activeEl.tagName?.toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || activeEl.getAttribute('tabindex') !== null) {
      return;
    }
  }

  if (container && container.contains(activeEl)) {
    return;
  }

  const focusable = rootNode.querySelectorAll<HTMLElement>(
    'input:not([disabled]):not([type="hidden"]):not([readonly]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );

  for (let i = 0; i < focusable.length; i++) {
    const el = focusable[i];
    const style = window.getComputedStyle(el);
    if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0) {
      el.focus({ preventScroll: true });
      break;
    }
  }
};
