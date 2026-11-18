import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProvedorIdioma } from './i18n';
import { ProvedorRota } from './router';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProvedorIdioma>
      <ProvedorRota>
        <App />
      </ProvedorRota>
    </ProvedorIdioma>
  </StrictMode>,
);
