import { createContext, useContext, useRef, useState, useCallback } from 'react';

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
  // Reactive version counter incremented whenever files are updated
  filesVersion: number;
}

export const MeshFilesContext = createContext<MeshFilesContextType | undefined>(
  undefined,
);

export function MeshFilesProvider({ children }: { children: React.ReactNode }) {
  const meshFilesRef = useRef<Map<string, Blob>>(new Map());
  const [filesVersion, setFilesVersion] = useState(0);

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
      const key = makeKey(filename, conversationId);
      const prev = meshFilesRef.current.get(key);
      if (prev !== content) {
        meshFilesRef.current.set(key, content);
        setFilesVersion((v) => v + 1);
      }
    },
    [],
  );

  const getMeshFile = useCallback(
    (filename: string, conversationId?: string): Blob | undefined => {
      if (conversationId) {
        const scoped = meshFilesRef.current.get(makeKey(filename, conversationId));
        if (scoped) return scoped;

        // Check base filename without folder path under the same conversation
        const baseName = filename.split('/').pop();
        if (baseName && baseName !== filename) {
          const scopedBase = meshFilesRef.current.get(
            makeKey(baseName, conversationId),
          );
          if (scopedBase) return scopedBase;
        }

        return undefined;
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
        const baseName = filename.split('/').pop();
        if (baseName && baseName !== filename) {
          if (meshFilesRef.current.has(makeKey(baseName, conversationId))) {
            return true;
          }
        }
        return false;
      }
      return meshFilesRef.current.has(filename);
    },
    [],
  );

  const clearMeshFiles = useCallback((conversationId?: string) => {
    if (!conversationId) {
      meshFilesRef.current.clear();
      setFilesVersion((v) => v + 1);
      return;
    }
    const prefix = `${conversationId}:`;
    let hasDeleted = false;
    for (const key of Array.from(meshFilesRef.current.keys())) {
      if (key.startsWith(prefix)) {
        meshFilesRef.current.delete(key);
        hasDeleted = true;
      }
    }
    if (hasDeleted) {
      setFilesVersion((v) => v + 1);
    }
  }, []);

  return (
    <MeshFilesContext.Provider
      value={{
        setMeshFile,
        getMeshFile,
        hasMeshFile,
        clearMeshFiles,
        filesVersion,
      }}
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
