import {
  buildCandidateGenerationPrompt,
  extractProductBrief,
  proposeDesignCandidates,
  rankDesignCandidates,
  summarizeZooWorkflowTrace,
  vertexGeminiReadiness,
} from '@shared/cadamProductDesigner';
import { isRecord, json, methodNotAllowed, preflight } from './api';

export async function handleProductDesignPlanRequest(req: Request) {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return methodNotAllowed();

  const body = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.prompt !== 'string') {
    return json({ error: 'prompt is required' }, 400);
  }

  const originalPrompt = body.prompt;
  const brief = extractProductBrief(originalPrompt);
  const candidates = rankDesignCandidates(
    proposeDesignCandidates(brief),
    brief,
  );
  const generationPrompts = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.id,
      buildCandidateGenerationPrompt({
        originalPrompt,
        brief,
        candidate,
      }),
    ]),
  );
  const traceSummary =
    typeof body.traceMarkdown === 'string'
      ? summarizeZooWorkflowTrace(body.traceMarkdown)
      : undefined;

  return json({
    brief,
    candidates,
    generationPrompts,
    traceSummary,
    gemini: vertexGeminiReadiness(),
  });
}
