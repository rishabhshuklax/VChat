import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Bundled typefaces — no external font requests, no FOUT from a CDN.
import '@fontsource-variable/space-grotesk';
import '@fontsource/instrument-serif';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/space-mono';
import '@fontsource/space-mono/700.css';

import App from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
