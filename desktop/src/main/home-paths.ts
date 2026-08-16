import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DSH_HOME_DIR_NAME = '.dsh'

/**
 * Join path segments onto the DeepSeek Harness home. The standalone desktop
 * shell does not depend on the harness workspace, so it resolves the same
 * default as dsh: $DSH_HOME or ~/.dsh.
 * @param segments - path segments appended to the harness home.
 * @returns the normalized absolute joined path.
 */
export function dshHomePath(...segments: string[]): string {
  const fromEnv = process.env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim() !== ''
    ? resolve(fromEnv)
    : join(homedir(), DSH_HOME_DIR_NAME)
  return join(selected, ...segments)
}
