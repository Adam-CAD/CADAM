import { CreativeModel, Model } from '@shared/types';

// Mesh generation constants

// Polygon count limits
export const POLYGON_COUNTS = {
  // Topology defaults
  QUADS_DEFAULT: 100000,
  POLYS_DEFAULT: 100000,

  // Model-specific maximums
  STANDARD_MAX: 0, // SAM 3D doesn't support polygon limits
  ULTRA_MAX: 300000, // Meshy v6 API limit is 300k
  TEXTURELESS_MAX: 50000,

  // Model-specific defaults
  STANDARD_DEFAULT: 0, // SAM 3D handles this automatically
  TEXTURELESS_DEFAULT: 50000,
  ULTRA_DEFAULT: 300000, // Set to max for ultra quality

  // UI limits
  MIN_POLYGON_COUNT: 1000,
} as const;

// Material defaults
export const MATERIAL_DEFAULTS = {
  BRIGHTNESS: 50 as number,
  BRIGHTNESS_TEXTURELESS: 100 as number,
  ROUGHNESS: 100 as number,
  NORMAL_INTENSITY: 0 as number,
};

// Model-specific configuration
export interface ModelConfig {
  brightness: number;
  roughness: number;
  normalIntensity: number;
  polygonCount: {
    quads: number;
    polys: number;
  };
  showPolygonControls: boolean;
  showNormalIntensity: boolean;
  maxPolygonCount?: number; // For server-side limits
}

export const MODEL_CONFIGS: Record<CreativeModel, ModelConfig> = {
  fast: {
    brightness: MATERIAL_DEFAULTS.BRIGHTNESS_TEXTURELESS,
    roughness: MATERIAL_DEFAULTS.ROUGHNESS,
    normalIntensity: MATERIAL_DEFAULTS.NORMAL_INTENSITY,
    polygonCount: {
      quads: POLYGON_COUNTS.TEXTURELESS_DEFAULT,
      polys: POLYGON_COUNTS.TEXTURELESS_DEFAULT,
    },
    showPolygonControls: false,
    showNormalIntensity: false,
    maxPolygonCount: POLYGON_COUNTS.TEXTURELESS_MAX,
  },
  quality: {
    brightness: MATERIAL_DEFAULTS.BRIGHTNESS,
    roughness: MATERIAL_DEFAULTS.ROUGHNESS,
    normalIntensity: MATERIAL_DEFAULTS.NORMAL_INTENSITY,
    polygonCount: {
      quads: POLYGON_COUNTS.STANDARD_DEFAULT,
      polys: POLYGON_COUNTS.STANDARD_DEFAULT,
    },
    showPolygonControls: false, // SAM 3D doesn't support polygon/quad controls
    showNormalIntensity: true,
    maxPolygonCount: POLYGON_COUNTS.STANDARD_MAX,
  },
  ultra: {
    brightness: MATERIAL_DEFAULTS.BRIGHTNESS,
    roughness: MATERIAL_DEFAULTS.ROUGHNESS,
    normalIntensity: MATERIAL_DEFAULTS.NORMAL_INTENSITY,
    polygonCount: {
      quads: POLYGON_COUNTS.ULTRA_DEFAULT,
      polys: POLYGON_COUNTS.ULTRA_DEFAULT,
    },
    showPolygonControls: true,
    showNormalIntensity: true,
    maxPolygonCount: POLYGON_COUNTS.ULTRA_MAX, // Meshy v6 limit is 300k
  },
};

const CREATIVE_MODEL_LOOKUP: Record<CreativeModel, true> = {
  fast: true,
  quality: true,
  ultra: true,
};

export const isCreativeModel = (model: Model): model is CreativeModel => {
  return Object.prototype.hasOwnProperty.call(CREATIVE_MODEL_LOOKUP, model);
};

// Helper functions for model configuration
export const getModelConfig = (model: CreativeModel): ModelConfig => {
  return MODEL_CONFIGS[model];
};

export const getModelDefaultBrightness = (model: CreativeModel): number => {
  return MODEL_CONFIGS[model].brightness;
};

export const getModelDefaultPolygonCount = (
  model: CreativeModel,
  topology: 'quads' | 'polys',
): number => {
  return MODEL_CONFIGS[model].polygonCount[topology];
};

export const shouldShowPolygonControls = (model: CreativeModel): boolean => {
  return MODEL_CONFIGS[model].showPolygonControls;
};

export const shouldShowNormalIntensity = (model: CreativeModel): boolean => {
  return MODEL_CONFIGS[model].showNormalIntensity;
};

export const getMaxPolygonCount = (
  model: CreativeModel,
  _topology: 'quads' | 'polys',
): number => {
  // Return model-specific max, topology doesn't affect the limit
  return MODEL_CONFIGS[model].maxPolygonCount || POLYGON_COUNTS.STANDARD_MAX;
};

// Legacy exports for backward compatibility
export const DEFAULT_BRIGHTNESS = MATERIAL_DEFAULTS.BRIGHTNESS;
export const DEFAULT_ROUGHNESS = MATERIAL_DEFAULTS.ROUGHNESS;
export const DEFAULT_NORMAL_INTENSITY = MATERIAL_DEFAULTS.NORMAL_INTENSITY;
