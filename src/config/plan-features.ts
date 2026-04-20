// Marketing copy for each plan tier — price, name, and token amount come
// from the billing service (/v1/products), but the bullet lists below are a
// product decision that doesn't belong in the billing catalog.

export type PlanLevel = 'free' | 'standard' | 'pro';

export const PLAN_FEATURES: Record<PlanLevel, string[]> = {
  free: ['All AI features', 'Community support'],
  standard: ['All AI features', 'Buy token packs'],
  pro: ['Phone of founders', 'Early access', 'Good vibes'],
};

export const PLAN_DISPLAY_NAMES: Record<PlanLevel, string> = {
  free: 'Free',
  standard: 'Standard',
  pro: 'Pro',
};

export const PLAN_ORDER: PlanLevel[] = ['free', 'standard', 'pro'];
