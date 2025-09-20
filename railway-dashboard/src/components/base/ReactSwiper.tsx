import React from 'react';
import { Swiper, SwiperClass } from 'swiper/react';
import { Navigation, Pagination, Scrollbar, A11y } from 'swiper/modules';

import 'swiper/css';
import 'swiper/css/navigation';

import { Box, SxProps } from '@mui/material';
import { ReactElement, RefObject } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

const ReactSwiper = ({
  children,
  swiperRef,
  onSwiper,
  sx,
  ...rest
}: {
  children: ReactElement[] | ReactElement;
  swiperRef?: RefObject<any>;
  onSwiper: React.Dispatch<React.SetStateAction<SwiperClass | undefined>>;
  sx?: SxProps;
  rest?: any;
}) => {
  const theme = useTheme();
  const isSmUp = useMediaQuery(theme.breakpoints.up('sm'));
  return (
    <Box
      component={Swiper}
      ref={swiperRef}
      sx={sx}
      modules={[Navigation, Pagination, Scrollbar, A11y]}
      spaceBetween={50}
      slidesPerView={isSmUp ? 2 : 1}
      width={1}
      onInit={(swiper) => {
        swiper.navigation.init();
        swiper.navigation.update();
      }}
      navigation={{
        prevEl: '.prev-arrow',
        nextEl: '.next-arrow',
      }}
      onSwiper={onSwiper}
      {...rest}
    >
      {children}
    </Box>
  );
};

export default ReactSwiper;
