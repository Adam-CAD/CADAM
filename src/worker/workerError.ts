// Rebuild a useful Error from the `err` field of a worker response message.
//
// OpenSCAD compile failures cross the worker boundary as a serialized
// OpenSCADError carrying `stdErr` — the compiler's actual diagnostics
// ("Ignoring unknown module 'cuboid'", syntax errors with line numbers).
// The promise-based callers (tool builds, thumbnail compiles, exports) used
// to reject with `new Error(err.message)`, which reduced every failure to
// "Adam did not exit correctly" — so the AI build loop had nothing to
// self-correct against. Fold stderr into the message here so every consumer
// of the rejection sees the real diagnostics.

// Enough to include full BOSL2 assertion backtraces without letting a
// runaway ECHO loop flood the model context.
const MAX_STDERR_LINES = 100;

type SerializedWorkerError = {
  message?: string;
  stdErr?: string[];
};

export function errorFromWorker(err: SerializedWorkerError): Error {
  const message = err.message || 'Worker operation failed';
  const stdErr = Array.isArray(err.stdErr)
    ? err.stdErr.filter((line) => line.trim().length > 0)
    : [];

  if (stdErr.length === 0) return new Error(message);

  // Diagnostics cluster at both ends: the first bad include/module up top,
  // the fatal assertion or "Can't parse" at the bottom. Keep both halves.
  const half = MAX_STDERR_LINES / 2;
  const lines =
    stdErr.length > MAX_STDERR_LINES
      ? [
          ...stdErr.slice(0, half),
          `... ${stdErr.length - MAX_STDERR_LINES} more lines ...`,
          ...stdErr.slice(-half),
        ]
      : stdErr;

  return new Error(`${message}\n${lines.join('\n')}`);
}
