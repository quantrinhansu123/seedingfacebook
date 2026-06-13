import {
  Columns3,
  Cookie,
  History,
  Home,
  MessageSquareText,
  PenLine,
  Target,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import type { ViewKey } from '@/lib/app-routes';

export const CONSOLE_MODULE_ICONS: Record<ViewKey, LucideIcon> = {
  home: Home,
  staff: Users,
  channels: Waypoints,
  comments: MessageSquareText,
  manage: Columns3,
  cookies: Cookie,
  history: History,
  leads: Target,
  marketing: PenLine,
};
