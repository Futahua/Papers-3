import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FixtureApp } from './FixtureApp';
import { host } from './bridge';
import './styles.css';
import './fixtures.css';

// The dev-control preload exposes this fixed reporting seam only when the
// opt-in diagnostics mode is active. Installing the listeners here puts them
// in the application's actual main world, where page error events dispatch;
// the isolated preload has no failure listeners of its own.
const visualDiagnosticBridge = (window as unknown as {
  papersVisualDiagnosticBridgeV1?: { report(kind: string, message: string): void };
}).papersVisualDiagnosticBridgeV1;
if (visualDiagnosticBridge) {
  const report = (kind: 'uncaught-error' | 'unhandled-rejection', message: string): void => {
    visualDiagnosticBridge.report(kind, message.slice(0, 4096));
  };
  window.addEventListener('error', (event) => {
    report('uncaught-error', typeof event.message === 'string' && event.message.length > 0 ? event.message : 'uncaught error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error && reason.message.length > 0
      ? reason.message
      : reason !== null && typeof reason === 'object' && typeof (reason as { message?: unknown }).message === 'string'
        ? (reason as { message: string }).message
        : typeof reason === 'string' && reason.length > 0 ? reason : 'unhandled rejection';
    report('unhandled-rejection', message);
  });
  Object.defineProperty(window, '__papersVisualDiagnosticTestV1', {
    value: () => {
      setTimeout(() => { throw new Error('C:\\private\\view.js token=secret'); }, 0);
      setTimeout(() => { Promise.reject(new Error('C:\\private\\promise.js password=secret')); }, 0);
    },
    configurable: false,
    enumerable: false,
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');

// The historical program/ACP demonstrations render only under the fixture flag.
// Production always mounts the Papers shell (Basic, Backpacks, Tools, Settings).
const Root = host().fixtureMode ? FixtureApp : App;

createRoot(container).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
