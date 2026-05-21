import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import * as Sentry from '@sentry/react';
import { ArrowLeft, Clipboard, Loader2, Play, Sparkles } from 'lucide-react';
import type {
  DesignCandidate,
  ProductDesignPlan,
} from '@shared/cadamProductDesigner';
import { buildCandidateGenerationPrompt } from '@shared/cadamProductDesigner';
import type { AppUIMessage } from '@shared/chatAi';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ensureInputRecords } from '@/lib/aiMessages';
import { supabase } from '@/lib/supabase';
import { apiJson, apiUrl } from '@/services/api';
import { persistUserMessage } from '@/services/messageService';
import { createAndCacheAiChat } from '@/hooks/useCachedAiChat';
import { useToast } from '@/hooks/use-toast';

const EXAMPLE_PROMPTS = [
  'Soporte de pared FDM para una herramienta de 1.2 kg, tornillos M4, costillas visibles mínimas y tolerancias editables.',
  'Caja electrónica para ESP32 con tapa snap-fit, ventilación, bosses para tornillos y puerto USB accesible.',
  'Jig de perforación parametrico con guía de alineación, bujes metálicos y mordazas impresas reemplazables.',
];

const PARAMETRIC_MODEL = 'google/gemini-3.1-pro-preview' as const;
const CADAM_PRODUCT_DESIGNER_BRANCHES = 'cadam.productDesigner.branches.v1';

type ProductDesignPlanResponse = ProductDesignPlan & {
  generationPrompts?: Record<string, string>;
};

type SavedBranch = {
  id: string;
  createdAt: string;
  originalPrompt: string;
  candidate: DesignCandidate;
  generationPrompt: string;
};

function compactList(values: string[]) {
  return values.length > 0 ? values.join(' · ') : '—';
}

function CandidateCard({
  candidate,
  prompt,
  isStarting,
  onSelect,
  onSave,
  onStart,
}: {
  candidate: DesignCandidate;
  prompt: string;
  isStarting: boolean;
  onSelect: (prompt: string) => void;
  onSave: (candidate: DesignCandidate, prompt: string) => void;
  onStart: (candidate: DesignCandidate, prompt: string) => void;
}) {
  return (
    <Card className="border-white/10 bg-white/[0.03] text-adam-text-primary">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{candidate.title}</CardTitle>
            <CardDescription className="mt-1 text-adam-text-secondary">
              {candidate.strategy}
            </CardDescription>
          </div>
          <Badge className="bg-adam-blue/20 text-adam-blue">
            {candidate.score?.overall ?? '—'}/10
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-adam-text-secondary">
        <p>{compactList(candidate.notes)}</p>
        {candidate.warnings.length > 0 && (
          <p className="rounded-md border border-yellow-400/20 bg-yellow-400/10 p-2 text-yellow-100">
            {compactList(candidate.warnings)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelect(prompt)}
            className="gap-2"
          >
            <Clipboard className="h-3.5 w-3.5" />
            Generate CAD prompt
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSave(candidate, prompt)}
            className="gap-2"
          >
            Save branch
          </Button>
          <Button
            size="sm"
            onClick={() => onStart(candidate, prompt)}
            disabled={isStarting}
            className="gap-2"
          >
            {isStarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Start CAD generation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProductDesignerView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPTS[0]);
  const [plan, setPlan] = useState<ProductDesignPlanResponse | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [savedBranches, setSavedBranches] = useState<SavedBranch[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CADAM_PRODUCT_DESIGNER_BRANCHES);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedBranch[];
      if (Array.isArray(parsed)) setSavedBranches(parsed.slice(0, 20));
    } catch {
      localStorage.removeItem(CADAM_PRODUCT_DESIGNER_BRANCHES);
    }
  }, []);

  const candidatePrompts = useMemo(() => {
    if (!plan) return {};
    return Object.fromEntries(
      plan.candidates.map((candidate) => [
        candidate.id,
        plan.generationPrompts?.[candidate.id] ??
          buildCandidateGenerationPrompt({
            originalPrompt: prompt,
            brief: plan.brief,
            candidate,
          }),
      ]),
    );
  }, [plan, prompt]);

  const { mutate: startCadGeneration, isPending: isStartingCad } = useMutation({
    mutationFn: async ({
      candidate,
      generationPrompt,
    }: {
      candidate: DesignCandidate;
      generationPrompt: string;
    }) => {
      if (!user?.id)
        throw new Error('User must be authenticated to start CAD generation');

      const conversationId = crypto.randomUUID();
      const parts: AppUIMessage['parts'] = [
        { type: 'text', text: generationPrompt },
      ];

      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .insert([
          {
            id: conversationId,
            user_id: user.id,
            title: `Product Designer: ${candidate.title}`,
            type: 'parametric',
            settings: {
              model: PARAMETRIC_MODEL,
              productDesignerCandidateId: candidate.id,
              product_designer_candidate_id: candidate.id,
            },
          },
        ])
        .select()
        .single();

      if (conversationError) throw conversationError;

      await ensureInputRecords({
        parts,
        conversationId: conversation.id,
        userId: user.id,
      });

      const userMessageId = await persistUserMessage({
        conversationId: conversation.id,
        parts,
        metadata: {
          model: PARAMETRIC_MODEL,
          productDesignerCandidateId: candidate.id,
          product_designer_candidate_id: candidate.id,
        },
        parentMessageId: null,
      });

      const chat = createAndCacheAiChat({
        id: conversation.id,
        generateId: () => crypto.randomUUID(),
        messages: [],
        transport: new DefaultChatTransport<AppUIMessage>({
          api: apiUrl('parametric-chat'),
          headers: async (): Promise<Record<string, string>> => {
            const accessToken = (await supabase.auth.getSession()).data.session
              ?.access_token;
            const headers: Record<string, string> = {};
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            return headers;
          },
          prepareSendMessagesRequest: ({ body }) => ({
            body: {
              conversationId: conversation.id,
              model: PARAMETRIC_MODEL,
              ...(body ?? {}),
            },
          }),
        }),
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      });

      void chat
        .sendMessage({
          id: userMessageId,
          parts,
          metadata: {
            model: PARAMETRIC_MODEL,
            productDesignerCandidateId: candidate.id,
            product_designer_candidate_id: candidate.id,
          },
        })
        .catch((error) => {
          Sentry.captureException(error, {
            extra: {
              hook: 'ProductDesignerView initial chat',
              conversationId: conversation.id,
              productDesignerCandidateId: candidate.id,
            },
          });
        });

      return { conversationId: conversation.id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate({ to: '/editor/$id', params: { id: data.conversationId } });
    },
    onError: (err) => {
      if (!user?.id) {
        navigate({ to: '/signin' });
        return;
      }
      Sentry.captureException(err);
      toast({
        title: 'Could not start CAD generation',
        description:
          err instanceof Error
            ? err.message
            : 'Unexpected product-designer error',
        variant: 'destructive',
      });
    },
  });

  function persistSavedBranches(nextBranches: SavedBranch[]) {
    setSavedBranches(nextBranches);
    localStorage.setItem(
      CADAM_PRODUCT_DESIGNER_BRANCHES,
      JSON.stringify(nextBranches.slice(0, 20)),
    );
  }

  function saveBranch(candidate: DesignCandidate, generationPrompt: string) {
    const nextBranch: SavedBranch = {
      id: `${candidate.id}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      originalPrompt: prompt,
      candidate,
      generationPrompt,
    };
    persistSavedBranches([nextBranch, ...savedBranches].slice(0, 20));
    toast({ title: 'Candidate branch saved', description: candidate.title });
  }

  function restoreSavedBranch(branch: SavedBranch) {
    setPrompt(branch.originalPrompt);
    setSelectedPrompt(branch.generationPrompt);
  }

  function handleStartCadGeneration(
    candidate: DesignCandidate,
    generationPrompt: string,
  ) {
    if (!user?.id) {
      navigate({ to: '/signin' });
      return;
    }
    startCadGeneration({ candidate, generationPrompt });
  }

  async function analyze() {
    setError('');
    setIsLoading(true);
    setSelectedPrompt('');
    try {
      const response = (await apiJson('product-design-plan', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })) as ProductDesignPlanResponse;
      setPlan(response);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not create product design plan',
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-adam-bg-secondary-dark px-4 py-8 text-adam-text-primary md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Button
            asChild
            variant="ghost"
            className="gap-2 text-adam-text-secondary"
          >
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Back to CADAM
            </Link>
          </Button>
          <Badge className="bg-white/10 text-adam-text-secondary">
            Zoo/KCL visible-trace inspired workflow
          </Badge>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-xl">
          <div className="mb-5 max-w-3xl space-y-3">
            <h1 className="text-3xl font-semibold">CADAM Product Designer</h1>
            <p className="text-adam-text-secondary">
              General CADAM planning layer for text-to-CAD products. It extracts
              a product brief, proposes multiple printable/mechanical
              strategies, ranks them, and produces an enriched OpenSCAD
              generation prompt for the selected candidate.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-40 border-white/10 bg-black/20 text-adam-text-primary"
                placeholder="Describe any CAD product: enclosure, jig, bracket, mechanism, fixture, aesthetic shell..."
              />
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example) => (
                  <Button
                    key={example}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPrompt(example)}
                  >
                    {example.split(' ').slice(0, 4).join(' ')}…
                  </Button>
                ))}
              </div>
              <Button
                onClick={analyze}
                disabled={isLoading || prompt.trim().length === 0}
                className="gap-2"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Analyze product brief
              </Button>
              {error && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {error}
                </p>
              )}
            </div>

            <Card className="border-white/10 bg-black/20 text-adam-text-primary">
              <CardHeader>
                <CardTitle>Brief extraction</CardTitle>
                <CardDescription className="text-adam-text-secondary">
                  Offline heuristics; Gemini/Vertex is optional readiness only.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-adam-text-secondary">
                {plan ? (
                  <>
                    <p>
                      <span className="text-adam-text-primary">Type:</span>{' '}
                      {plan.brief.objectType}
                    </p>
                    <p>
                      <span className="text-adam-text-primary">
                        Manufacturing:
                      </span>{' '}
                      {plan.brief.manufacturing}
                    </p>
                    <p>
                      <span className="text-adam-text-primary">Assembly:</span>{' '}
                      {compactList(plan.brief.assemblyRequirements)}
                    </p>
                    <p>
                      <span className="text-adam-text-primary">
                        Constraints:
                      </span>{' '}
                      {compactList(plan.brief.constraints)}
                    </p>
                    <p>
                      <span className="text-adam-text-primary">Unknowns:</span>{' '}
                      {compactList(plan.brief.unknowns)}
                    </p>
                    <p>
                      <span className="text-adam-text-primary">Gemini:</span>{' '}
                      {plan.gemini.available
                        ? 'ready'
                        : `not configured (${plan.gemini.missing.join(', ')})`}
                    </p>
                  </>
                ) : (
                  <p>Run an analysis to see the structured brief.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {plan && (
          <section className="grid gap-4 lg:grid-cols-2">
            {plan.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                prompt={candidatePrompts[candidate.id] ?? ''}
                isStarting={isStartingCad}
                onSelect={setSelectedPrompt}
                onSave={saveBranch}
                onStart={handleStartCadGeneration}
              />
            ))}
          </section>
        )}

        {savedBranches.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="mb-3 text-lg font-medium">
              Saved candidate branches
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {savedBranches.map((branch) => (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => restoreSavedBranch(branch)}
                  className="rounded-lg border border-white/10 bg-black/20 p-3 text-left text-sm text-adam-text-secondary transition hover:border-adam-blue/50"
                >
                  <span className="block font-medium text-adam-text-primary">
                    {branch.candidate.title}
                  </span>
                  <span className="block">
                    {new Date(branch.createdAt).toLocaleString()}
                  </span>
                  <span className="mt-1 line-clamp-2 block">
                    {branch.originalPrompt}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {selectedPrompt && (
          <section className="rounded-2xl border border-adam-blue/30 bg-adam-blue/10 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">
                Enriched prompt for CAD generation
              </h2>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard?.writeText(selectedPrompt)
                  }
                >
                  Copy
                </Button>
              </div>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-4 text-xs text-adam-text-secondary">
              {selectedPrompt}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
