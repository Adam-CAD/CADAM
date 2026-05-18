import { useQuery } from '@tanstack/react-query';
import { Box, Frown, HeartCrack } from 'lucide-react';

import { generatePreview } from '@/utils/meshUtils';
import { useMeshData } from '@/hooks/useMeshData';
import { useGlbPreview } from '@/hooks/useGlbPreview';
import { GlbPreview } from './GlbPreview';

export function MeshImagePreview({ meshId }: { meshId: string }) {
  const {
    data: { data: meshData, isLoading: isMeshDataLoading },
    blob: { data: meshBlob },
  } = useMeshData({
    id: meshId,
  });

  const { data: previewBlob } = useGlbPreview({ id: meshId });

  const { data: meshPreview } = useQuery({
    queryKey: ['meshPreview', meshId],
    enabled: !!meshBlob,
    queryFn: async () => {
      if (!meshBlob) {
        return null;
      }
      return generatePreview(meshBlob, meshData?.file_type || 'glb');
    },
    staleTime: Infinity,
  });

  if (!isMeshDataLoading && !meshData) {
    return (
      <div className="flex h-10 w-full items-center justify-between rounded-lg bg-adam-neutral-950 px-3">
        <div className="flex h-full items-center justify-center gap-2">
          <Box className="h-4 w-4 text-white" />
          <span className="font-base text-sm text-white">
            3D Object Data not found
          </span>
        </div>
        <Frown className="h-4 w-4 text-white" />
      </div>
    );
  }

  if (meshData?.status === 'failure') {
    return (
      <div className="flex h-10 w-full items-center justify-between rounded-lg bg-adam-neutral-950 px-3">
        <div className="flex h-full items-center justify-center gap-2">
          <Box className="h-4 w-4 text-white" />
          <span className="font-base text-sm text-white">
            3D Object failed to generate
          </span>
        </div>
        <HeartCrack className="h-4 w-4 text-white" />
      </div>
    );
  }

  const showFinalPreview = !!meshPreview;

  return (
    <div className="overflow-hidden rounded-lg">
      <div className="relative aspect-square w-full bg-adam-neutral-950">
        {showFinalPreview ? (
          <img
            src={meshPreview ?? undefined}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <GlbPreview glbBlob={previewBlob ?? undefined} />
        )}
      </div>
      <div className="flex h-10 w-full items-center gap-2 bg-black/80 px-3">
        <Box className="h-4 w-4 text-white" />
        <span className="font-base text-sm text-white">3D Object</span>
      </div>
    </div>
  );
}
