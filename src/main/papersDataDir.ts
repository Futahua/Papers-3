import * as path from 'node:path';

const dataDirPrefix = '--papers-data-dir=';

export function papersDataDirArgument(argv: string[]): string | null {
  const values = argv
    .filter((argument) => argument.startsWith(dataDirPrefix))
    .map((argument) => argument.slice(dataDirPrefix.length));
  if (values.length === 0) return null;
  if (values.length !== 1 || !values[0] || !path.isAbsolute(values[0])) {
    throw new Error('Papers data directory argument must be one absolute path.');
  }
  return path.resolve(values[0]);
}
