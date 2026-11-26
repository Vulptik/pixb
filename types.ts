import type { ReactNode, HTMLAttributes } from 'react';
import type { InputProps as HeroInputProps } from '@/components/ui/primitives';

export type PasswordFormType = {
  password: string;
  password_confirmation: string;
};

export interface profileFormType {
  username: string;
  email: string;
}

export type UserResponseType = {
  id: string;
  type: string;
  attributes: {
    id: string;
    username: string;
    email: string;
    avatar: {
      small: string;
      medium: string;
      large: string;
    };
    joinedAtAgo: string;
    joinedAtFormatted: string;
    role: string;
    quotaLimit: number;
    quota: QuotaType;
    theme: string;
    locale: string;
  };
};

export type QuotaType = {
  total: number | null;
  unlimited: boolean;
  used: number;
  readable_total: string | null;
  readable_used: string;
  count: number;
};

export interface UserProviderProps {
  children: ReactNode;
  initialUser?: UserResponseType | null;
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'small' | 'default' | 'large' | 'xlarge';
  glow?: boolean;
}

export interface ContextMenuProps {
  sections: ContextMenuSection[];
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}

export interface ContextMenuSection {
  items: ContextMenuItem[];
}

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'warning' | 'primary' | 'secondary';
  disabled?: boolean;
}

export type EnhancedInputProps = {
  showContextMenu?: boolean;
  showRevealToggle?: boolean;
  confirmation?: boolean;
  onRevealToggle?: (isRevealed: boolean) => void;
  showPasswordStrength?: boolean;
  showGenerateButton?: boolean;
  onGenerate?: () => void;
  passwordRules?: {
    uppercase?: boolean;
    lowercase?: boolean;
    number?: boolean;
    special?: boolean;
    minimum?: number;
  };
} & InputProps;

export interface InputProps extends Omit<HeroInputProps, 'variant' | 'size'> {
  type?: string;
  variant?: 'default' | 'outline' | 'filled';
  size?: SizeType;
  className?: string;
  showPasswordStrength?: boolean;
  showPasswordToggle?: boolean;
  onGenerate?: () => void;
  passwordStrengthLevels?: {
    weak: number;
    medium: number;
    strong: number;
  };
  passwordRules?: {
    uppercase?: boolean;
    lowercase?: boolean;
    number?: boolean;
    special?: boolean;
    minimum?: number;
  };
}

export type SizeType = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface PasswordStrengthIndicatorProps {
  password: string;
  showRequirements?: boolean;
  className?: string;
  passwordRules?: {
    uppercase?: boolean;
    lowercase?: boolean;
    number?: boolean;
    special?: boolean;
    minimum?: number;
  };
}

export type ErrorObjType = {
  message: string;
  items?: { [key: string]: string };
  status: number;
};

export type PasswordValuesType = {
  password?: string;
  password_confirmation?: string;
};

export type ProfileValuesType = {
  username?: string;
  email?: string;
  avatar_remote_url?: string;
};

export interface UserContextType {
  data: UserResponseType | null;
  update: (newData: UserResponseType) => void;
  clear: () => void;
  isLogged: () => boolean;
  logout: () => void;
}
