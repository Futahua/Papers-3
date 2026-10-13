import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

/** The creator's own Tailscale account is the trust root: devices signed into it pair without codes. */
const executable = process.platform === 'win32' && existsSync('C:\Program Files\Tailscale\tailscale.exe') ? 'C:\Program Files\Tailscale\tailscale.exe' : 'tailscale';

function tailscale(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    });
  });
}

export interface TailnetPeer { node: string; name: string; address: string; online: boolean }

export async function tailnetAccount(): Promise<{ user: string; peers: TailnetPeer[] }> {
  const status = await tailscale(['status', '--json']) as { Self?: { UserID?: number }; Peer?: Record<string, { ID?: string; HostName?: string; UserID?: number; TailscaleIPs?: string[]; Online?: boolean }> };
  if (typeof status.Self?.UserID !== 'number') throw new Error('Tailscale is not signed in.');
  const user = String(status.Self.UserID);
  const peers = Object.values(status.Peer ?? {}).filter(peer => String(peer.UserID) === user).map(peer => ({ node: String(peer.ID ?? ''), name: peer.HostName ?? 'Device', address: peer.TailscaleIPs?.find(ip => /^100\./.test(ip)) ?? '', online: peer.Online === true })).filter(peer => peer.node && peer.address);
  return { user, peers };
}

/** Returns the peer's node id only when it belongs to this computer's Tailscale account. */
export async function sameAccountNode(address: string): Promise<string> {
  if (!/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) throw new Error('Peer is not on the tailnet.');
  const [{ user }, who] = await Promise.all([tailnetAccount(), tailscale(['whois', '--json', address]) as Promise<{ Node?: { ID?: number | string }; UserProfile?: { ID?: number } }>]);
  if (String(who.UserProfile?.ID) !== user) throw new Error('Peer belongs to another Tailscale account.');
  const node = String(who.Node?.ID ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(node)) throw new Error('Peer node is unknown.');
  return node;
}

let deviceLogFile: string | null = null;
/** Device pairing is invisible by design, so every decision lands in diagnostics/devices.ndjson. */
export function setDeviceLog(file: string): void { deviceLogFile = file; }
export function logDevice(event: string, detail: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...detail });
  console.info('[devices]', line);
  if (!deviceLogFile) return;
  try { mkdirSync(path.dirname(deviceLogFile), { recursive: true }); appendFileSync(deviceLogFile, line + '\n'); } catch { /* diagnostics never block pairing */ }
}
