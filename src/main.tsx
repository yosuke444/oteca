import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FxSettingsProvider } from './fx/fxSettings';
import './ui/theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FxSettingsProvider>
      <App />
    </FxSettingsProvider>
  </StrictMode>,
);
