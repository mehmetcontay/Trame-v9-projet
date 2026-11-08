import type {Project} from '../model/types';
import {getDevice} from '../model/project';
import {ping} from './engine';
export function sendPrintJob(p:Project, sourceId:string, printerId:string, text:string):void {
 const source=getDevice(p,sourceId), printer=getDevice(p,printerId), content=text.trim();
 if (!source || !['pc','laptop'].includes(source.modelId)) throw new Error('Choisissez un ordinateur.');
 if (!printer || printer.modelId !== 'printer' || !printer.config.host?.ip) throw new Error('Imprimante ou adresse IP introuvable.');
 if (!content || content.length > 500) throw new Error('Écrivez entre 1 et 500 caractères.');
 if (p.devices.filter(d=>d.config.host?.ip===printer.config.host!.ip).length !== 1) throw new Error('Adresse IP de l’imprimante en double.');
 const r=ping(p,sourceId,printer.config.host.ip);
 if (!r.success) throw new Error(`Imprimante injoignable : ${r.reason || 'vérifiez le réseau.'}`);
 printer.config.printJobs = [...(printer.config.printJobs ?? []),{from:source.name,text:content,at:Date.now()}].slice(-50);
}
