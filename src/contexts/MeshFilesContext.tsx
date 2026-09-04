import { createContext, useContext, useRef, useCallback } from 'react';

interface MeshFilesContextType {
  // Store a mesh file by filename, optionally scoped to a conversationId
  setMeshFile: (
    filename: string,
    content: Blob,
    conversationId?: string,
  ) => void;
  // Get a mesh file by filename, optionally scoped to a conversationId
  getMeshFile: (
    filename: string,
    conversationId?: string,
  ) => Blob | undefined;
  // Check if a mesh file exists, optionally scoped to a conversationId
  hasMeshFile: (filename: string, conversationId?: string) => boolean;
  // Clear all mesh files or files for a specific conversation
  clearMeshFiles: (conversationId?: string) => void;
}

export const MeshFilesContext = createContext<MeshFilesContextType | undefined>(
  undefined,
);

export function MeshFilesProvider({ children }: { children: React.ReactNode }) {
  // Use ref to avoid re-renders when files are added
  const meshFilesRef = useRef<Map<string, Blob>>(new Map());

  const makeKey = (filename: string, conversationId?: string): string => {
    return conversationId ? `${conversationId}:${filename}` : filename;
  };

  const setMeshFile = useCallback(
    (filename: string, content: Blob, conversationId?: string) => {
      console.log(
        `[MeshFiles] Storing: "${filename}"${
          conversationId ? ` (conv: ${conversationId})` : ''
        } (${content.size} bytes)`,
      );
      meshFilesRef.current.set(makeKey(filename, conversationId), content);
      // Also store with plain filename as fallback if no collision
      if (conversationId && !meshFilesRef.current.has(filename)) {
        meshFilesRef.current.set(filename, content);
      }
    },
    [],
  );

  const getMeshFile = useCallback(
    (filename: string, conversationId?: string): Blob | undefined => {
      if (conversationId) {
        const scoped = meshFilesRef.current.get(makeKey(filename, conversationId));
        if (scoped) return scoped;
      }
      return meshFilesRef.current.get(filename);
    },
    [],
  );

  const hasMeshFile = useCallback(
    (filename: string, conversationId?: string): boolean => {
      if (conversationId) {
        if (meshFilesRef.current.has(makeKey(filename, conversationId))) {
          return true;
        }
      }
      return meshFilesRef.current.has(filename);
    },
    [],
  );

  const clearMeshFiles = useCallback((conversationId?: string) => {
    if (!conversationId) {
      meshFilesRef.current.clear();
      return;
    }
    const prefix = `${conversationId}:`;
    for (const key of Array.from(meshFilesRef.current.keys())) {
      if (key.startsWith(prefix)) {
        meshFilesRef.current.delete(key);
      }
    }
  }, []);

  return (
    <MeshFilesContext.Provider
      value={{ setMeshFile, getMeshFile, hasMeshFile, clearMeshFiles }}
    >
      {children}
    </MeshFilesContext.Provider>
  );
}

export function useMeshFiles() {
  const context = useContext(MeshFilesContext);
  if (context === undefined) {
    throw new Error('useMeshFiles must be used within a MeshFilesProvider');
  }
  return context;
}
