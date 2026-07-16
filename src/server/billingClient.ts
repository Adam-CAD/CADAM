import { env, requiredEnv } from './env';
import { z } from 'zod';

export type SubscriptionLevel = 'standard' | 'pro' | 'max';

export type BillingStatus = {
  user: { hasTrialed: boolean };
  subscription: {
    level: SubscriptionLevel;
    status: string | null;
    currentPeriodEnd: string | null;
  } | null;
  tokens: {
    free: number;
    subscription: number;
    purchased: number;
    total: number;
  };
};

export type ConsumeSuccess = {
  ok: true;
  tokensDeducted: number;
  freeBalance: number;
  subscriptionBalance: number;
  purchasedBalance: number;
  totalBalance: number;
};

export type ConsumeFailure = {
  ok: false;
  reason: 'insufficient_tokens';
  tokensRequired: number;
  tokensAvailable: number;
  tokensDeducted: number;
};

export type ConsumeResult = ConsumeSuccess | ConsumeFailure;

export type RefundResult = {
  ok: true;
  tokensRefunded: number;
  source: 'subscription' | 'purchased';
  freeBalance: number;
  subscriptionBalance: number;
  purchasedBalance: number;
  totalBalance: number;
};

export type BillingProduct = {
  id: string;
  stripeProductId: string;
  stripePriceId: string;
  productType: 'subscription' | 'pack';
  subscriptionLevel: SubscriptionLevel | null;
  tokenAmount: number;
  name: string;
  priceCents: number;
  interval: string | null;
  active: boolean;
};

export class BillingClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const DEV_TOKENS = {
  free: 1_000_000,
  subscription: 1_000_000,
  purchased: 1_000_000,
  total: 3_000_000,
};

const isBypassed = () => env('ENVIRONMENT') === 'local';

const devStatus = (): BillingStatus => ({
  user: { hasTrialed: false },
  subscription: {
    level: 'pro',
    status: 'active',
    currentPeriodEnd: new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  },
  tokens: { ...DEV_TOKENS },
});

const devConsume = (tokens: number): ConsumeSuccess => ({
  ok: true,
  tokensDeducted: tokens,
  freeBalance: DEV_TOKENS.free,
  subscriptionBalance: DEV_TOKENS.subscription,
  purchasedBalance: DEV_TOKENS.purchased,
  totalBalance: DEV_TOKENS.total,
});

const devRefund = (tokens: number): RefundResult => ({
  ok: true,
  tokensRefunded: tokens,
  source: 'subscription',
  freeBalance: DEV_TOKENS.free,
  subscriptionBalance: DEV_TOKENS.subscription,
  purchasedBalance: DEV_TOKENS.purchased,
  totalBalance: DEV_TOKENS.total,
});

const devProducts: {
  subscriptions: BillingProduct[];
  packs: BillingProduct[];
} = {
  subscriptions: [
    {
      id: 'dev_standard_monthly',
      stripeProductId: 'prod_dev_standard',
      stripePriceId: 'price_dev_standard_monthly',
      productType: 'subscription',
      subscriptionLevel: 'standard',
      tokenAmount: 4_000,
      name: 'Standard',
      priceCents: 2000,
      interval: 'month',
      active: true,
    },
    {
      id: 'dev_pro_monthly',
      stripeProductId: 'prod_dev_pro',
      stripePriceId: 'price_dev_pro_monthly',
      productType: 'subscription',
      subscriptionLevel: 'pro',
      tokenAmount: 10_000,
      name: 'Pro',
      priceCents: 4000,
      interval: 'month',
      active: true,
    },
    {
      id: 'dev_max_monthly',
      stripeProductId: 'prod_dev_max',
      stripePriceId: 'price_dev_max_monthly',
      productType: 'subscription',
      subscriptionLevel: 'max',
      tokenAmount: 50_000,
      name: 'Max',
      priceCents: 20000,
      interval: 'month',
      active: true,
    },
  ],
  packs: [
    {
      id: 'dev_pack_small',
      stripeProductId: 'prod_dev_pack_small',
      stripePriceId: 'price_dev_pack_small',
      productType: 'pack',
      subscriptionLevel: null,
      tokenAmount: 100_000,
      name: 'Token Pack',
      priceCents: 1000,
      interval: null,
      active: true,
    },
  ],
};

const devCheckoutError = () =>
  new BillingClientError('billing bypassed in local dev mode', 503, {
    reason: 'bypassed',
  });

const baseUrl = () => requiredEnv('BILLING_SERVICE_URL').replace(/\/$/, '');
const apiKey = () => requiredEnv('BILLING_SERVICE_KEY');
const enc = (email: string) => encodeURIComponent(email.toLowerCase());

type CallOptions = {
  allowStatus?: number[];
};

function invalidBillingResponse(message: string, body: unknown): never {
  throw new BillingClientError(message, 502, body);
}

const subscriptionLevelSchema = z.enum(['standard', 'pro', 'max']);
const balanceSchema = {
  freeBalance: z.number().finite(),
  subscriptionBalance: z.number().finite(),
  purchasedBalance: z.number().finite(),
  totalBalance: z.number().finite(),
};

const billingStatusSchema = z.object({
  user: z.object({ hasTrialed: z.boolean() }),
  subscription: z
    .object({
      level: subscriptionLevelSchema,
      status: z.string().nullable(),
      currentPeriodEnd: z.string().nullable(),
    })
    .nullable(),
  tokens: z.object({
    free: z.number().finite(),
    subscription: z.number().finite(),
    purchased: z.number().finite(),
    total: z.number().finite(),
  }),
}) satisfies z.ZodType<BillingStatus>;

const consumeResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    tokensDeducted: z.number().finite(),
    ...balanceSchema,
  }),
  z.object({
    ok: z.literal(false),
    reason: z.literal('insufficient_tokens'),
    tokensRequired: z.number().finite(),
    tokensAvailable: z.number().finite(),
    tokensDeducted: z.number().finite(),
  }),
]) satisfies z.ZodType<ConsumeResult>;

const refundResultSchema = z.object({
  ok: z.literal(true),
  tokensRefunded: z.number().finite(),
  source: z.enum(['subscription', 'purchased']),
  ...balanceSchema,
}) satisfies z.ZodType<RefundResult>;

const urlResponseSchema = z.object({ url: z.string() });

const cancelSubscriptionResultSchema = z.discriminatedUnion('canceled', [
  z.object({ canceled: z.literal(true) }),
  z.object({
    canceled: z.literal(false),
    reason: z.enum(['no_subscription', 'already_canceled']),
  }),
]) satisfies z.ZodType<CancelSubscriptionResult>;

const billingProductSchema = z.object({
  id: z.string(),
  stripeProductId: z.string(),
  stripePriceId: z.string(),
  productType: z.enum(['subscription', 'pack']),
  subscriptionLevel: subscriptionLevelSchema.nullable(),
  tokenAmount: z.number().finite(),
  name: z.string(),
  priceCents: z.number().finite(),
  interval: z.string().nullable(),
  active: z.boolean(),
}) satisfies z.ZodType<BillingProduct>;

const billingProductsSchema = z.array(billingProductSchema);
const allBillingProductsSchema = z.object({
  subscriptions: billingProductsSchema,
  packs: billingProductsSchema,
});

function parseResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    invalidBillingResponse(
      `billing response ${label} did not match expected shape`,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options?: CallOptions,
): Promise<unknown> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok && !options?.allowStatus?.includes(res.status)) {
    throw new BillingClientError(
      `billing ${method} ${path} -> ${res.status}`,
      res.status,
      parsed,
    );
  }
  if (text.length === 0) {
    invalidBillingResponse(
      `billing ${method} ${path} returned an empty response body`,
      undefined,
    );
  }
  return parsed;
}

type ConsumeBody = {
  tokens: number;
  operation?: string;
  referenceId?: string;
};

type RefundBody = {
  tokens: number;
  operation?: string;
  referenceId?: string;
};

type CheckoutBody = {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  trialPeriodDays?: number;
};

type CancelSubscriptionBody = {
  feedback?:
    | 'customer_service'
    | 'low_quality'
    | 'missing_features'
    | 'other'
    | 'switched_service'
    | 'too_complex'
    | 'too_expensive'
    | 'unused';
  comment?: string;
};

export type CancelSubscriptionResult =
  | { canceled: true }
  | { canceled: false; reason: 'no_subscription' | 'already_canceled' };

export const billing = {
  getStatus(email: string) {
    if (isBypassed()) return Promise.resolve(devStatus());
    return call('GET', `/v1/users/${enc(email)}/status`).then((value) =>
      parseResponse(billingStatusSchema, value, 'status'),
    );
  },

  consume(email: string, body: ConsumeBody) {
    if (isBypassed())
      return Promise.resolve<ConsumeResult>(devConsume(body.tokens));
    return call('POST', `/v1/users/${enc(email)}/consume`, body, {
      allowStatus: [422],
    }).then((value) => parseResponse(consumeResultSchema, value, 'consume'));
  },

  refund(email: string, body: RefundBody) {
    if (isBypassed()) return Promise.resolve(devRefund(body.tokens));
    return call('POST', `/v1/users/${enc(email)}/refund`, body).then((value) =>
      parseResponse(refundResultSchema, value, 'refund'),
    );
  },

  createCheckout(email: string, body: CheckoutBody) {
    if (isBypassed()) return Promise.reject(devCheckoutError());
    return call('POST', `/v1/users/${enc(email)}/checkout`, body).then(
      (value) => parseResponse(urlResponseSchema, value, 'checkout'),
    );
  },

  cancelSubscription(email: string, body: CancelSubscriptionBody = {}) {
    if (isBypassed())
      return Promise.resolve<CancelSubscriptionResult>({ canceled: true });
    return call(
      'POST',
      `/v1/users/${enc(email)}/cancel-subscription`,
      body,
    ).then((value) =>
      parseResponse(
        cancelSubscriptionResultSchema,
        value,
        'cancel-subscription',
      ),
    );
  },

  getProductsByType(type: 'subscription' | 'pack') {
    if (isBypassed()) {
      return Promise.resolve(
        type === 'subscription' ? devProducts.subscriptions : devProducts.packs,
      );
    }
    return call('GET', `/v1/products?type=${type}`).then((value) =>
      parseResponse(billingProductsSchema, value, `products:${type}`),
    );
  },

  getAllProducts() {
    if (isBypassed()) {
      return Promise.resolve({
        subscriptions: devProducts.subscriptions,
        packs: devProducts.packs,
      });
    }
    return call('GET', '/v1/products').then((value) =>
      parseResponse(allBillingProductsSchema, value, 'products'),
    );
  },
};
