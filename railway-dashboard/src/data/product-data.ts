export interface ProductItem {
  id: number;
  name: string;
  sales: number;
  color: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
}

export const productData: ProductItem[] = [
  {
    id: 1,
    name: 'iPhone 15 Pro',
    sales: 85,
    color: 'primary',
  },
  {
    id: 2,
    name: 'Samsung Galaxy S24',
    sales: 72,
    color: 'secondary',
  },
  {
    id: 3,
    name: 'MacBook Pro M3',
    sales: 68,
    color: 'success',
  },
  {
    id: 4,
    name: 'iPad Air',
    sales: 54,
    color: 'warning',
  },
  {
    id: 5,
    name: 'AirPods Pro',
    sales: 91,
    color: 'info',
  },
];

export const productTableRows = productData;
