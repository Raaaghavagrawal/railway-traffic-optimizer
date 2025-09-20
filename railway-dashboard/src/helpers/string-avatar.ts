import { AvatarProps } from '@mui/material/Avatar';

export const stringAvatar = (name: string): AvatarProps => {
  const names = name.split(' ');
  const initials = names.length > 1 
    ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
    : names[0][0].toUpperCase();
  
  return {
    sx: {
      bgcolor: stringToColor(name),
      width: 32,
      height: 32,
      fontSize: '0.875rem',
      fontWeight: 600,
    },
    children: initials,
  };
};

function stringToColor(string: string): string {
  let hash = 0;
  for (let i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.substr(-2);
  }
  return color;
}
