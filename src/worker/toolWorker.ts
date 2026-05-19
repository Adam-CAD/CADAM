// Module-singleton OpenSCAD worker for client-side tool execution.
//
// `useOpenSCAD` spawns a per-component worker that gets `terminate()`'d
// on unmount. That's correct for stateful viewers (live preview state
// would otherwise leak across mounts) but wrong for tool execution
// triggered by the AI SDK: when the user navigates to a different
// conversation while a `build_parametric_model` tool is in flight,
// `ChatSession` unmounts, the per-instance worker dies, the pending
// `previewScadColored` promise rejects with "Worker terminated", and
// `handleToolCall` persists `output-error` to DB. The user comes back
// to a failed build that actually never had a chance to run.
//
// The fix is to give the tool-execution path a worker that doesn't
// depend on component lifecycle. Per-request IDs route responses to
// the right caller, so concurrent calls don't cross-contaminate.

import {
  OpenSCADWorkerResponseData,
  WorkerMessage,
  WorkerMessageType,
} from '@/worker/types';

type PendingRequest = {
  resolve: (value: OpenSCADWorkerResponseData) => void;
  reject: (error: Error) => void;
};

const pending = new Map<string, PendingRequest>();
let workerInstance: Worker | null = null;

function getToolWorker(): Worker {
  if (workerInstance) return workerInstance;
  workerInstance = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });
  workerInstance.addEventListener('message', (event: MessageEvent) => {
    const { id, err } = event.data;
    if (!id) return;
    const req = pending.get(id);
    if (!req) return;
    pending.delete(id);
    if (err) {
      req.reject(new Error(err.message || 'Worker operation failed'));
    } else {
      req.resolve(event.data.data);
    }
  });
  workerInstance.addEventListener('error', (event) => {
    const err = new Error(event.message || 'OpenSCAD worker error');
    pending.forEach((req) => req.reject(err));
    pending.clear();
  });
  return workerInstance;
}

export async function previewScadColoredViaToolWorker(
  code: string,
): Promise<{ stl: Blob; off: Blob | undefined }> {
  const worker = getToolWorker();
  const requestId = `tool-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const responsePromise = new Promise<OpenSCADWorkerResponseData>(
    (resolve, reject) => {
      pending.set(requestId, { resolve, reject });
    },
  );

  const message: WorkerMessage & { id: string } = {
    id: requestId,
    type: WorkerMessageType.PREVIEW,
    data: { code, params: [], fileType: 'stl' },
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
}
