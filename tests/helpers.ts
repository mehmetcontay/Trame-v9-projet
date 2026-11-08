import type { Project } from '../src/model/types';
import { createRuntime } from '../src/sim/runtime';
import { createShell } from '../src/cli';
import { deviceByName } from '../src/model/project';

export function harness(p: Project) {
  const state = { p };
  const rt = createRuntime();
  const shells = new Map<string, ReturnType<typeof createShell>>();
  const sh = (name: string) => {
    const d = deviceByName(state.p, name)!;
    if (!shells.has(d.id)) shells.set(d.id, createShell(d, { get: () => state.p, set: (np) => { state.p = np; }, rt, deviceId: d.id }));
    return shells.get(d.id)!;
  };
  const run = (name: string, ...lines: string[]) => lines.flatMap((l) => sh(name).exec(l));
  return { state, rt, sh, run, dev: (n: string) => deviceByName(state.p, n)! };
}
