import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

window.addEventListener('error', (event) => {
  const root = document.getElementById('root');

  if (root && !root.hasChildNodes()) {
    root.innerHTML = `
      <main style="font-family: system-ui, sans-serif; padding: 24px; color: #111827;">
        <h1 style="font-size: 20px; margin-bottom: 12px;">ECU Room Data Hub could not start</h1>
        <pre style="white-space: pre-wrap; background: #f3f4f6; padding: 16px; border-radius: 8px;">${event.message}</pre>
      </main>
    `;
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
