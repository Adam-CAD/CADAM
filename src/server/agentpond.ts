import { createSupabaseSpanExporter } from '@agentpond/supabase';
import {
  isOpenInferenceSpan,
  OpenInferenceSimpleSpanProcessor,
} from '@arizeai/openinference-vercel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { env } from './env';

let initialized = false;

function startAgentPond() {
  if (initialized || env('AGENTPOND_ENABLED') !== 'true') return;

  const url = env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
  const secretKey =
    env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !secretKey) {
    throw new Error(
      'AgentPond requires VITE_SUPABASE_URL (or SUPABASE_URL) and a server-only SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)',
    );
  }

  const exporter = createSupabaseSpanExporter({ url, secretKey });
  const processor = new OpenInferenceSimpleSpanProcessor({
    exporter,
    spanFilter: isOpenInferenceSpan,
    reparentOrphanedSpans: true,
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  initialized = true;
}

startAgentPond();

export function agentPondTelemetry(functionId: string) {
  return {
    isEnabled: env('AGENTPOND_ENABLED') === 'true',
    recordInputs: true,
    recordOutputs: true,
    functionId,
  } as const;
}
