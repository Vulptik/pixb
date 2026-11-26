import { createElement } from 'react';
import { Check, TriangleAlert, Info } from 'lucide-react';

const iconProps = { size: 18, strokeWidth: 1.8 };

export const toastIcons: Record<string, ReturnType<typeof createElement>> = {
  success: createElement(Check, iconProps),
  danger: createElement(TriangleAlert, iconProps),
  warning: createElement(TriangleAlert, iconProps),
  primary: createElement(Info, iconProps),
  default: createElement(Info, iconProps),
  foreground: createElement(Info, iconProps),
  secondary: createElement(Info, iconProps),
};
