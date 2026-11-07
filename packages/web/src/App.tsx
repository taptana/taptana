import { RouterProvider, useRouter } from '@/router';
import { SessionsPage } from '@/pages/Sessions';
import { PlayerPage } from '@/pages/Player';
import { StudiesPage } from '@/pages/Studies';
import { StudyEditorPage } from '@/pages/StudyEditor';
import { PrototypesPage } from '@/pages/Prototypes';

function Routes() {
  const { route } = useRouter();
  switch (route.name) {
    case 'player':
      return <PlayerPage id={route.id} />;
    case 'studies':
      return <StudiesPage />;
    case 'prototypes':
      return <PrototypesPage />;
    case 'study':
      return <StudyEditorPage key={route.id ?? 'new'} id={route.id} />;
    default:
      return <SessionsPage />;
  }
}

export function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}
