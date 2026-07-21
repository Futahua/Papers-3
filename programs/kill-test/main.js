/**
 * Kill Test program logic. Runs fully sandboxed; talks to Papers only
 * through window.papers (the narrow Program API).
 */
const papers = window.papers;

const $ = (id) => document.getElementById(id);

let identity = null;
let state = { schemaVersion: 1, counter: 0 };
let activeRunId = null;

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function logRun(line) {
  const el = $('run-log');
  el.textContent = `${el.textContent === '(no run yet)' ? '' : el.textContent}${line}\n`.slice(-4000);
  el.scrollTop = el.scrollHeight;
}

async function init() {
  identity = await papers.identity();
  $('identity').textContent = JSON.stringify(identity, null, 2);

  const loaded = await papers.state.load();
  if (loaded && typeof loaded === 'object' && typeof loaded.counter === 'number') {
    state = loaded;
  }
  $('counter').textContent = String(state.counter);

  $('increment').addEventListener('click', async () => {
    state.counter += 1;
    $('counter').textContent = String(state.counter);
    await papers.state.save(state);
  });

  $('clipboard').addEventListener('click', async () => {
    const out = $('clipboard-result');
    out.textContent = '…';
    try {
      await papers.capabilities.request({
        invocationId: crypto.randomUUID(),
        backpackId: identity.backpackId,
        programId: identity.programId,
        capability: 'clipboard.write',
        arguments: { text: `Kill Test timestamp ${new Date().toISOString()}` },
        reason: 'Demonstrate a prompted capability end to end',
      });
      out.textContent = 'copied ✔';
    } catch (err) {
      out.textContent = `denied/failed: ${String(err.message ?? err).slice(0, 200)}`;
    }
  });

  $('invoke').addEventListener('click', async () => {
    const note = [
      'Papers 3 kill-test note.',
      `Created at ${new Date().toISOString()} by the sandboxed Kill Test program.`,
      'Papers gives work persistent places called Backpacks; the Canvas Backpack hosts',
      'purpose-built programs which invoke Hermes only from exact, previewed selections.',
    ].join('\n');
    const contentHash = await sha256Hex(note);

    const invocation = {
      version: 1,
      origin: {
        backpackId: identity.backpackId,
        programId: identity.programId,
        commandId: 'kill-test.summarize',
      },
      action: {
        id: 'summarize-note',
        label: 'Summarize the shared note',
        creatorInstruction:
          'Summarize the shared note in one sentence, then list its factual claims as a JSON array of strings in a ```json block.',
      },
      selection: {
        type: 'test-notes',
        references: [{ type: 'test-note', id: 'note-1' }],
      },
      sharedMaterial: [
        {
          reference: { type: 'test-note', id: 'note-1' },
          title: 'Kill-test note',
          mediaType: 'text/plain',
          preview: note.slice(0, 120),
          contentHash,
          content: note,
        },
      ],
      destination: {
        programId: identity.programId,
        type: 'result-display',
      },
      permissions: ['agent.invoke'],
    };

    logRun('submitting invocation (host preview will confirm)…');
    $('invoke').disabled = true;
    try {
      const ref = await papers.agent.invoke(invocation);
      activeRunId = ref.runId;
      $('cancel').disabled = false;
      logRun(`run accepted: ${ref.runId}`);
    } catch (err) {
      logRun(`invocation rejected: ${String(err.message ?? err).slice(0, 300)}`);
    } finally {
      $('invoke').disabled = false;
    }
  });

  $('cancel').addEventListener('click', async () => {
    if (!activeRunId) return;
    try {
      await papers.agent.cancel(activeRunId);
      logRun('cancellation requested');
    } catch (err) {
      logRun(`cancel failed: ${String(err.message ?? err).slice(0, 200)}`);
    }
  });

  $('crash').addEventListener('click', () => {
    // Real renderer death: allocate until the process is OOM-killed.
    const hoard = [];
    setInterval(() => {
      for (let i = 0; i < 64; i += 1) hoard.push(new Uint8Array(16 * 1024 * 1024));
    }, 0);
  });

  papers.events.onRunUpdate((update) => {
    logRun(`run ${update.runId.slice(0, 12)}… → ${update.state}`);
    if (update.state === 'completed' || update.state === 'failed' || update.state === 'cancelled') {
      $('cancel').disabled = true;
    }
  });

  papers.events.onResultProposal((proposal) => {
    $('result').textContent = JSON.stringify(
      {
        sessionId: proposal.sessionId,
        summary: proposal.summary,
        structuredOutput: proposal.structuredOutput ?? null,
      },
      null,
      2,
    );
  });
}

init().catch((err) => {
  document.body.innerHTML = `<main><h1>Kill Test failed to start</h1><pre>${String(err)}</pre></main>`;
});
