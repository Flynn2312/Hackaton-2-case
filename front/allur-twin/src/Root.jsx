import { useEffect } from 'react';
import App from './App.jsx';
import LandingView from './views/LandingView.jsx';
import { useRoute } from './lib/route';

// Лендинг не грузит данные дашборда: App (и его WebSocket) монтируется только на #/app
export default function Root() {
  const route = useRoute();
  useEffect(() => { window.scrollTo(0, 0); }, [route.page]);
  return route.page === 'app' ? <App initialView={route.view} /> : <LandingView />;
}
