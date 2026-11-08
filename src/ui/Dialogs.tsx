// Fenêtres modales : base, confirmation des modifications non enregistrées, projets locaux, fichiers .pkt.
import React, { useEffect, useState } from 'react';
import { Icon } from './icons';

export function Modal(props: { title: string; onClose(): void; children: React.ReactNode; foot?: React.ReactNode; wide?: boolean; head?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [props.onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={`modal${props.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          {props.head}
          <button className="btn ghost icon" aria-label="Fermer" onClick={props.onClose}><Icon.x size={16} /></button>
        </div>
        <div className="modal-body" style={props.wide ? { padding: 0 } : undefined}>{props.children}</div>
        {props.foot ? <div className="modal-foot">{props.foot}</div> : <div />}
      </div>
    </div>
  );
}

export type ConfirmChoice = 'save' | 'discard' | 'cancel';
export function UnsavedDialog(props: { name: string; action: string; onChoice(c: ConfirmChoice): void }) {
  return (
    <Modal title="Modifications non enregistrées" onClose={() => props.onChoice('cancel')}
      foot={<>
        <button className="btn" onClick={() => props.onChoice('cancel')}>Annuler</button>
        <button className="btn danger" onClick={() => props.onChoice('discard')}>Ne pas enregistrer</button>
        <button className="btn primary" autoFocus onClick={() => props.onChoice('save')}><Icon.save size={15} />Enregistrer</button>
      </>}>
      <p style={{ marginTop: 0 }}>Le projet « <b>{props.name}</b> » contient des modifications qui ne sont pas enregistrées.</p>
      <p style={{ marginBottom: 0, color: 'var(--text-2)' }}>Voulez-vous les enregistrer avant de {props.action} ?</p>
    </Modal>
  );
}

export function ProjectsDialog(props: { list: { id: string; name: string; updatedAt: number }[] | null; currentId: string; onOpen(id: string): void; onDelete(id: string): void; onImport(): void; onClose(): void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Modal title="Ouvrir un projet" onClose={props.onClose}
      foot={<><button className="btn" onClick={props.onImport}><Icon.upload size={15} />Importer un fichier…</button><button className="btn primary" onClick={props.onClose}>Fermer</button></>}>
      <div className="callout warn" style={{ marginBottom: 14 }}><Icon.info size={16} /><span>Les projets sont enregistrés <b>dans ce navigateur</b>, sur cet appareil. Vider les données du site ou utiliser la navigation privée les efface. Pensez à <b>exporter</b> vos projets importants.</span></div>
      {props.list === null && <p>Chargement…</p>}
      {props.list?.length === 0 && <p style={{ color: 'var(--text-2)' }}>Aucun projet enregistré pour l’instant. Utilisez « Enregistrer » (Ctrl+S) pour en conserver un.</p>}
      {props.list?.map((p) => (
        <div className="proj-row" key={p.id}>
          <Icon.folder size={20} />
          <div className="meta"><b>{p.name}</b><small>Modifié le {fmt.format(p.updatedAt)}{p.id === props.currentId ? ' · ouvert' : ''}</small></div>
          {confirm === p.id ? <>
            <button className="btn" onClick={() => setConfirm(null)}>Garder</button>
            <button className="btn danger" onClick={() => { props.onDelete(p.id); setConfirm(null); }}>Supprimer définitivement</button>
          </> : <>
            <button className="btn icon danger" aria-label={`Supprimer ${p.name}`} title="Supprimer" onClick={() => setConfirm(p.id)}><Icon.trash size={15} /></button>
            <button className="btn primary" onClick={() => props.onOpen(p.id)}>Ouvrir</button>
          </>}
        </div>
      ))}
    </Modal>
  );
}

export function PktDialog(props: { fileName: string; onClose(): void }) {
  return (
    <Modal title="Fichier Packet Tracer détecté" onClose={props.onClose} foot={<button className="btn primary" onClick={props.onClose}>Compris</button>}>
      <p style={{ marginTop: 0 }}>« <b>{props.fileName}</b> » est un fichier Cisco Packet Tracer. Trame <b>ne peut pas l’ouvrir directement</b>.</p>
      <ul style={{ paddingLeft: 18, color: 'var(--text-2)' }}>
        <li>Le format .pkt/.pka est propriétaire, compressé et chiffré, et non documenté par Cisco.</li>
        <li>Des outils communautaires savent le décoder, mais leur fiabilité varie selon les versions et leur usage pose des questions de licence : nous avons préféré ne pas promettre un import qui échouerait en partie.</li>
      </ul>
      <div className="callout info"><Icon.bulb size={17} /><span><b>Solution de remplacement :</b> recréez les équipements et les câbles dans Trame, puis dans Packet Tracer tapez <code>show running-config</code> sur chaque équipement et <b>collez le résultat</b> dans le terminal Trame (en mode configuration : <code>enable</code> puis <code>configure terminal</code>). Chaque ligne est exécutée ; les commandes non prises en charge sont signalées. Si le modèle est différent, les noms ou le nombre de ports peuvent changer : les commandes visant des interfaces absentes échouent et la configuration ne sera pas convertie automatiquement.</span></div>
    </Modal>
  );
}

export function ModalForm({onChoice}: {onChoice(c: ConfirmChoice): boolean}) {
  const [error,setError] = useState(false);
  return <Modal title="Configuration IP non appliquée" onClose={() => onChoice('cancel')} foot={<><button className="btn" onClick={() => onChoice('cancel')}>Rester</button><button className="btn danger" onClick={() => onChoice('discard')}>Abandonner</button><button className="btn primary" onClick={() => { if (!onChoice('save')) setError(true); }}>Appliquer</button></>}><p>Vous avez modifié la configuration IP sans l’appliquer.</p><p className="sub">Appliquez-la avant de continuer, ou abandonnez les modifications.</p>{error && <p role="alert" className="callout err">Configuration invalide : choisissez « Rester » pour corriger les champs signalés.</p>}</Modal>;
}
