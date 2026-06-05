import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function isMainModule(metaUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath && metaUrl === pathToFileURL(path.resolve(argvPath)).href);
}
