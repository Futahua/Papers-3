import { createRemoteFileView } from './app/remote-file-view.js';
import { createRemoteBackpackView } from './app/remote-devices-view.js';
let sequence = 0;
const requests = new Map();
window.papersReply = (id, result) => { const pending = requests.get(id); if (!pending) return; requests.delete(id); clearTimeout(pending.timer); pending.resolve(result); };
const call = params => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = params.operation === 'edit-import' ? null : setTimeout(() => { requests.delete(id); reject(new Error('Operation is taking too long. Refresh to check its state.')); }, 45000);
  requests.set(id, { resolve, timer });
  window.PapersNative.request(String(id), JSON.stringify(params));
});
const panel = createRemoteFileView({ document, container: document.querySelector('#files'), call, localLabel: 'Devices', close: () => { void panel.home(); } });
const data=createRemoteBackpackView({document,container:document.body,call});
document.querySelector('#data').addEventListener('click',()=>{void data.show();});
document.querySelector('#pair').addEventListener('submit', async event => {
  event.preventDefault(); const status = document.querySelector('#status'); status.textContent = 'Connecting…';
  const result = await call({ operation: 'pair', address: document.querySelector('#address').value, code: document.querySelector('#code').value });
  status.textContent = result.ok ? 'Connected' : result.message;
  if (result.ok) { document.querySelector('#code').value = ''; document.querySelector('#pair').hidden = true; await panel.show(); }
});
void panel.show();
