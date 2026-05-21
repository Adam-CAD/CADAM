import { createFileRoute } from '@tanstack/react-router';
import { handleProductDesignPlanRequest } from '@/server/productDesignPlan';

export const Route = createFileRoute('/api/product-design-plan')({
  server: {
    handlers: {
      GET: ({ request }) => handleProductDesignPlanRequest(request),
      POST: ({ request }) => handleProductDesignPlanRequest(request),
      OPTIONS: ({ request }) => handleProductDesignPlanRequest(request),
    },
  },
});
