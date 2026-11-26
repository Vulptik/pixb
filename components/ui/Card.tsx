/**
 * Card component with enhanced styling and hover effects.
 */

// React
import { FC, JSX } from 'react';

// Utils
import { getCardClasses } from '@/lib/utils/styleUtils';

// Types
import { CardProps } from '@/types';

const Card: FC<CardProps> = ({ children, className = '', ...props }): JSX.Element => {
  return (
    <div className={getCardClasses(className) + ' relative'} {...props}>
      {children}
    </div>
  );
};

export default Card;
