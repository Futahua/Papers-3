import React from 'react';

import { host } from './bridge';

/**
 * Settings — ordinary Papers application settings.
 *
 * Papers keeps its own surface honest: it states what it persists and how it
 * relates to the existing Hermes product, without inventing account, billing,
 * model or provider systems that belong to Hermes.
 */
export function SettingsPane(): React.JSX.Element {
  return (
    <div className="pane">
      <div className="pane-inner">
        <div className="pane-head">
          <p className="eyebrow">Basic</p>
          <h1>Settings</h1>
          <p>Papers application settings. Hermes keeps its own settings inside the Hermes product.</p>
        </div>

        <div className="settings-grid">
          <div className="settings-card">
            <span className="label">Appearance</span>
            <strong>Warm paper</strong>
            <small>Papers uses a single calm, tactile desktop theme across every surface.</small>
          </div>

          <div className="settings-card">
            <span className="label">Backpacks</span>
            <strong>Names are saved locally</strong>
            <small>
              Backpack names persist on this machine and are restored when you reopen Papers. Papers
              stores only the names you create — no folders, covers or contents are invented.
            </small>
          </div>

          <div className="settings-card">
            <span className="label">Hermes</span>
            <strong>The existing Hermes product</strong>
            <small>
              Hermes is global and runs as its own application. Papers shows the real Hermes Desktop
              in two placements — docked as a sidebar or as a detached window — using the two symbol
              controls in the top bar. Its models, permissions and tools are configured inside Hermes.
            </small>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="secondary" onClick={() => void host().hermes.showWindow()}>
                Open Hermes window
              </button>
            </div>
          </div>

          <div className="settings-card">
            <span className="label">Tools</span>
            <strong>Reserved, not yet defined</strong>
            <small>Tools remain a permanent destination while their contract is shaped through use.</small>
          </div>
        </div>
      </div>
    </div>
  );
}
