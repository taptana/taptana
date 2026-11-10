import { BarChart3, Pencil } from 'lucide-react';
import { RouteTabs } from '@/components/layout';

/** Pestañas de un estudio: Diseño (constructor) | Resultados (reporte). */
export function StudyTabs({ id, active }: { id: string; active: 'design' | 'report' }) {
  return (
    <RouteTabs
      tabs={[
        { label: 'Diseño', to: { name: 'study', id }, active: active === 'design', icon: <Pencil className="size-3.5" /> },
        { label: 'Resultados', to: { name: 'report', id }, active: active === 'report', icon: <BarChart3 className="size-3.5" /> },
      ]}
    />
  );
}
