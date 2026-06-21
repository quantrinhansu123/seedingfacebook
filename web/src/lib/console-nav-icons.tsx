import {
  ChartColumn,
  Columns3,
  History,
  Home,
  PenLine,
  ScrollText,
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
  report: ChartColumn,
  manage: Columns3,
  history: History,
  leads: Target,
  scripts: ScrollText,
  marketing: PenLine,
};
