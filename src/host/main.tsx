import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FixtureApp } from './FixtureApp';
import { host } from './bridge';
import './styles.css';
import './fixtures.css';

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
