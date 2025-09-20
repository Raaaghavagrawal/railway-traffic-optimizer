export interface SaleItem {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
  increment: number;
  color: string;
}

export const salesData: SaleItem[] = [
  {
    id: 1,
    title: 'Total Sales',
    subtitle: 'Today\'s revenue',
    icon: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=100&h=100&fit=crop&crop=center',
    increment: 12.5,
    color: 'success.main',
  },
  {
    id: 2,
    title: 'New Orders',
    subtitle: 'Orders received',
    icon: 'https://images.unsplash.com/photo-1556742111-a301076d9d18?w=100&h=100&fit=crop&crop=center',
    increment: 8.3,
    color: 'primary.main',
  },
  {
    id: 3,
    title: 'Active Users',
    subtitle: 'Currently online',
    icon: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=100&h=100&fit=crop&crop=center',
    increment: 15.7,
    color: 'warning.main',
  },
  {
    id: 4,
    title: 'Conversion Rate',
    subtitle: 'Sales conversion',
    icon: 'https://images.unsplash.com/photo-1556742111-a301076d9d18?w=100&h=100&fit=crop&crop=center',
    increment: 6.2,
    color: 'info.main',
  },
];
