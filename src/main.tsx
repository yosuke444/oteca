import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SaveProvider } from './state/SaveContext';
import './ui/theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SaveProvider>
      <App />
    </SaveProvider>
  </StrictMode>,
);
