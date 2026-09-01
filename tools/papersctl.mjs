#!/usr/bin/env node
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

function usage() {
  console.error('Usage: npm run papersctl -- <inspect.snapshot|inspect.windows|inspect.surfaces|inspect.surface|inspect.workspace|window.create> [--descriptor <path>] [--window <id>] [--surface <id>]');
}

const args = process.argv.slice(2);
const method = args[0];
const descriptorFlag = args.indexOf('--descriptor');
const descriptorPath = descriptorFlag >= 0
  ? args[descriptorFlag + 1]
  : process.env.PAPERS_DEV_CONTROL_DESCRIPTOR;
const windowFlag = args.indexOf('--window');
const surfaceFlag = args.indexOf('--surface');

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
      : {};
  if ((method === 'inspect.surface' && (
    windowFlag < 0 || surfaceFlag < 0 || !Number.isInteger(params.windowId) || !params.surfaceId
  )) || (method === 'inspect.workspace' && (windowFlag < 0 || !Number.isInteger(params.windowId)))) {
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
