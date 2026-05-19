import { useState, useCallback, useRef, useEffect } from 'react';
import {
  OpenSCADWorkerResponseData,
  WorkerMessage,
  WorkerMessageType,
} from '@/worker/types';
import OpenSCADError from '@/lib/OpenSCADError';
import { normalizeOpenSCADDxf } from '@/utils/dxfUtils';

// Type for pending request resolvers
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export function useOpenSCAD() {
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<OpenSCADError | Error | undefined>();
  const [isError, setIsError] = useState(false);
  const [output, setOutput] = useState<Blob | undefined>();
  const [offOutput, setOffOutput] = useState<Blob | undefined>();
  // Per-instance worker. Each useOpenSCAD() call owns its own Web Worker so
  // listeners only see their own compile/export results — sharing a single
  // worker across multiple useOpenSCAD() consumers means every listener fires
  // on every other consumer's responses, which corrupts state (STL bytes from
  // a `VisualCard` thumbnail compile leaking into `OpenSCADViewer`'s output,
  // for instance) and produces "Array buffer allocation failed" parse errors.
  const workerRef = useRef<Worker | null>(null);
  // Track files written to the worker filesystem.
  const writtenFilesRef = useRef<Set<string>>(new Set());
  // Track pending requests waiting for worker responses.
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());
  // Holds a deferred-teardown timeout id. Strict mode runs effect mount →
  // cleanup → mount synchronously, so if we tore down the worker inside the
  // cleanup we'd kill the worker right after a consumer (e.g.
  // `OpenSCADGifPreview`) had queued an `exportScad` against it — rejecting
  // their promise with "Worker terminated" even though the component never
  // actually unmounted. Deferring the teardown one tick lets the synchronous
  // remount cancel it; for a real unmount the timeout fires and the worker is
  // terminated normally.
  const teardownTimeoutRef = useRef<number | null>(null);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../worker/worker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    return workerRef.current;
  }, []);

  const eventHandler = useCallback((event: MessageEvent) => {
    const { id, type, err } = event.data;

    // Check if this is a response to a pending request (fs operations)
    if (id && pendingRequestsRef.current.has(id)) {
      const pending = pendingRequestsRef.current.get(id)!;
      pendingRequestsRef.current.delete(id);

      if (err) {
        pending.reject(new Error(err.message || 'Worker operation failed'));
      } else {
        pending.resolve(event.data.data);
      }
      return;
    }

    // Handle preview/export responses (state-based)
    if (
      type === WorkerMessageType.PREVIEW ||
      type === WorkerMessageType.EXPORT
    ) {
      if (err) {
        setError(err);
        setIsError(true);
        setOutput(undefined);
        setOffOutput(undefined);
      } else if (event.data.data?.output) {
        const blob = new Blob([event.data.data.output], {
          type:
            event.data.data.fileType === 'stl' ? 'model/stl' : 'image/svg+xml',
        });
        setOutput(blob);

        const offBytes = event.data.data.extraOutputs?.off;
        setOffOutput(
          offBytes ? new Blob([offBytes], { type: 'text/plain' }) : undefined,
        );
      }
      setIsCompiling(false);
    }
  }, []);

  useEffect(() => {
    if (teardownTimeoutRef.current !== null) {
      clearTimeout(teardownTimeoutRef.current);
      teardownTimeoutRef.current = null;
    }
    const worker = getWorker();
    worker.addEventListener('message', eventHandler);

    return () => {
      worker.removeEventListener('message', eventHandler);
      teardownTimeoutRef.current = window.setTimeout(() => {
        workerRef.current?.terminate();
        workerRef.current = null;
        writtenFilesRef.current.clear();
        pendingRequestsRef.current.forEach((pending) => {
          pending.reject(new Error('Worker terminated'));
        });
        pendingRequestsRef.current.clear();
        teardownTimeoutRef.current = null;
      }, 0);
    };
  }, [eventHandler, getWorker]);

  // Write a file to the OpenSCAD worker filesystem
  // Returns a promise that resolves when the worker confirms the write
  const writeFile = useCallback(
    async (path: string, content: Blob | File): Promise<void> => {
      const worker = getWorker();

      const arrayBuffer = await content.arrayBuffer();

      const requestId = `fs-write-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const responsePromise = new Promise<void>((resolve, reject) => {
        pendingRequestsRef.current.set(requestId, {
          resolve: () => resolve(),
          reject,
        });
      });

      const message: WorkerMessage & { id: string } = {
        id: requestId,
        type: WorkerMessageType.FS_WRITE,
        data: {
          path,
          content: arrayBuffer,
          type: content.type,
        },
      };

      // Transfer the ArrayBuffer to the worker (zero-copy transfer)
      worker.postMessage(message, [arrayBuffer]);

      await responsePromise;
      writtenFilesRef.current.add(path);
    },
    [getWorker],
  );

  const compileScad = useCallback(
    async (code: string) => {
      setIsCompiling(true);
      setError(undefined);
      setIsError(false);

      const worker = getWorker();

      const message: WorkerMessage = {
        type: WorkerMessageType.PREVIEW,
        data: {
          code,
          params: [],
          fileType: 'stl',
        },
      };

      worker.postMessage(message);
    },
    [getWorker],
  );

  // Run PREVIEW from the worker without touching preview state, returning
  // both the primary STL blob and (when emitted) the OFF companion that
  // carries per-face color() data. The state-based `compileScad` path is for
  // the live viewer; this id-based variant is what one-shot consumers (e.g.
  // VisualCard thumbnail generation) use to await a colored render.
  const previewScadColored = useCallback(
    async (code: string): Promise<{ stl: Blob; off: Blob | undefined }> => {
      const worker = getWorker();
      const requestId = `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const responsePromise = new Promise<OpenSCADWorkerResponseData>(
        (resolve, reject) => {
          pendingRequestsRef.current.set(requestId, {
            resolve: (value) => resolve(value as OpenSCADWorkerResponseData),
            reject,
          });
        },
      );

      const message: WorkerMessage = {
        id: requestId,
        type: WorkerMessageType.PREVIEW,
        data: {
          code,
          params: [],
          fileType: 'stl',
        },
      };

      worker.postMessage(message);
      const response = await responsePromise;

      if (!response.output) {
        throw new Error('OpenSCAD did not return a preview output');
      }

      const stl = new Blob([new Uint8Array(response.output)], {
        type: 'model/stl',
      });
      const offBytes = response.extraOutputs?.off;
      const off = offBytes
        ? new Blob([new Uint8Array(offBytes)], { type: 'text/plain' })
        : undefined;

      return { stl, off };
    },
    [getWorker],
  );

  // Export SCAD from the worker without changing preview state.
  // Used for on-demand downloads like projected DXF.
  const exportScad = useCallback(
    async (code: string, fileType: string): Promise<Blob> => {
      const worker = getWorker();
      const requestId = `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const responsePromise = new Promise<OpenSCADWorkerResponseData>(
        (resolve, reject) => {
          pendingRequestsRef.current.set(requestId, {
            resolve: (value) => resolve(value as OpenSCADWorkerResponseData),
            reject,
          });
        },
      );

      const message: WorkerMessage = {
        id: requestId,
        type: WorkerMessageType.EXPORT,
        data: {
          code,
          params: [],
          fileType,
        },
      };

      worker.postMessage(message);
      const response = await responsePromise;

      if (!response.output) {
        throw new Error('OpenSCAD did not return an export output');
      }

      // Copy worker bytes into a normal ArrayBuffer-backed view for Blob/TextDecoder.
      const outputBytes = new Uint8Array(response.output);
      const mimeType =
        response.fileType === 'stl'
          ? 'model/stl'
          : response.fileType === 'dxf'
            ? 'application/dxf'
            : 'application/octet-stream';

      if (response.fileType === 'dxf') {
        const dxf = new TextDecoder().decode(outputBytes);
        return new Blob([normalizeOpenSCADDxf(dxf)], { type: mimeType });
      }

      return new Blob([outputBytes], { type: mimeType });
    },
    [getWorker],
  );

  return {
    compileScad,
    exportScad,
    previewScadColored,
    writeFile,
    isCompiling,
    output,
    offOutput,
    error,
    isError,
  };
}
