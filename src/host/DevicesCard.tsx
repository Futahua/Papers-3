import React from 'react';
import { host } from './bridge';

/** Devices signed into the creator's Tailscale account connect on their own; this card only reports and revokes. */
export function DevicesCard(): React.JSX.Element {
  const [status, setStatus] = React.useState<Awaited<ReturnType<ReturnType<typeof host>['devices']['status']>> | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const refresh = React.useCallback(() => { void host().devices.status().then(setStatus).catch(error => setError(String(error))); }, []);
  React.useEffect(() => { refresh(); const interval = setInterval(refresh, 3000); return () => clearInterval(interval); }, [refresh]);
  const revoke = async (id: string): Promise<void> => {
    setBusy(true); setError('');
    try { await host().devices.revoke(id); refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="settings-card">
    <span className="label">Devices</span>
    <strong>{status?.owner?.name ?? 'This computer'}</strong>
    <small>{status?.address ? 'Your computers and phone on the same Tailscale account connect automatically.' : 'Turn on Tailscale and your devices will connect automatically.'}</small>
    {status?.devices.map(device => <div key={device.id}><strong>{device.name}</strong><small>Can open {device.folders.join(', ')}</small><button type="button" className="quiet-button" disabled={busy} onClick={() => void revoke(device.id)}>Disconnect device</button></div>)}
    {status?.incoming.map(device => <small key={device.id}>Connected to {device.name}. Open Files in As you Go to browse.</small>)}
    {(error || status?.error || status?.clientError) && <p role="alert">{error || status?.error || status?.clientError}</p>}
  </div>;
}
