import { createFileRoute } from '@tanstack/react-router';
import ProductDesignerView from '@/views/ProductDesignerView';

export const Route = createFileRoute('/_layout/product-designer')({
  component: ProductDesignerView,
});
