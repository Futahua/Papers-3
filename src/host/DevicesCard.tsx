import React from 'react';
import { host } from './bridge';

export function DevicesCard(): React.JSX.Element {
  const [status, setStatus] = React.useState<Awaited<ReturnType<ReturnType<typeof host>['devices']['status']>> | null>(null);
  const [invitation, setInvitation] = React.useState<Awaited<ReturnType<ReturnType<typeof host>['devices']['invite']>>>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [address, setAddress] = React.useState('');
  const [code, setCode] = React.useState('');
  const [canWrite,setCanWrite] = React.useState(false);
  const [shareFiles,setShareFiles]=React.useState(true);
  const [shareProxima,setShareProxima]=React.useState(false);
  const refresh = React.useCallback(() => { void host().devices.status().then(setStatus).catch(error => setError(String(error))); }, []);
  React.useEffect(() => { refresh(); const interval = setInterval(refresh, 3000); return () => clearInterval(interval); }, [refresh]);
  const invite = async (): Promise<void> => {
    setBusy(true); setError('');
    try { setInvitation(await host().devices.invite(canWrite,shareProxima,shareFiles)); refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string): Promise<void> => {
    setBusy(true); setError('');
    try { await host().devices.revoke(id); refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const pair = async (): Promise<void> => {
    setBusy(true); setError('');
    try { await host().devices.pair(address.trim(), code.trim()); setCode(''); refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="settings-card">
    <span className="label">Devices</span>
    <strong>{status?.owner?.name ?? 'This computer'}</strong>
    <small>Connect another computer or phone to selected folders and data. Both devices need Tailscale connected.</small>
    <label><input type="checkbox" checked={shareFiles} onChange={event=>setShareFiles(event.target.checked)} />Share selected folders</label>
    <label><input type="checkbox" checked={canWrite} disabled={!shareFiles} onChange={event=>setCanWrite(event.target.checked)} />Allow file changes in the selected folders</label>
    <label><input type="checkbox" checked={shareProxima} onChange={event=>setShareProxima(event.target.checked)} />Share Proxima for viewing and copying</label>
    <button type="button" className="quiet-button" disabled={busy || Boolean(status?.error)||(!shareFiles&&!shareProxima)} onClick={() => void invite()}>Connect a device</button>
    {invitation && <div role="status"><strong>{invitation.code}</strong><p>{invitation.address}</p><small>Enter this address and code on the other device within five minutes.</small></div>}
    {status?.devices.map(device => <div key={device.id}><strong>{device.name}</strong><small>{device.folders.join(', ')}</small><button type="button" className="quiet-button" disabled={busy} onClick={() => void revoke(device.id)}>Disconnect device</button></div>)}
    <strong>Access another computer</strong>
    <label>Address<input aria-label="Owner address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Address shown on the other computer" autoComplete="off" /></label>
    <label>Pairing code<input aria-label="Pairing code" value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" maxLength={6} autoComplete="off" /></label>
    <button type="button" className="quiet-button" disabled={busy || !address.trim() || !/^\d{6}$/.test(code.trim()) || Boolean(status?.clientError)} onClick={() => void pair()}>Connect</button>
    {status?.incoming.map(device => <small key={device.id}>Connected to {device.name}. Open Files in As you Go to browse.</small>)}
    {(error || status?.error || status?.clientError) && <p role="alert">{error || status?.error || status?.clientError}</p>}
  </div>;
}
