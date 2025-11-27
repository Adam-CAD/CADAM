/**
 * Parameter Slider Component
 *
 * Wrapper around the enhanced Adam-quality Slider for OpenSCAD parameters.
 * Automatically calculates appropriate min/max/step based on parameter metadata.
 *
 * **Features:**
 * - Smart range calculation (from explicit range or heuristics based on default value)
 * - Smart step calculation (1% of range, rounded to nice numbers)
 * - Reset to original generated value via default marker
 * - Line marker style for cleaner parametric design UI
 *
 * **Props:**
 * - `param`: Parameter object with value, defaultValue, range, etc.
 * - `onValueChange`: Called during drag (real-time updates)
 * - `onValueCommit`: Called when drag ends (triggers OpenSCAD recompile)
 * - `step`: Optional override for calculated step size
 */
import React from 'react';
import { Parameter } from '@shared/types';
import { Slider } from '@/components/ui/slider';
import {
  calculateParameterRange,
  calculateParameterStep,
} from '@/utils/parameterUtils';

interface ParameterSliderProps {
  param: Parameter;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  step?: number;
}

function ParameterSliderBase({
  param,
  onValueChange,
  onValueCommit,
  step,
}: ParameterSliderProps) {
  const { min, max } = calculateParameterRange(param);
  const calculatedStep = step ?? calculateParameterStep(param);

  return (
    <Slider
      id={`${param.name}-slider`}
      name={param.name}
      className="w-full"
      defaultMarkerStyle="line"
      onValueChange={([newValue]) => onValueChange(newValue)}
      onValueCommit={([newValue]) => onValueCommit(newValue)}
      min={min}
      max={max}
      value={[Number(param.value)]}
      defaultValue={[Number(param.defaultValue)]}
      step={calculatedStep}
    />
  );
}

export const ParameterSlider = React.memo(ParameterSliderBase);
