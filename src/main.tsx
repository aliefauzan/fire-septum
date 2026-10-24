import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// #/scoreboard opens the public scoreboard over the app. The app is only started once someone
// leaves the scoreboard, so a direct link to it loads fast; after that the app stays mounted.
const Scoreboard = lazy(() => import('./ui/Scoreboard'));
const onBoard = () => location.hash.startsWith('#/scoreboard');

function Root() {
  const [board, setBoard] = useState(onBoard);
  const [appOn, setAppOn] = useState(() => !onBoard());
  useEffect(() => {
    const on = () => { const b = onBoard(); setBoard(b); if (!b) setAppOn(true); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return (
    <>
      {appOn && <App />}
      {board && <Suspense fallback={null}><Scoreboard /></Suspense>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
