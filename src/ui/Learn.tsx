// « Cours et exercices » : cours progressifs + exercices vérifiés par le moteur de simulation.
import React, { useEffect, useState } from 'react';
import { COURSES, Block } from '../learn/courses';
import { EXAMPLES } from '../model/examples';
import { EXERCISES, getExercise, CheckResult, exerciseTrack, exerciseProgress } from '../learn/exercises';
import type { Project } from '../model/types';
import { Icon, DeviceIcon } from './icons';
import { Modal } from './Dialogs';

const DONE_KEY = 'trame.done';
export function loadDone(): string[] { try { return JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]'); } catch { return []; } }
export function markDone(id: string) { const d = new Set(loadDone()); d.add(id); try { localStorage.setItem(DONE_KEY, JSON.stringify([...d])); } catch { /* stockage indisponible */ } }

export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((p, i) => p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <React.Fragment key={i}>{p}</React.Fragment>)}</>;
}
function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case 'p': return <p><Inline text={b.text} /></p>;
    case 'h': return <h2 style={{ fontSize: 18, marginTop: 24 }}><Inline text={b.text} /></h2>;
    case 'ul': return <ul>{b.items.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>;
    case 'code': return <pre><code>{b.text}</code></pre>;
    case 'tip': return <div className="callout info" style={{ margin: '14px 0' }}><Icon.bulb size={17} /><span><Inline text={b.text} /></span></div>;
  }
}

function CourseDiagram({ id }: { id: string }) {
  if (!['c1', 'c2', 'c7', 'c8', 'c10', 'c11'].includes(id)) return null;
  const wireless = id === 'c10' || id === 'c11';
  const items = id === 'c11' ? [['phone', 'Combiné A'], ['ap', 'Base DECT'], ['phone', 'Combiné B']] : wireless ? [['pc', 'Portable'], ['ap', 'Point d’accès'], ['switch', 'Switch'], ['server', 'Serveur']] : id === 'c7' ? [['pc', 'Réseau A'], ['router', 'Routeur'], ['pc', 'Réseau B']] : id === 'c8' ? [['pc', 'Client'], ['switch', 'Switch'], ['server', 'Serveur DHCP']] : [['pc', 'PC'], ['switch', 'Switch'], ['router', 'Routeur'], ['server', 'Serveur']];
  return <div className="course-visual" role="img" aria-label={items.map(x => x[1]).join(' relié à ')}>{items.map(([kind, label], i) => <React.Fragment key={label}>{i > 0 && <span className="course-link" aria-hidden="true" /> }<div><DeviceIcon kind={kind} modelId={id === 'c10' && i === 0 ? 'laptop' : undefined} size={50}/><span>{label}</span></div></React.Fragment>)}</div>;
}

const LEVEL_PILL: Record<string, string> = { 'Débutant': 'green', 'Intermédiaire': 'blue', 'Avancé': 'purple' };

export function LearnDialog(props: { onClose(): void; onStart(exId: string): void; onResume?(): void; onExample(id: string): void; currentExercise?: string | null; initialTab?: 'cours' | 'exercices' | 'exemples' }) {
  const [tab, setTab] = useState<'cours' | 'exercices' | 'exemples'>(props.initialTab ?? 'cours');
  const [cur, setCur] = useState(COURSES[0].id);
  const [track,setTrack] = useState<'Cisco' | 'Allied Telesis' | 'Imprimantes'>('Cisco');
  const done = loadDone();
  const c = COURSES.find((x) => x.id === cur)!;
  const ci = COURSES.indexOf(c);
  return (
    <Modal wide title="Cours et exercices" onClose={props.onClose}
      head={<div className="segmented" role="tablist"><button className={tab === 'cours' ? 'on' : ''} onClick={() => setTab('cours')}>Cours</button><button className={tab === 'exercices' ? 'on' : ''} onClick={() => setTab('exercices')}>Exercices</button><button className={tab === 'exemples' ? 'on' : ''} onClick={() => setTab('exemples')}>Réseaux prêts</button></div>}>
      {tab === 'cours' ? (
        <div className="learn">
          <nav className="learn-nav" aria-label="Liste des cours">
            {COURSES.map((x) => (
              <button key={x.id} className={`item${x.id === cur ? ' on' : ''}`} onClick={() => setCur(x.id)}>
                <span className={`num${x.practice && done.includes(x.practice) ? ' done' : ''}`}>{x.practice && done.includes(x.practice) ? <Icon.check size={13} /> : x.num}</span>
                <span><b style={{ fontSize: 13.5, display: 'block' }}>{x.title}</b><small style={{ color: 'var(--text-2)' }}>{x.summary}</small></span>
              </button>
            ))}
          </nav>
          <div className="learn-content">
            <article>
              <div style={{ color: 'var(--text-2)', fontSize: 13 }}>Cours {c.num} · {c.minutes} min de lecture</div>
              <h1>{c.title}</h1>
              <CourseDiagram id={c.id} />
              {c.blocks.map((b, i) => <BlockView key={i} b={b} />)}
              {c.glossary.length > 0 && <>
                <h2 style={{ fontSize: 16, marginTop: 24 }}>Vocabulaire</h2>
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 14px', fontSize: 14 }}>
                  {c.glossary.map(([t, d]) => <React.Fragment key={t}><dt style={{ fontWeight: 650 }}>{t}</dt><dd style={{ margin: 0, color: 'var(--text-2)' }}>{d}</dd></React.Fragment>)}
                </dl>
              </>}
              <div style={{ display: 'flex', gap: 8, marginTop: 28, flexWrap: 'wrap' }}>
                {c.practice && <button className="btn primary" onClick={() => props.onStart(c.practice!)}><Icon.sparkle size={16} />Passer à la pratique : {getExercise(c.practice)?.title}</button>}
                {ci < COURSES.length - 1 && <button className="btn" onClick={() => setCur(COURSES[ci + 1].id)}>Cours suivant<Icon.next size={14} /></button>}
              </div>
            </article>
          </div>
        </div>
      ) : tab === 'exemples' ? (
        <div className="learn-content"><p style={{marginTop:0,color:'var(--text-2)'}}>Des réseaux déjà configurés, prêts à explorer et modifier.</p><div className="ex-grid">{EXAMPLES.map(e => <div className="ex-card" key={e.id}><span className="pill blue">{e.level}</span><h3>{e.title}</h3><p>{e.description}</p><p><b>À tester :</b> {e.test}</p><button className="btn primary" onClick={() => props.onExample(e.id)}>Ouvrir</button></div>)}</div></div>
      ) : (
        <div className="learn-content">
          <p style={{ marginTop: 0, color: 'var(--text-2)' }}>Chaque exercice ouvre un projet préparé. Réalisez la consigne, puis cliquez sur « Vérifier » : la vérification interroge réellement le moteur (pings, configuration, VLAN…).</p>
          <div className="track-nav segmented" aria-label="Famille d’exercices">{(['Cisco','Allied Telesis','Imprimantes'] as const).map(t=><button key={t} className={track===t?'on':''} onClick={()=>setTrack(t)}>{t}</button>)}</div>
          <div className="ex-grid">
            {EXERCISES.filter(e=>exerciseTrack(e)===track).map((e, i) => (
              <div className="ex-card" key={e.id}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`pill ${LEVEL_PILL[e.level]}`}>{e.level}</span>
                  <span style={{ color: 'var(--text-2)', fontSize: 12 }}>Exercice {i + 1}</span>
                  <span className="spacer" />
                  {props.currentExercise === e.id ? <span className="pill blue">En cours</span> : done.includes(e.id) && <span className="pill green"><Icon.check size={11} />&nbsp;Réussi</span>}
                </div>
                <h3>{e.title}</h3>
                <p>{e.objective}</p>
                <button className="btn" onClick={() => props.currentExercise === e.id && props.onResume ? props.onResume() : props.onStart(e.id)}>{props.currentExercise === e.id ? 'Reprendre' : done.includes(e.id) ? 'Refaire' : 'Commencer'}</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ExerciseCard(props: { exId: string; project: Project; hidden?: boolean; onClose(): void; onRestart(): void; onNext(id: string): void }) {
  const ex = getExercise(props.exId);
  const [hints, setHints] = useState(0);
  const [res, setRes] = useState<CheckResult | null>(null);
  const [min, setMin] = useState(true);
  useEffect(() => { setRes(null); }, [props.project]);
  if (!ex) return null;
  const inTrack = EXERCISES.filter(e => exerciseTrack(e) === exerciseTrack(ex));
  const i = inTrack.indexOf(ex);
  const next = inTrack[i + 1];
  let progress = {done:0,total:0,label:'objectifs validés'}; try { progress = exerciseProgress(ex, props.project); } catch { /* Le projet peut être incomplet. */ }
  function verify() {
    let r: CheckResult;
    try { r = ex!.check(props.project); } catch (e) { r = { ok: false, items: [{ label: 'Vérification impossible', ok: false, detail: (e as Error).message }] }; }
    setRes(r);
    if (r.ok) markDone(ex!.id);
  }
  return (
    <aside className="exercise-card" aria-label="Exercice en cours" hidden={props.hidden}>
      <header className="exercise-head">
        <button className="exercise-toggle" onClick={() => setMin(!min)} aria-expanded={!min}><span className="pill blue">Exercice {i + 1}</span><b>{ex.title}</b><Icon.chevron size={16}/></button>
        <span className="exercise-progress"><span>{progress.done}/{progress.total} {progress.label}</span><progress value={progress.done} max={progress.total || 1}/></span>
        <button className="btn primary" onClick={verify}><Icon.check size={15} />Vérifier</button>
        <button className="btn ghost icon" aria-label="Masquer l’exercice" title="Masquer l’exercice" onClick={props.onClose}><Icon.x size={15} /></button>
      </header>
      {min && res && <div className={res.ok ? 'exercise-mini-result ok' : 'exercise-mini-result'} role="status">{res.ok ? 'Bravo, exercice réussi !' : 'Des points restent à corriger. Dépliez pour les détails.'}</div>}
      {!min && (
        <div className="body">
          <div><b>Objectif.</b> <Inline text={ex.objective} /></div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{ex.steps.map((s, k) => <li key={k}><Inline text={s} /></li>)}</ol>
          {ex.hints.slice(0, hints).map((h, k) => <div key={k} className="hint-box"><b>Indice {k + 1}.</b> <Inline text={h} /></div>)}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {hints < ex.hints.length && <button className="btn" onClick={() => setHints(hints + 1)}><Icon.bulb size={15} />{hints === 0 ? 'Un indice' : 'Indice suivant'} ({hints}/{ex.hints.length})</button>}
            <button className="btn ghost" onClick={props.onRestart}><Icon.reset size={15} />Recommencer</button>
          </div>
          {res && res.ok && <div className="success-banner" role="status"><Icon.check size={18} />Bravo, exercice réussi !</div>}
          {res && !res.ok && <div className="callout err" role="status"><Icon.info size={16} />Pas encore : regardez les points en rouge ci-dessous.</div>}
          {res && (
            <div style={{ display: 'grid', gap: 7 }}>
              {res.items.map((it, k) => (
                <div key={k} className={`check-item ${it.ok ? 'ok' : 'ko'}`}>
                  <span className="ic">{it.ok ? <Icon.check size={12} strokeWidth={2.6} /> : <Icon.x size={12} strokeWidth={2.6} />}</span>
                  <span><span>{it.label}</span>{it.detail && <div className="d">{it.detail}</div>}</span>
                </div>
              ))}
            </div>
          )}
          {res?.ok && next && <button className="btn" onClick={() => props.onNext(next.id)}>Exercice suivant : {next.title}<Icon.next size={14} /></button>}
        </div>
      )}
    </aside>
  );
}
