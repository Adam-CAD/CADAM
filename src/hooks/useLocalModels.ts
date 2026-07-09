import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { isLocalModelId, pickerModelSchema } from '@shared/localModels';
import { PARAMETRIC_MODELS } from '@/lib/utils';
import { apiJson } from '@/services/api';
import type { ModelConfig } from '@/types/misc';

const localModelsSchema = z.array(pickerModelSchema);

function useLocalModelsQuery() {
  return useQuery({
    queryKey: ['local-models'],
    queryFn: () => apiJson('local-models', {}, localModelsSchema),
    staleTime: 5 * 60 * 1000,
  });
}

export function useIsLocalModel(modelId: string): boolean {
  const { data: localModels = [] } = useLocalModelsQuery();
  return isLocalModelId(modelId, localModels);
}

export function useParametricModels(): ModelConfig[] {
  const { data: localModels = [] } = useLocalModelsQuery();

  return useMemo(() => [...PARAMETRIC_MODELS, ...localModels], [localModels]);
}
