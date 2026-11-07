import { RouterProvider, useRouter } from '@/router';
import { SessionsPage } from '@/pages/Sessions';
import { PlayerPage } from '@/pages/Player';

function Routes() {
  const { route } = useRouter();
  if (route.name === 'player') return <PlayerPage id={route.id} />;
  return <SessionsPage />;
}

export function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}
