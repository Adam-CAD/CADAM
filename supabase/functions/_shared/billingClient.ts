// HTTP client for the shared adam-billing service. Mirrors
// onshape-extension/src/lib/billing/client.ts so CADAM and onshape behave
// identically against the same endpoints.

export type SubscriptionLevel = 'standard' | 'pro';

export type BillingStatus = {
  user: {
    hasTrialed: boolean;
  };
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

const baseUrl = (): string => {
  const url = Deno.env.get('BILLING_SERVICE_URL');
  if (!url) throw new Error('BILLING_SERVICE_URL is not set');
  return url.replace(/\/$/, '');
};

const apiKey = (): string => {
  const key = Deno.env.get('BILLING_SERVICE_KEY');
  if (!key) throw new Error('BILLING_SERVICE_KEY is not set');
  return key;
};

type CallOptions = {
  allowStatus?: number[];
};

const call = async <T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options?: CallOptions,
): Promise<T> => {
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
  return parsed as T;
};

const enc = (email: string): string => encodeURIComponent(email.toLowerCase());

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

export const billing = {
  getStatus: (email: string) =>
    call<BillingStatus>('GET', `/v1/users/${enc(email)}/status`),

  consume: (email: string, body: ConsumeBody) =>
    call<ConsumeResult>('POST', `/v1/users/${enc(email)}/consume`, body, {
      allowStatus: [422],
    }),

  refund: (email: string, body: RefundBody) =>
    call<RefundResult>('POST', `/v1/users/${enc(email)}/refund`, body),

  createCheckout: (email: string, body: CheckoutBody) =>
    call<{ url: string }>('POST', `/v1/users/${enc(email)}/checkout`, body),

  createPortal: (email: string, body: { returnUrl: string }) =>
    call<{ url: string }>('POST', `/v1/users/${enc(email)}/portal`, body),

  getProductsByType: (type: 'subscription' | 'pack') =>
    call<BillingProduct[]>('GET', `/v1/products?type=${type}`),

  getAllProducts: () =>
    call<{ subscriptions: BillingProduct[]; packs: BillingProduct[] }>(
      'GET',
      '/v1/products',
    ),
};
