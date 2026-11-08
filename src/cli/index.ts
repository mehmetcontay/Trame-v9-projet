import type { Device } from '../model/types';
import { getModel } from '../devices/catalog';
import type { Shell, ShellCtx } from './framework';
import { CiscoShell } from './cisco';
import { AwPlusShell } from './awplus';
import { HostShell } from './host';
export type { Shell, ShellCtx };
export function createShell(dev: Device, ctx: ShellCtx): Shell {
  const os = getModel(dev.modelId).os;
  if (os === 'ios-switch' || os === 'ios-router') return new CiscoShell(ctx);
  if (os === 'awplus') return new AwPlusShell(ctx);
  return new HostShell(ctx);
}
