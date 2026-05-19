import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  RotateCcw,
  Sun,
  Hash,
  Settings,
  Gem,
  Waves,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DEFAULT_BRIGHTNESS,
  DEFAULT_ROUGHNESS,
  DEFAULT_NORMAL_INTENSITY,
  getModelDefaultBrightness,
  isCreativeModel,
  shouldShowNormalIntensity,
} from '@/constants/meshConstants';
import { Model } from '@shared/types';
import posthog from 'posthog-js';

interface LightingControlsProps {
  brightness: number;
  roughness: number;
  normalIntensity: number;
  polygonCount?: number;
  modelQuality?: Model;
  onBrightnessChange: (value: number) => void;
  onRoughnessChange: (value: number) => void;
  onNormalIntensityChange: (value: number) => void;
}

export function LightingControls({
  brightness,
  roughness,
  normalIntensity,
  polygonCount,
  modelQuality,
  onBrightnessChange,
  onRoughnessChange,
  onNormalIntensityChange,
}: LightingControlsProps) {
  const [isOpen, setIsOpen] = useState(
    localStorage.getItem('lightingControlsOpen') !== 'false',
  );
  const creativeModel =
    modelQuality && isCreativeModel(modelQuality) ? modelQuality : null;

  // Use centralized model configuration
  const showNormalIntensityControl = creativeModel
    ? shouldShowNormalIntensity(creativeModel)
    : false;
  const defaultBrightness = creativeModel
    ? getModelDefaultBrightness(creativeModel)
    : DEFAULT_BRIGHTNESS;

  // Check if values have changed from defaults
  const brightnessChanged = brightness !== defaultBrightness;
  const roughnessChanged = roughness !== DEFAULT_ROUGHNESS;
  const normalIntensityChanged = normalIntensity !== DEFAULT_NORMAL_INTENSITY;
  const anyValueChanged =
    brightnessChanged ||
    roughnessChanged ||
    (showNormalIntensityControl && normalIntensityChanged);

  useEffect(() => {
    localStorage.setItem('lightingControlsOpen', isOpen.toString());
  }, [isOpen]);

  // Initialize with current values
  const [brightnessInput, setBrightnessInput] = useState(brightness.toFixed(0));
  const [roughnessInput, setRoughnessInput] = useState(roughness.toFixed(0));
  const [normalIntensityInput, setNormalIntensityInput] = useState(
    showNormalIntensityControl ? normalIntensity.toFixed(0) : '0',
  );

  // Single effect to handle prop changes
  useEffect(() => {
    setBrightnessInput(brightness.toFixed(0));
    setRoughnessInput(roughness.toFixed(0));
    if (showNormalIntensityControl) {
      setNormalIntensityInput(normalIntensity.toFixed(0));
    } else {
      setNormalIntensityInput('0');
    }
  }, [brightness, roughness, normalIntensity, showNormalIntensityControl]);

  // Handle direct user input in text fields
  const handleBrightnessInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setBrightnessInput(e.target.value);
  };

  const handleRoughnessInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setRoughnessInput(e.target.value);
  };

  const handleNormalIntensityInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setNormalIntensityInput(e.target.value);
  };

  // Apply input values on blur or enter key
  const applyBrightnessInput = () => {
    const value = parseFloat(brightnessInput);
    if (!isNaN(value)) {
      const clampedValue = Math.min(100, Math.max(0, value));
      onBrightnessChange(clampedValue);
    } else {
      // Reset to current brightness if input is invalid
      setBrightnessInput(brightness.toFixed(0));
    }
    posthog.capture('lighting_controls', {
      event: 'brightness_changed',
      value,
    });
  };

  const applyRoughnessInput = () => {
    const value = parseFloat(roughnessInput);
    if (!isNaN(value)) {
      const clampedValue = Math.min(100, Math.max(0, value));
      onRoughnessChange(clampedValue);
    } else {
      // Reset to current roughness if input is invalid
      setRoughnessInput(roughness.toFixed(0));
    }
    posthog.capture('lighting_controls', {
      event: 'roughness_changed',
      value,
    });
  };

  const applyNormalIntensityInput = () => {
    const value = parseFloat(normalIntensityInput);
    if (!isNaN(value)) {
      const clampedValue = Math.min(100, Math.max(0, value));
      onNormalIntensityChange(clampedValue);
    } else {
      // Reset to current normal intensity if input is invalid
      setNormalIntensityInput(normalIntensity.toFixed(0));
    }
    posthog.capture('lighting_controls', {
      event: 'normal_intensity_changed',
      value,
    });
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    applyFn: () => void,
  ) => {
    if (e.key === 'Enter') {
      applyFn();
    }
  };

  // Reset to default values
  const handleReset = () => {
    onBrightnessChange(defaultBrightness);
    onRoughnessChange(DEFAULT_ROUGHNESS);
    if (showNormalIntensityControl) {
      onNormalIntensityChange(DEFAULT_NORMAL_INTENSITY);
    }
    posthog.capture('lighting_controls', {
      event: 'reset',
      modelQuality,
      hasNormalIntensity: showNormalIntensityControl,
    });
  };

  // Individual reset functions
  const resetBrightness = () => {
    onBrightnessChange(defaultBrightness);
    posthog.capture('lighting_controls', {
      event: 'brightness_reset',
      modelQuality,
    });
  };

  const resetRoughness = () => {
    onRoughnessChange(DEFAULT_ROUGHNESS);
    posthog.capture('lighting_controls', {
      event: 'roughness_reset',
      modelQuality,
    });
  };

  const resetNormalIntensity = () => {
    onNormalIntensityChange(DEFAULT_NORMAL_INTENSITY);
    posthog.capture('lighting_controls', {
      event: 'normal_intensity_reset',
      modelQuality,
    });
  };

  const formatPolygonCount = (count?: number) => {
    if (!count) return '0';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toLocaleString();
  };

  return (
    <div className="absolute right-4 top-4 w-20 overflow-hidden rounded-lg border border-adam-neutral-800/40 bg-adam-background-2/95 shadow-lg backdrop-blur-sm transition-all lg:w-64">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="from-adam-background-3/80 to-adam-background-3/40 flex cursor-pointer items-center justify-between border-b border-adam-neutral-800/20 bg-gradient-to-r px-2 py-2 xl:px-4 xl:py-3"
      >
        <div className="flex items-center gap-1 xl:gap-2">
          <div className="rounded-full bg-adam-blue/20 p-1.5">
            <Settings className="h-3.5 w-3.5 text-adam-blue" />
          </div>
          <div className="hidden text-sm font-medium text-adam-text-primary/90 lg:block">
            controls
          </div>
        </div>
        <div className="flex items-center gap-0 xl:gap-2">
          {anyValueChanged && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-6 w-6 rounded-md bg-adam-background-2/70 p-1 text-adam-text-primary/70 hover:bg-adam-blue/20 hover:text-adam-blue xl:flex"
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              title="Reset to defaults"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-adam-text-primary/60 transition-transform',
              isOpen ? 'rotate-180' : '',
            )}
          />
        </div>
      </div>

      {isOpen && (
        <div className="px-1 pb-4 pt-2 xl:px-4 xl:pt-2">
          {/* Small screen version - ultra compact vertical stack for w-20 */}
          <div className="space-y-2 py-3 xl:hidden">
            <div className="flex flex-col items-center space-y-1">
              <Sun className="h-3.5 w-3.5 text-adam-text-primary/70" />
              <Input
                type="text"
                value={brightnessInput}
                onChange={handleBrightnessInputChange}
                onBlur={applyBrightnessInput}
                onKeyDown={(e) => handleKeyDown(e, applyBrightnessInput)}
                className="focus:bg-adam-background-3/80 h-6 w-12 rounded border border-adam-neutral-500 bg-neutral-700 px-1 py-0 text-center text-xs text-adam-text-primary shadow-none focus:ring-1 focus:ring-adam-blue/20"
              />
            </div>

            <div className="flex flex-col items-center space-y-1">
              <Gem className="h-3.5 w-3.5 text-adam-text-primary/70" />
              <Input
                type="text"
                value={roughnessInput}
                onChange={handleRoughnessInputChange}
                onBlur={applyRoughnessInput}
                onKeyDown={(e) => handleKeyDown(e, applyRoughnessInput)}
                className="focus:bg-adam-background-3/80 h-6 w-12 rounded border border-adam-neutral-500 bg-neutral-700 px-1 py-0 text-center text-xs text-adam-text-primary shadow-none focus:ring-1 focus:ring-adam-blue/20"
              />
            </div>

            {showNormalIntensityControl && (
              <div className="flex flex-col items-center space-y-1">
                <Waves className="h-3.5 w-3.5 text-adam-text-primary/70" />
                <Input
                  type="text"
                  value={normalIntensityInput}
                  onChange={handleNormalIntensityInputChange}
                  onBlur={applyNormalIntensityInput}
                  onKeyDown={(e) => handleKeyDown(e, applyNormalIntensityInput)}
                  className="focus:bg-adam-background-3/80 h-6 w-12 rounded border border-adam-neutral-500 bg-neutral-700 px-1 py-0 text-center text-xs text-adam-text-primary shadow-none focus:ring-1 focus:ring-adam-blue/20"
                />
              </div>
            )}

            {polygonCount !== undefined && (
              <div className="flex flex-col items-center space-y-1">
                <Hash className="h-3.5 w-3.5 text-adam-text-primary/70" />
                <div className="text-center text-[10px] leading-tight text-adam-text-primary/80">
                  {formatPolygonCount(polygonCount)}
                </div>
              </div>
            )}
          </div>

          {/* Large screen version - full layout with text and sliders */}
          <div className="hidden space-y-4 xl:block">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sun className="h-3.5 w-3.5 text-adam-text-primary/70" />
                  <div className="text-xs lowercase text-adam-text-primary/80">
                    brightness
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {brightnessChanged && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md bg-adam-background-2/70 p-1 text-adam-text-primary/70 hover:bg-adam-blue/20 hover:text-adam-blue"
                      onClick={resetBrightness}
                      title="Reset brightness"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Input
                    type="text"
                    value={brightnessInput}
                    onChange={handleBrightnessInputChange}
                    onBlur={applyBrightnessInput}
                    onKeyDown={(e) => handleKeyDown(e, applyBrightnessInput)}
                    className="focus:bg-adam-background-3/80 h-6 w-14 rounded border border-adam-neutral-500 bg-neutral-700 px-2 py-0 text-center text-xs text-adam-text-primary shadow-none focus:ring-1 focus:ring-adam-blue/20"
                  />
                </div>
              </div>
              <div className="px-1">
                <Slider
                  value={[brightness]}
                  defaultValue={[DEFAULT_BRIGHTNESS]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(values) => onBrightnessChange(values[0])}
                  hideDefaultMarker
                  className="py-1"
                  aria-label="Brightness slider"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gem className="h-3.5 w-3.5 text-adam-text-primary/70" />
                  <div className="text-xs lowercase text-adam-text-primary/80">
                    roughness
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {roughnessChanged && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md bg-adam-background-2/70 p-1 text-adam-text-primary/70 hover:bg-adam-blue/20 hover:text-adam-blue"
                      onClick={resetRoughness}
                      title="Reset roughness"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Input
                    type="text"
                    value={roughnessInput}
                    onChange={handleRoughnessInputChange}
                    onBlur={applyRoughnessInput}
                    onKeyDown={(e) => handleKeyDown(e, applyRoughnessInput)}
                    className="focus:bg-adam-background-3/80 h-6 w-14 rounded border border-adam-neutral-500 bg-neutral-700 px-2 py-0 text-center text-xs text-adam-text-primary shadow-none focus:ring-1 focus:ring-adam-blue/20"
                  />
                </div>
              </div>
              <div className="px-1">
                <Slider
                  value={[roughness]}
                  defaultValue={[DEFAULT_ROUGHNESS]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(values) => onRoughnessChange(values[0])}
                  hideDefaultMarker
                  className="py-1"
                  aria-label="Roughness slider"
                />
              </div>
            </div>

            {showNormalIntensityControl && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Waves className="h-3.5 w-3.5 text-adam-text-primary/70" />
                    <div className="text-xs lowercase text-adam-text-primary/80">
                      normal intensity
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {normalIntensityChanged && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md bg-adam-background-2/70 p-1 text-adam-text-primary/70 hover:bg-adam-blue/20 hover:text-adam-blue"
                        onClick={resetNormalIntensity}
                        title="Reset normal intensity"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Input
                      type="text"
                      value={normalIntensityInput}
                      onChange={handleNormalIntensityInputChange}
                      onBlur={applyNormalIntensityInput}
                      onKeyDown={(e) =>
                        handleKeyDown(e, applyNormalIntensityInput)
                      }
                      className="focus:bg-adam-background-3/80 h-6 w-14 rounded border border-adam-neutral-500 bg-neutral-700 px-2 py-0 text-center text-xs text-adam-text-primary shadow-none focus:ring-1 focus:ring-adam-blue/20"
                    />
                  </div>
                </div>
                <div className="px-1">
                  <Slider
                    value={[normalIntensity]}
                    defaultValue={[DEFAULT_NORMAL_INTENSITY]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(values) =>
                      onNormalIntensityChange(values[0])
                    }
                    hideDefaultMarker
                    className="py-1"
                    aria-label="Normal Intensity slider"
                  />
                </div>
              </div>
            )}

            {polygonCount !== undefined && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Hash className="h-3.5 w-3.5 text-adam-text-primary/70" />
                    <div className="text-xs lowercase text-adam-text-primary/80">
                      polygons
                    </div>
                  </div>
                  <div className="font-mono text-xs text-adam-text-primary/90">
                    {formatPolygonCount(polygonCount)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
