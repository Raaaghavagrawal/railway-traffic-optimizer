import React from 'react';
import { Box, BoxProps } from '@mui/material';

interface SimpleBarProps extends BoxProps {
  children: React.ReactNode;
}

const SimpleBar = ({ children, ...props }: SimpleBarProps) => {
  return (
    <Box
      {...props}
      sx={{
        overflow: 'auto',
        '&::-webkit-scrollbar': {
          width: '6px',
          height: '6px',
        },
        '&::-webkit-scrollbar-track': {
          background: 'rgba(0,0,0,0.1)',
          borderRadius: '3px',
        },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '3px',
          '&:hover': {
            background: 'rgba(0,0,0,0.5)',
          },
        },
        ...props.sx,
      }}
    >
      {children}
    </Box>
  );
};

export default SimpleBar;
