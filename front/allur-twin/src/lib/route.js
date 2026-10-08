// Hash-роутинг без зависимостей: #/ — лендинг, #/app/<вкладка> — дашборд.
// Hash, а не pathname: статический хостинг не нужно настраивать на rewrite.
import { useEffect, useState } from 'react';

export const VIEWS = ['flow', 'money', 'whatif', 'log', 'chat'];

export function parseHash(hash = window.location.hash) {
  const m = hash.match(/^#\/app(?:\/([a-z]+))?/);
  if (!m) return { page: 'landing' };
  return { page: 'app', view: VIEWS.includes(m[1]) ? m[1] : 'flow' };
}

export const appHref = (view = 'flow') => `#/app/${view}`;

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
