/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type SettingsContextValue = {
  isDevMode: boolean;
  setDevMode: (value: boolean) => void;
  useExperimentalEditor: boolean;
  setUseExperimentalEditor: (value: boolean) => void;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

const DEV_MODE_KEY = 'adam.settings.devMode';
const EDITOR_KEY = 'adam.settings.experimentalEditor';

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored === null) return fallback;
  return stored === 'true';
}

function persistBoolean(key: string, value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value ? 'true' : 'false');
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [isDevMode, setDevMode] = useState<boolean>(() =>
    readStoredBoolean(DEV_MODE_KEY, false),
  );
  const [useExperimentalEditor, setUseExperimentalEditorState] =
    useState<boolean>(() => readStoredBoolean(EDITOR_KEY, false));

  useEffect(() => {
    persistBoolean(DEV_MODE_KEY, isDevMode);
  }, [isDevMode]);

  useEffect(() => {
    persistBoolean(EDITOR_KEY, useExperimentalEditor);
  }, [useExperimentalEditor]);

  useEffect(() => {
    if (!isDevMode && useExperimentalEditor) {
      setUseExperimentalEditorState(false);
    }
  }, [isDevMode, useExperimentalEditor]);

  const setUseExperimentalEditor = useCallback((value: boolean) => {
    setUseExperimentalEditorState(value);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      isDevMode,
      setDevMode,
      useExperimentalEditor,
      setUseExperimentalEditor,
    }),
    [isDevMode, setUseExperimentalEditor, useExperimentalEditor],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
