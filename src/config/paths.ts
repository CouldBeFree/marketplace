import { isAbsolute, join, resolve } from 'path';

const appRoot = join(__dirname, '..', '..');

export function resolveFromRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(appRoot, p);
}
