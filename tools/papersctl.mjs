#!/usr/bin/env node
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';

const methods = 'inspect.snapshot|inspect.windows|inspect.surfaces|inspect.surface|inspect.workspace|layout.list|layout.save|layout.load|workspace.open|workspace.activate|workspace.close|layout.split|layout.moveSurface|layout.moveSurfaceToWindow|layout.restore|window.create|events.subscribe|backpack.archive|backpack.remove';

function usage() {
  console.error(`Usage: npm run papersctl -- <${methods}> [--descriptor <path>] [--window <id>] [--source-window <id>] [--target-window <id>] [--project <id>] [--surface <id>] [--layout <id>] [--name <name>] [--direction <right|down>] [--group <id>] [--index <n>] [--topology <json-file>] [--events <window.created,workspace.changed>] [--confirmation <exact-text>]`);
}

const args = process.argv.slice(2);
const method = args[0];
const flag = (name) => args.indexOf(name);
const valueAfter = (name) => {
  const index = flag(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const numberAfter = (name) => Number(valueAfter(name));
const descriptorPath = valueAfter('--descriptor') ?? process.env.PAPERS_DEV_CONTROL_DESCRIPTOR;

if (!method || !descriptorPath) {
  usage();
  process.exitCode = 2;
} else {
  const params = method === 'inspect.surface'
    ? { windowId: numberAfter('--window'), surfaceId: valueAfter('--surface') }
    : method === 'inspect.workspace'
      ? { windowId: numberAfter('--window') }
      : method === 'layout.save'
        ? { windowId: numberAfter('--window'), name: valueAfter('--name') }
      : method === 'layout.load'
        ? { windowId: numberAfter('--window'), layoutId: valueAfter('--layout') }
      : method === 'workspace.open'
        ? { windowId: numberAfter('--window'), projectId: valueAfter('--project') }
      : method === 'layout.restore'
        ? {
            windowId: numberAfter('--window'),
            topology: flag('--topology') >= 0 ? JSON.parse(await readFile(valueAfter('--topology'), 'utf8')) : undefined,
          }
      : method === 'workspace.activate' || method === 'workspace.close'
        ? { windowId: numberAfter('--window'), surfaceId: valueAfter('--surface') }
      : method === 'layout.split'
        ? { windowId: numberAfter('--window'), surfaceId: valueAfter('--surface'), direction: valueAfter('--direction') }
      : method === 'layout.moveSurface'
        ? { windowId: numberAfter('--window'), surfaceId: valueAfter('--surface'), targetGroupId: valueAfter('--group'), targetIndex: numberAfter('--index') }
      : method === 'layout.moveSurfaceToWindow'
        ? {
            sourceWindowId: numberAfter('--source-window'),
            surfaceId: valueAfter('--surface'),
            targetWindowId: numberAfter('--target-window'),
            targetGroupId: valueAfter('--group'),
            targetIndex: numberAfter('--index'),
          }
      : method === 'events.subscribe'
        ? { events: (valueAfter('--events') ?? '').split(',').map((event) => event.trim()).filter(Boolean) }
      : method === 'backpack.archive' || method === 'backpack.remove'
        ? { projectId: valueAfter('--project') }
      : {};

  const invalid = (method === 'inspect.surface' && (
    flag('--window') < 0 || flag('--surface') < 0 || !Number.isInteger(params.windowId) || !params.surfaceId
  )) || (method === 'inspect.workspace' && (flag('--window') < 0 || !Number.isInteger(params.windowId)))
    || (method === 'layout.save' && (flag('--window') < 0 || flag('--name') < 0 || !Number.isInteger(params.windowId) || !params.name))
    || (method === 'layout.load' && (flag('--window') < 0 || flag('--layout') < 0 || !Number.isInteger(params.windowId) || !params.layoutId))
    || (method === 'workspace.open' && (flag('--window') < 0 || flag('--project') < 0 || !Number.isInteger(params.windowId) || !params.projectId))
    || (method === 'layout.restore' && (flag('--window') < 0 || flag('--topology') < 0 || !Number.isInteger(params.windowId) || !params.topology))
    || ((method === 'workspace.activate' || method === 'workspace.close') && (flag('--window') < 0 || flag('--surface') < 0 || !Number.isInteger(params.windowId) || !params.surfaceId))
    || (method === 'layout.split' && (flag('--window') < 0 || flag('--surface') < 0 || flag('--direction') < 0 || !Number.isInteger(params.windowId) || !params.surfaceId || !['right', 'down'].includes(params.direction)))
    || (method === 'layout.moveSurface' && (flag('--window') < 0 || flag('--surface') < 0 || flag('--group') < 0 || flag('--index') < 0 || !Number.isInteger(params.windowId) || !params.surfaceId || !params.targetGroupId || !Number.isInteger(params.targetIndex) || params.targetIndex < 0))
    || (method === 'layout.moveSurfaceToWindow' && (flag('--source-window') < 0 || flag('--target-window') < 0 || flag('--surface') < 0 || flag('--group') < 0 || flag('--index') < 0 || !Number.isInteger(params.sourceWindowId) || !Number.isInteger(params.targetWindowId) || !params.surfaceId || !params.targetGroupId || !Number.isInteger(params.targetIndex) || params.targetIndex < 0))
    || (method === 'events.subscribe' && (flag('--events') < 0 || params.events.length === 0))
    || ((method === 'backpack.archive' || method === 'backpack.remove') && (flag('--project') < 0 || !params.projectId));

  if (invalid) {
    usage();
    process.exitCode = 2;
  } else {
    const descriptor = await readDescriptor(descriptorPath);
    const client = await connectPapersControl(descriptor);
    if (method === 'events.subscribe') {
      const stop = client.onEvent((event) => console.log(JSON.stringify(event)));
      const response = await client.call(method, params);
      if (!response.ok) {
        stop();
        client.close();
        console.error(response.error);
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify({ type: 'subscription', result: response.result }));
        await new Promise((resolve) => {
          const finish = () => { stop(); client.close(); resolve(); };
          process.once('SIGINT', finish);
          process.once('SIGTERM', finish);
        });
      }
    } else if (method === 'backpack.archive' || method === 'backpack.remove') {
      try {
        const prepared = await client.call(`${method}.prepare`, params);
        if (!prepared.ok) {
          console.error(prepared.error);
          process.exitCode = 1;
        } else {
          const challenge = prepared.result;
          console.error(`${challenge.action} targets ${challenge.target.projectId} (${JSON.stringify(challenge.target.name)}).`);
          console.error(`Confirmation expires at ${challenge.expiresAt}.`);
          let confirmationText = valueAfter('--confirmation');
          if (confirmationText === undefined && stdin.isTTY) {
            const prompt = createInterface({ input: stdin, output: stderr });
            try {
              confirmationText = await prompt.question(`Type exactly ${challenge.confirmationText}: `);
            } finally {
              prompt.close();
            }
          }
          if (confirmationText === undefined) {
            console.error(`Confirmation required. Re-run interactively or pass --confirmation ${JSON.stringify(challenge.confirmationText)}.`);
            process.exitCode = 2;
          } else {
            const response = await client.call('confirmation.execute', {
              challengeId: challenge.challengeId,
              confirmationText,
            });
            if (!response.ok) {
              console.error(response.error);
              process.exitCode = 1;
            } else {
              console.log(JSON.stringify(response.result, null, 2));
            }
          }
        }
      } finally {
        client.close();
      }
    } else {
      const response = await client.call(method, params).finally(() => client.close());
      if (!response.ok) {
        console.error(response.error);
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify(response.result, null, 2));
      }
    }
  }
}
