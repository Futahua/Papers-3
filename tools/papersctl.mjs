#!/usr/bin/env node
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';
import { readFile } from 'node:fs/promises';

function usage() {
  console.error('Usage: npm run papersctl -- <inspect.snapshot|inspect.windows|inspect.surfaces|inspect.surface|inspect.workspace|workspace.open|workspace.activate|workspace.close|layout.split|layout.moveSurface|layout.restore|window.create> [--descriptor <path>] [--window <id>] [--project <id>] [--surface <id>] [--direction <right|down>] [--group <id>] [--index <n>] [--topology <json-file>]');
}

const args = process.argv.slice(2);
const method = args[0];
const descriptorFlag = args.indexOf('--descriptor');
const descriptorPath = descriptorFlag >= 0
  ? args[descriptorFlag + 1]
  : process.env.PAPERS_DEV_CONTROL_DESCRIPTOR;
const windowFlag = args.indexOf('--window');
const surfaceFlag = args.indexOf('--surface');
const projectFlag = args.indexOf('--project');
const topologyFlag = args.indexOf('--topology');
const directionFlag = args.indexOf('--direction');
const groupFlag = args.indexOf('--group');
const indexFlag = args.indexOf('--index');

if (!method || !descriptorPath) {
  usage();
  process.exitCode = 2;
} else {
  const params = method === 'inspect.surface'
    ? {
        windowId: Number(args[windowFlag + 1]),
        surfaceId: args[surfaceFlag + 1],
      }
    : method === 'inspect.workspace'
      ? { windowId: Number(args[windowFlag + 1]) }
      : method === 'workspace.open'
        ? { windowId: Number(args[windowFlag + 1]), projectId: args[projectFlag + 1] }
      : method === 'layout.restore'
        ? {
            windowId: Number(args[windowFlag + 1]),
            topology: topologyFlag >= 0
              ? JSON.parse(await readFile(args[topologyFlag + 1], 'utf8'))
              : undefined,
          }
      : method === 'workspace.activate' || method === 'workspace.close'
        ? { windowId: Number(args[windowFlag + 1]), surfaceId: args[surfaceFlag + 1] }
      : method === 'layout.split'
        ? { windowId: Number(args[windowFlag + 1]), surfaceId: args[surfaceFlag + 1], direction: args[directionFlag + 1] }
      : method === 'layout.moveSurface'
        ? { windowId: Number(args[windowFlag + 1]), surfaceId: args[surfaceFlag + 1], targetGroupId: args[groupFlag + 1], targetIndex: Number(args[indexFlag + 1]) }
      : {};
  if ((method === 'inspect.surface' && (
    windowFlag < 0 || surfaceFlag < 0 || !Number.isInteger(params.windowId) || !params.surfaceId
  )) || (method === 'inspect.workspace' && (windowFlag < 0 || !Number.isInteger(params.windowId)))
    || (method === 'workspace.open' && (windowFlag < 0 || projectFlag < 0 || !Number.isInteger(params.windowId) || !params.projectId))
    || (method === 'layout.restore' && (
      windowFlag < 0 || topologyFlag < 0 || !Number.isInteger(params.windowId) || !params.topology
    )) || ((method === 'workspace.activate' || method === 'workspace.close') && (
      windowFlag < 0 || surfaceFlag < 0 || !Number.isInteger(params.windowId) || !params.surfaceId
    )) || (method === 'layout.split' && (
      windowFlag < 0 || surfaceFlag < 0 || directionFlag < 0 || !Number.isInteger(params.windowId)
      || !params.surfaceId || !['right', 'down'].includes(params.direction)
    )) || (method === 'layout.moveSurface' && (
      windowFlag < 0 || surfaceFlag < 0 || groupFlag < 0 || indexFlag < 0
      || !Number.isInteger(params.windowId) || !params.surfaceId || !params.targetGroupId
      || !Number.isInteger(params.targetIndex) || params.targetIndex < 0
    ))) {
    usage();
    process.exitCode = 2;
  } else {
    const descriptor = await readDescriptor(descriptorPath);
    const client = await connectPapersControl(descriptor);
    const response = await client.call(method, params).finally(() => client.close());
    if (!response.ok) {
      console.error(response.error);
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(response.result, null, 2));
    }
  }
}
