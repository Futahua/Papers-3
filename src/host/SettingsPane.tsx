import React from 'react';

import { host, type BuildIdentity } from './bridge';

/** Show the build time in the reader's own locale; leave `unknown` alone. */
function readableTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * "This build" — the card that makes two machines comparable.
 *
 * Papers runs on more than one computer and every copy reported `1.0.0`, so
 * there was no way to tell whether two machines were running the same Papers.
 * The commit is the part that actually answers that; the folders show which
 * copy is which when they differ.
 */
function ThisBuildCard(): React.JSX.Element {
  const [build, setBuild] = React.useState<BuildIdentity | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const value = await host().app.buildIdentity();
        if (live) setBuild(value);
      } catch {
        /* Leave the card in its loading state rather than inventing a version. */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const copy = React.useCallback((): void => {
    if (!build) return;
    const report = [
      `Papers ${build.version}`,
      `commit ${build.commit}${build.branch === 'unknown' ? '' : ` (${build.branch})`}`,
      `built ${readableTime(build.builtAt)}`,
      `machine ${build.machine}`,
      `installed at ${build.installDir}`,
      `data at ${build.dataDir}`,
    ].join('\n');
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [build]);

  return (
    <div className="settings-card">
      <span className="label">This build</span>
      {build ? (
        <>
          <strong>{build.summary}</strong>
          <dl className="build-facts">
            <dt>Version</dt>
            <dd className="value">{build.version}</dd>
            <dt>Commit</dt>
            <dd className="value">
              {build.commit}
              {build.branch !== 'unknown' && build.commit !== 'unknown' ? ` (${build.branch})` : ''}
            </dd>
            <dt>Built</dt>
            <dd className="value">{readableTime(build.builtAt)}</dd>
            <dt>Machine</dt>
            <dd className="value">{build.machine}</dd>
            <dt>Installed at</dt>
            <dd className="value">{build.installDir}</dd>
            <dt>Data at</dt>
            <dd className="value">{build.dataDir}</dd>
          </dl>
          <small>
            To check whether two machines are running the same Papers, compare the commit — it is
            the same on identical builds and different on different ones. {!build.packaged && 'This is a development run, not an installed build. '}
            {build.commit === 'unknown'
              ? 'This build carries no commit mark, so it was made before Papers began stamping builds.'
              : build.commit.endsWith('+local')
                ? 'The “+local” mark means this build included edits that were not committed, so it matches no other machine exactly.'
                : ''}
          </small>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy build details'}
            </button>
          </div>
        </>
      ) : (
        <small>Reading build details…</small>
      )}
    </div>
  );
}

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
          <h1>Settings</h1>
          <p>Papers application settings. Hermes keeps its own settings inside the Hermes product.</p>
        </div>

        <div className="settings-grid">
          <ThisBuildCard />

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
