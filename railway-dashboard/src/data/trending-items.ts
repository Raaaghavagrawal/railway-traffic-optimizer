export interface TrendingItem {
  id: number;
  name: string;
  imgsrc: string;
  popularity: number;
  users: string[];
}

export const trendingItems: TrendingItem[] = [
  {
    id: 1,
    name: 'iPhone 15 Pro Max',
    imgsrc: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=400&h=300&fit=crop&crop=center',
    popularity: 85,
    users: ['John Doe', 'Jane Smith', 'Bob Johnson', 'Alice Brown'],
  },
  {
    id: 2,
    name: 'MacBook Pro M3',
    imgsrc: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=300&fit=crop&crop=center',
    popularity: 72,
    users: ['Charlie Wilson', 'Diana Prince', 'Eve Adams'],
  },
  {
    id: 3,
    name: 'Samsung Galaxy S24',
    imgsrc: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&h=300&fit=crop&crop=center',
    popularity: 68,
    users: ['Frank Miller', 'Grace Lee', 'Henry Davis', 'Ivy Chen', 'Jack Wilson'],
  },
  {
    id: 4,
    name: 'iPad Air',
    imgsrc: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400&h=300&fit=crop&crop=center',
    popularity: 54,
    users: ['Kate Smith', 'Liam Johnson'],
  },
  {
    id: 5,
    name: 'AirPods Pro',
    imgsrc: 'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=400&h=300&fit=crop&crop=center',
    popularity: 91,
    users: ['Mia Brown', 'Noah Davis', 'Olivia Wilson', 'Paul Miller'],
  },
];
