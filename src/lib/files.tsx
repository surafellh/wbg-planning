/* Evidence files on deliverables: upload (3 files and 5 MB per deliverable, 15 MB per person per week) and view in a popup
   without downloading — PDF and images in the browser, Word and Excel converted on the page, PowerPoint through Microsoft's viewer. */
import { useEffect, useState } from 'react';
import { sb } from './supabase';
import { useData, useSave, type DB, type Row } from './data';
import { Modal } from './ui';
import { weekStart } from './calc';

export const FILE_LIMITS = { perDeliverable: 3, perDeliverableBytes: 5 * 1024 * 1024, perWeekBytes: 15 * 1024 * 1024 };
export const mb = (b: number) => (b / 1024 / 1024).toFixed(b < 1024 * 1024 ? 2 : 1) + ' MB';
const ext = (n: string) => (n.split('.').pop() || '').toLowerCase();

/** Check the limits before uploading; returns an error message or null. */
export function checkFiles(db: DB, deliverableId: string, userId: string, files: File[]): string | null {
  const have = db.deliverable_files.filter(f => f.deliverable_id === deliverableId);
  if (have.length + files.length > FILE_LIMITS.perDeliverable) return `At most ${FILE_LIMITS.perDeliverable} files per deliverable (${have.length} already attached).`;
  const tot = have.reduce((a, f) => a + Number(f.size), 0) + files.reduce((a, f) => a + f.size, 0);
  if (tot > FILE_LIMITS.perDeliverableBytes) return `Files on one deliverable can total at most 5 MB (this would be ${mb(tot)}).`;
  const ws = weekStart(new Date()).toISOString();
  const wk = db.deliverable_files.filter(f => f.by_user === userId && f.created_at >= ws).reduce((a, f) => a + Number(f.size), 0) + files.reduce((a, f) => a + f.size, 0);
  if (wk > FILE_LIMITS.perWeekBytes) return `At most 15 MB of files per person per week (this would be ${mb(wk)}).`;
  return null;
}
export async function uploadFiles(d: Row, ownerPos: string | null, files: File[]): Promise<string | null> {
  for (const f of files) {
    const path = `${d.unit_id || 'x'}/${d.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\- ]+/g, '_')}`;
    const up = await sb.storage.from('evidence').upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (up.error) return `${f.name}: ${up.error.message}`;
    const ins = await sb.from('deliverable_files').insert({ deliverable_id: d.id, owner_position_id: ownerPos, path, name: f.name, size: f.size, mime: f.type || null });
    if (ins.error) { await sb.storage.from('evidence').remove([path]); return `${f.name}: ${ins.error.message}`; }
  }
  return null;
}

/** The files attached to a deliverable, each opening in the viewer. */
export function FileChips({ deliverableId, canDelete }: { deliverableId: string; canDelete?: boolean }) {
  const { db, user } = useData(); const save = useSave(); const [view, setView] = useState<Row | null>(null); if (!db) return null;
  const files = db.deliverable_files.filter(f => f.deliverable_id === deliverableId);
  if (!files.length) return null;
  async function del(f: Row) { if (!confirm(`Remove ${f.name}?`)) return; await sb.storage.from('evidence').remove([f.path]); await save(() => sb.from('deliverable_files').delete().eq('id', f.id), ['deliverable_files'], 'File removed'); }
  return <div className="fchips">{files.map(f => <span key={f.id} className="fchip"><button className="linkbtn" onClick={() => setView(f)} data-tip={`${f.name} · ${mb(Number(f.size))} — click to view`}>📎 {f.name.length > 28 ? f.name.slice(0, 26) + '…' : f.name}</button>{canDelete && f.by_user === user?.id && <button className="xdel" onClick={() => del(f)} title="Remove">×</button>}</span>)}
    {view && <FileViewer file={view} onClose={() => setView(null)} />}</div>;
}

export function FileViewer({ file, onClose }: { file: Row; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null); const [html, setHtml] = useState<string | null>(null); const [sheets, setSheets] = useState<[string, string][] | null>(null); const [tab, setTab] = useState(0); const [err, setErr] = useState<string | null>(null);
  const e = ext(file.name); const kind = ['pdf'].includes(e) ? 'pdf' : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e) ? 'img' : e === 'docx' ? 'docx' : ['xlsx', 'xls', 'csv'].includes(e) ? 'sheet' : ['ppt', 'pptx', 'doc'].includes(e) ? 'office' : ['txt'].includes(e) ? 'txt' : 'other';
  useEffect(() => { let off = false; (async () => {
    const s = await sb.storage.from('evidence').createSignedUrl(file.path, 900); if (s.error) { setErr(s.error.message); return; } if (off) return; setUrl(s.data.signedUrl);
    if (kind === 'docx' || kind === 'sheet' || kind === 'txt') {
      const r = await fetch(s.data.signedUrl); const buf = await r.arrayBuffer(); if (off) return;
      try {
        if (kind === 'docx') { const mammoth: any = await import('mammoth'); const out = await mammoth.convertToHtml({ arrayBuffer: buf }); setHtml(out.value); }
        else if (kind === 'sheet') { const X: any = await import('xlsx'); const wb = X.read(buf, { type: 'array' }); setSheets(wb.SheetNames.map((n: string) => [n, X.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })])); }
        else setHtml('<pre>' + new TextDecoder().decode(buf).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]) + '</pre>');
      } catch (x: any) { setErr('Could not show this file here: ' + (x?.message || x)); }
    }
  })(); return () => { off = true; }; }, [file.path]);
  return <Modal title={file.name} onClose={onClose} wide>
    <div className="fview">
      {err && <div className="banner bad">{err}</div>}
      {!url && !err && <p className="note">Opening…</p>}
      {url && kind === 'pdf' && <iframe title={file.name} src={url} />}
      {url && kind === 'img' && <img src={url} alt={file.name} />}
      {url && kind === 'office' && <><iframe title={file.name} src={'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(url)} /><p className="note">PowerPoint and old Word files are shown through Microsoft's online viewer, using a link that expires in 15 minutes.</p></>}
      {html != null && <div className="fdoc" dangerouslySetInnerHTML={{ __html: html }} />}
      {sheets && <>{sheets.length > 1 && <div className="vtabs">{sheets.map(([n], i) => <a key={n} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>{n}</a>)}</div>}<div className="fdoc fsheet" dangerouslySetInnerHTML={{ __html: sheets[tab]?.[1] || '' }} /></>}
      {url && kind === 'other' && <p>This file type cannot be previewed.</p>}
    </div>
    <div className="row end">{url && <a className="btn" href={url} target="_blank" rel="noreferrer" download={file.name}>Download</a>}<button className="btn pri" onClick={onClose}>Close</button></div>
  </Modal>;
}
