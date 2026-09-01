#!/usr/bin/env node
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

function usage() {
  console.error('Usage: npm run papersctl -- <inspect.snapshot|inspect.windows|window.create> [--descriptor <path>]');
}

const args = process.argv.slice(2);
const method = args[0];
const descriptorFlag = args.indexOf('--descriptor');
const descriptorPath = descriptorFlag >= 0
  ? args[descriptorFlag + 1]
  : process.env.PAPERS_DEV_CONTROL_DESCRIPTOR;

if (!method || !descriptorPath) {
  usage();
  process.exitCode = 2;
} else {
  const descriptor = JSON.parse(await readFile(resolve(descriptorPath), 'utf8'));
  const socket = createConnection(descriptor.pipe);
  await once(socket, 'connect');
  socket.setEncoding('utf8');
  socket.write(`${JSON.stringify({
    id: 1,
    token: descriptor.token,
    protocolVersion: descriptor.protocolVersion,
    method,
    params: {},
  })}\n`);
  const [chunk] = await once(socket, 'data');
  socket.end();
  const response = JSON.parse(chunk.trim());
  if (!response.ok) {
    console.error(response.error);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(response.result, null, 2));
  }
}
