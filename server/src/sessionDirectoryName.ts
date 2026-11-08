import * as path from 'path';

import { readWorkingDirectory } from './directorySuggestions.js';

/**
 * Last-resort name from a Claude project-dir hash. The hash replaces `/`, `.`
 * and `-` alike with `-`, so this is lossy: `svky.se` reads as `se` and
 * `kyrkohandboken-new` as `new`. Only used when no `cwd` is known.
 */
export function directoryNameFromProjectDir(dirName: string): string {
  const parts = dirName.replace(/^-+/, '').split('-');
  return parts[parts.length - 1] || dirName;
}

/** An external session's name: the basename of its working directory, read
 *  from the transcript head (or the hook's `cwd`), else the lossy hash. */
export function sessionDirectoryName(
  transcriptPath: string,
  projectDir: string,
  cwd?: string,
): string {
  const workingDir = cwd || readWorkingDirectory(transcriptPath);
  if (workingDir) return path.basename(workingDir);
  return directoryNameFromProjectDir(path.basename(projectDir));
}

/** A restored agent's name, repaired when it is exactly what the lossy hash
 *  derivation produced. Any other persisted name (a user-defined Directory,
 *  a name the hook's cwd already gave) is kept. */
export function repairedDirectoryName(
  persisted: string | undefined,
  transcriptPath: string,
  projectDir: string,
): string | undefined {
  if (!persisted || !transcriptPath || !projectDir) return persisted;
  if (persisted !== directoryNameFromProjectDir(path.basename(projectDir))) return persisted;
  const workingDir = readWorkingDirectory(transcriptPath);
  return workingDir ? path.basename(workingDir) : persisted;
}
