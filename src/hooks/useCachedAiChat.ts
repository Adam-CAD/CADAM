import { Chat } from '@ai-sdk/react';
import { useEffect, useMemo, useRef } from 'react';
import type { AppUIMessage } from '@shared/chatAi';

const MAX_CACHE_SIZE = 10;

const chatCache = new Map<string, Chat<AppUIMessage>>();
type ReactChatInit = ConstructorParameters<typeof Chat<AppUIMessage>>[0];

type CallbackRefs = {
  onError: { current: ReactChatInit['onError'] };
  onFinish: { current: ReactChatInit['onFinish'] };
  onData: { current: ReactChatInit['onData'] };
  onToolCall: { current: ReactChatInit['onToolCall'] };
};

const callbackRefs = new Map<string, CallbackRefs>();

function refsFor(id: string): CallbackRefs {
  let refs = callbackRefs.get(id);
  if (!refs) {
    refs = {
      onError: { current: undefined },
      onFinish: { current: undefined },
      onData: { current: undefined },
      onToolCall: { current: undefined },
    };
    callbackRefs.set(id, refs);
  }
  return refs;
}

function touch(id: string) {
  const chat = chatCache.get(id);
  if (!chat) return;
  chatCache.delete(id);
  chatCache.set(id, chat);
}

function evictIfNeeded() {
  while (chatCache.size > MAX_CACHE_SIZE) {
    // Truthy-check the value would treat an empty-string id as iterator-end,
    // letting the cache grow unbounded. Use `done` instead so any string key
    // (including '') is correctly evicted.
    const result = chatCache.keys().next();
    if (result.done) break;
    chatCache.delete(result.value);
    callbackRefs.delete(result.value);
  }
}

export type CachedAiChatOptions = Omit<ReactChatInit, 'id'> & {
  id: string;
};

export function useCachedAiChat({
  id,
  messages,
  transport,
  onError,
  onFinish,
  onData,
  onToolCall,
  ...rest
}: CachedAiChatOptions) {
  const refs = refsFor(id);
  const initialConfigRef = useRef({ id, messages, transport, rest });
  if (initialConfigRef.current.id !== id) {
    initialConfigRef.current = { id, messages, transport, rest };
  }

  useEffect(() => {
    refs.onError.current = onError;
    refs.onFinish.current = onFinish;
    refs.onData.current = onData;
    refs.onToolCall.current = onToolCall;
  });

  return useMemo(() => {
    const existing = chatCache.get(id);
    if (existing) {
      touch(id);
      return existing;
    }

    const initial = initialConfigRef.current;
    const chat = new Chat<AppUIMessage>({
      ...initial.rest,
      id,
      messages: initial.messages,
      transport: initial.transport,
      onError: (error) => refs.onError.current?.(error),
      onFinish: (ctx) => refs.onFinish.current?.(ctx),
      onData: (ctx) => refs.onData.current?.(ctx),
      onToolCall: (ctx) => refs.onToolCall.current?.(ctx),
    });

    chatCache.set(id, chat);
    evictIfNeeded();
    return chat;
  }, [id, refs]);
}

export function createAndCacheAiChat(
  options: Omit<
    ReactChatInit,
    'onError' | 'onFinish' | 'onData' | 'onToolCall'
  > & {
    id: string;
  },
) {
  const { id, ...rest } = options;
  const refs = refsFor(id);
  const chat = new Chat<AppUIMessage>({
    ...rest,
    id,
    onError: (error) => refs.onError.current?.(error),
    onFinish: (ctx) => refs.onFinish.current?.(ctx),
    onData: (ctx) => refs.onData.current?.(ctx),
    onToolCall: (ctx) => refs.onToolCall.current?.(ctx),
  });

  chatCache.set(id, chat);
  evictIfNeeded();
  return chat;
}
