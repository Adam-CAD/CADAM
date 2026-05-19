/**
 * Edge runtimes (Vercel, Cloudflare, Deno Deploy) often only forward
 * primitive `console.error` arguments to their log drain — pass an
 * `Error` instance or a nested object and the drain swallows it, leaving
 * "Error (500):" on its own with nothing useful. Build a fully
 * stringified line so the actual message + stack always lands in logs.
 */
function serializeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === 'object' && error !== null) {
    try {
      return { name: 'NonErrorObject', message: JSON.stringify(error) };
    } catch {
      return { name: 'NonErrorObject', message: String(error) };
    }
  }
  return { name: typeof error, message: String(error) };
}

export function logError(
  error: unknown,
  context: {
    functionName: string;
    statusCode: number;
    userId?: string;
    conversationId?: string;
    additionalContext?: Record<string, unknown>;
  },
) {
  const serialized = serializeError(error);
  const payload = {
    fn: context.functionName,
    status: context.statusCode,
    userId: context.userId,
    conversationId: context.conversationId,
    error: serialized,
    ...context.additionalContext,
  };

  // Two writes on purpose:
  //   1. A single-line JSON string — robust against drains that flatten
  //      argument lists, and easy to grep / pipe through `jq`.
  //   2. The structured object — preserves nesting for runtimes that
  //      DO accept structured logs (local dev, Sentry/Datadog tails).
  try {
    console.error(
      `[${context.functionName}] ${serialized.name}: ${serialized.message} | ${JSON.stringify(
        payload,
      )}`,
    );
  } catch {
    console.error(
      `[${context.functionName}] ${serialized.name}: ${serialized.message}`,
    );
  }
  if (serialized.stack) {
    console.error(serialized.stack);
  }
}

export function logApiError(
  error: unknown,
  context: {
    functionName: string;
    apiName: string;
    statusCode: number;
    userId?: string;
    conversationId?: string;
    requestData?: Record<string, unknown>;
  },
) {
  logError(error, {
    functionName: context.functionName,
    statusCode: context.statusCode,
    userId: context.userId,
    conversationId: context.conversationId,
    additionalContext: {
      apiName: context.apiName,
      requestData: context.requestData,
    },
  });
}
