import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function isMainModule(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;

  try {
    return realpathSync.native(path.resolve(argvPath))
      === realpathSync.native(fileURLToPath(metaUrl));
  } catch {
    return metaUrl === pathToFileURL(path.resolve(argvPath)).href;
  }
}
