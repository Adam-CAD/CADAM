import { createContext, useContext, useState, ReactNode } from 'react';
import type { FilamentEstimates } from '@/utils/meshUtils';

export type { FilamentEstimates };

export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

interface DimensionsContextType {
  dimensions: Dimensions | null;
  setDimensions: (dimensions: Dimensions | null) => void;
  filamentEstimates: FilamentEstimates | null;
  setFilamentEstimates: (estimates: FilamentEstimates | null) => void;
}

const DimensionsContext = createContext<DimensionsContextType | undefined>(
  undefined,
);

export function DimensionsProvider({ children }: { children: ReactNode }) {
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [filamentEstimates, setFilamentEstimates] =
    useState<FilamentEstimates | null>(null);

  return (
    <DimensionsContext.Provider
      value={{
        dimensions,
        setDimensions,
        filamentEstimates,
        setFilamentEstimates,
      }}
    >
      {children}
    </DimensionsContext.Provider>
  );
}

export function useDimensions() {
  const context = useContext(DimensionsContext);
  if (context === undefined) {
    throw new Error('useDimensions must be used within a DimensionsProvider');
  }
  return context;
}
