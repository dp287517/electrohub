// useFormDraft.js - Hook for auto-saving form data to localStorage
// Prevents data loss when user navigates away or closes the browser

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for auto-saving form data to localStorage
 *
 * @param {string} formKey - Unique key to identify this form (e.g., 'datahub_equipment_form')
 * @param {object} initialData - Initial form data
 * @param {object} options - Options
 * @param {number} options.debounceMs - Debounce delay in ms (default: 1000)
 * @param {number} options.maxAgeMs - Max age before draft expires (default: 24 hours)
 * @param {function} options.onRestore - Callback when draft is restored
 *
 * @returns {object} { formData, setFormData, clearDraft, hasDraft, lastSaved }
 */
export function useFormDraft(formKey, initialData = {}, options = {}) {
  const {
    debounceMs = 1000,
    maxAgeMs = 24 * 60 * 60 * 1000, // 24 hours
    onRestore = null,
  } = options;

  const [formData, setFormDataInternal] = useState(initialData);
  const [hasDraft, setHasDraft] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const saveTimeoutRef = useRef(null);
  const isInitializedRef = useRef(false);

  // Generate storage key with site prefix for multi-tenant support
  const getStorageKey = useCallback(() => {
    const site = localStorage.getItem('selectedSite') || localStorage.getItem('site') || 'default';
    return `form_draft_${site}_${formKey}`;
  }, [formKey]);

  // Load draft from localStorage on mount
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    try {
      const storageKey = getStorageKey();
      const savedDraft = localStorage.getItem(storageKey);

      if (savedDraft) {
        const draft = JSON.parse(savedDraft);

        // Check if draft is still valid (not expired)
        if (draft.timestamp && (Date.now() - draft.timestamp) < maxAgeMs) {
          setFormDataInternal(draft.data);
          setHasDraft(true);
          setLastSaved(new Date(draft.timestamp));
          console.log(`[FormDraft] Restored draft for ${formKey}`);

          if (onRestore) {
            onRestore(draft.data);
          }
        } else {
          // Draft expired, remove it
          localStorage.removeItem(storageKey);
          console.log(`[FormDraft] Draft expired for ${formKey}`);
        }
      }
    } catch (e) {
      console.error('[FormDraft] Error loading draft:', e);
    }
  }, [formKey, maxAgeMs, onRestore, getStorageKey]);

  // Save to localStorage with debounce
  const saveDraft = useCallback((data) => {
    try {
      const storageKey = getStorageKey();
      const draft = {
        data,
        timestamp: Date.now(),
        formKey,
      };
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setLastSaved(new Date());
      setHasDraft(true);
    } catch (e) {
      console.error('[FormDraft] Error saving draft:', e);
    }
  }, [formKey, getStorageKey]);

  // Debounced save
  useEffect(() => {
    if (!isInitializedRef.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveDraft(formData);
    }, debounceMs);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [formData, debounceMs, saveDraft]);

  // Set form data
  const setFormData = useCallback((newData) => {
    if (typeof newData === 'function') {
      setFormDataInternal(prev => {
        const updated = newData(prev);
        return updated;
      });
    } else {
      setFormDataInternal(newData);
    }
  }, []);

  // Update a single field
  const updateField = useCallback((field, value) => {
    setFormDataInternal(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  // Clear draft from localStorage
  const clearDraft = useCallback(() => {
    try {
      const storageKey = getStorageKey();
      localStorage.removeItem(storageKey);
      setHasDraft(false);
      setLastSaved(null);
      console.log(`[FormDraft] Cleared draft for ${formKey}`);
    } catch (e) {
      console.error('[FormDraft] Error clearing draft:', e);
    }
  }, [formKey, getStorageKey]);

  // Reset to initial data and clear draft
  const resetForm = useCallback(() => {
    setFormDataInternal(initialData);
    clearDraft();
  }, [initialData, clearDraft]);

  return {
    formData,
    setFormData,
    updateField,
    clearDraft,
    resetForm,
    hasDraft,
    lastSaved,
  };
}

/**
 * Simple hook for saving any state to localStorage
 *
 * @param {string} key - Storage key
 * @param {any} initialValue - Initial value
 * @returns {[any, function]} [value, setValue]
 */
export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (e) {
      console.error('[useLocalStorage] Error reading:', e);
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (e) {
      console.error('[useLocalStorage] Error saving:', e);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}

export default useFormDraft;
