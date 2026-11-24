'use client';

import React, { useMemo, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, addDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { logActivity } from '../../lib/activityLog';
import { getNextCustomerCode } from '../../lib/customerCode';
import {
  parseManifestBuffer, matchManifestRows, buildJamaahPatch, buildBookingPatch,
  JAMAAH_FIELD_LABELS,
} from '../../lib/manifestImport';

// ---------------------------------------------------------------------
// Import Manifest dari file lama (Google Sheet / Excel / CSV).
// Alurnya: pilih file → sistem baca & cocokin ke booking paket ini dan
// Data Master Jamaah → user cek pratinjau, pilih aksi per baris → Terapkan.
// Nggak ada yang ditulis ke database sebelum tombol Terapkan ditekan.
// ---------------------------------------------------------------------

const fmtDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso || '');
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

const STATUS_META = {
  matched: { label: 'Cocok', cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
  similar: { label: 'Mirip, pilih dulu', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
  jamaah_only: { label: 'Belum booking', cls: 'bg-sky-500/10 text-sky-500 border-sky-500/20' },
  notfound: { label: 'Tidak ketemu', cls: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
};

export default function ManifestImportModal({ isDark, styles, pkg, bookings, jamaahList, roomTypeNames, currentUser, onClose, onDone }) {
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState(null); // { rows, mapped, missing, skipped, sheetName }
  const [matches, setMatches] = useState([]);
  const [choices, setChoices] = useState({}); // rowNo -> 'apply' | 'skip' | 'create' | 'b:<id>' | 'j:<id>'
  const [overwrite, setOverwrite] = useState(false);
  const [filter, setFilter] = useState('all'); // all | check | ok
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const lockRef = useRef(false);

  const defaultChoice = (m) => (m.status === 'matched' || m.status === 'jamaah_only' ? 'apply' : 'skip');

  const handleFile = async (file) => {
    if (!file) return;
    setError(''); setParsed(null); setMatches([]); setChoices({}); setResult(null);
    setFileName(file.name);
    setParsing(true);
    try {
      const mod = await import('xlsx');
      const XLSX = mod.default || mod;
      const buffer = await file.arrayBuffer();
      const res = parseManifestBuffer({ buffer, fileName: file.name, XLSX, roomTypeNames });
      if (res.rows.length === 0) throw new Error('Tabelnya kebaca, tapi nggak ada baris jamaah di bawah judul kolom.');
      const ms = matchManifestRows(res.rows, { bookings, jamaahList, existingTourLeaders: pkg?.tourLeaders || [] });
      const ch = {};
      ms.forEach(m => { ch[m.row.rowNo] = defaultChoice(m); });
      setParsed(res); setMatches(ms); setChoices(ch);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setParsing(false);
    }
  };

  // Tentuin target tulis tiap baris berdasarkan pilihan user.
  const resolveTarget = (m, choice) => {
    if (!choice || choice === 'skip') return { action: 'skip' };
    if (choice === 'create') return { action: 'write', createJamaah: true, jamaah: null, booking: null };
    if (choice.startsWith('b:')) {
      const c = m.candidates.find(x => x.type === 'booking' && x.booking.id === choice.slice(2));
      return c ? { action: 'write', jamaah: c.jamaah, booking: c.booking } : { action: 'skip' };
    }
    if (choice.startsWith('j:')) {
      const c = m.candidates.find(x => x.type === 'jamaah' && x.jamaah.id === choice.slice(2));
      return c ? { action: 'write', jamaah: c.jamaah, booking: null } : { action: 'skip' };
    }
    if (choice === 'apply') return { action: 'write', jamaah: m.jamaah, booking: m.booking };
    return { action: 'skip' };
  };

  // Rencana tulis per baris (dipakai pratinjau dan Terapkan).
  const plan = useMemo(() => matches.map(m => {
    const t = resolveTarget(m, choices[m.row.rowNo]);
    if (t.action === 'skip') return { m, t, jp: null, bp: null };
    const jp = (t.createJamaah || t.jamaah) ? buildJamaahPatch(m.row, t.createJamaah ? {} : t.jamaah, overwrite) : null;
    const bp = t.booking && !m.row.isTL ? buildBookingPatch(m.row, t.booking, overwrite) : null;
    return { m, t, jp, bp };
  }), [matches, choices, overwrite]);

  const counts = useMemo(() => {
    const c = { matched: 0, similar: 0, jamaah_only: 0, notfound: 0, willWrite: 0, conflicts: 0, warnings: 0 };
    plan.forEach(({ m, t, jp, bp }) => {
      c[m.status]++;
      if (t.action === 'write') c.willWrite++;
      c.conflicts += (jp?.conflicts.length || 0) + (bp?.conflicts.length || 0) > 0 ? 1 : 0;
      if (m.row.warnings.length) c.warnings++;
    });
    return c;
  }, [plan]);

  const setChoice = (rowNo, v) => setChoices(prev => ({ ...prev, [rowNo]: v }));
  const bulkNotFound = (v) => setChoices(prev => {
    const next = { ...prev };
    matches.forEach(m => { if (m.status === 'notfound') next[m.row.rowNo] = v; });
    return next;
  });

  const needsCheck = (p) => p.m.status === 'similar' || p.m.status === 'notfound' || p.m.row.warnings.length > 0
    || ((p.jp?.conflicts.length || 0) + (p.bp?.conflicts.length || 0)) > 0;
  const visible = plan.filter(p => filter === 'all' ? true : filter === 'check' ? needsCheck(p) : !needsCheck(p));

  const handleApply = async () => {
    if (lockRef.current) return;
    if (counts.willWrite === 0) { alert('Belum ada baris yang akan diproses. Pilih aksi dulu di tabel.'); return; }
    if (!confirm(`Terapkan import ke ${counts.willWrite} baris? ${overwrite ? 'Data yang sudah terisi AKAN DITIMPA.' : 'Data yang sudah terisi tidak ditimpa, hanya yang kosong diisi.'}`)) return;
    lockRef.current = true;
    setApplying(true);
    const summary = { jamaahUpdated: 0, jamaahCreated: 0, bookingUpdated: 0, tlAdded: 0, tlUpdated: 0, skippedDup: 0, errors: [] };
    try {
      const usedBookings = new Set();
      const usedJamaah = new Set();
      const jamaahOps = []; // { id, patch }
      const bookingOps = []; // { id, patch }
      const tlChanges = []; // { jamaahId, name, roomLabel, note }

      for (const { m, t, jp, bp } of plan) {
        if (t.action !== 'write') continue;
        const row = m.row;
        try {
          let jamaahId = t.jamaah?.id || null;
          let jamaahName = t.jamaah?.fullName || row.name;
          if (t.createJamaah) {
            const customerCode = await getNextCustomerCode();
            const data = {
              customerCode, fullName: row.name, nik: '', gender: row.gender || '', phone: '', address: '',
              passportNumber: row.passportNumber || '', passportExpiry: row.passportExpiry || '',
              passportIssueDate: row.passportIssueDate || '', passportIssuingOffice: row.passportIssuingOffice || '',
              birthPlace: row.birthPlace || '', birthDate: row.birthDate || '',
              createdAt: new Date().toISOString(), createdVia: 'import_manifest',
            };
            const ref = await addDoc(collection(db, 'jamaah'), data);
            jamaahId = ref.id; jamaahName = row.name;
            summary.jamaahCreated++;
          } else if (jamaahId && jp && Object.keys(jp.patch).length > 0) {
            if (usedJamaah.has(jamaahId)) { summary.skippedDup++; }
            else { jamaahOps.push({ id: jamaahId, patch: { ...jp.patch, updatedAt: new Date().toISOString() } }); summary.jamaahUpdated++; }
          }
          if (jamaahId) usedJamaah.add(jamaahId);

          if (row.isTL && jamaahId) {
            tlChanges.push({ jamaahId, name: jamaahName, roomLabel: row.roomLabel, note: row.note });
          } else if (t.booking && bp && Object.keys(bp.patch).length > 0) {
            if (usedBookings.has(t.booking.id)) { summary.skippedDup++; }
            else { bookingOps.push({ id: t.booking.id, patch: bp.patch }); summary.bookingUpdated++; }
          }
          if (t.booking) usedBookings.add(t.booking.id);
        } catch (err) {
          summary.errors.push(`Baris ${row.rowNo} (${row.name}): ${err.message}`);
        }
      }

      for (const part of chunk(jamaahOps, 400)) {
        const batch = writeBatch(db);
        part.forEach(op => batch.update(doc(db, 'jamaah', op.id), op.patch));
        await batch.commit();
      }
      for (const part of chunk(bookingOps, 400)) {
        const batch = writeBatch(db);
        part.forEach(op => batch.update(doc(db, 'bookings', op.id), op.patch));
        await batch.commit();
      }
      if (tlChanges.length > 0 && pkg?.id) {
        const current = [...(pkg.tourLeaders || [])];
        tlChanges.forEach(ch => {
          const idx = current.findIndex(x => x.jamaahId === ch.jamaahId);
          if (idx >= 0) {
            const cur = current[idx];
            const next = { ...cur };
            if (ch.roomLabel && (overwrite || !cur.roomLabel)) next.roomLabel = ch.roomLabel;
            if (ch.note && (overwrite || !cur.note)) next.note = ch.note;
            current[idx] = next;
            summary.tlUpdated++;
          } else {
            current.push({ jamaahId: ch.jamaahId, name: ch.name, roomLabel: ch.roomLabel || '', ...(ch.note ? { note: ch.note } : {}) });
            summary.tlAdded++;
          }
        });
        await updateDoc(doc(db, 'packages', pkg.id), { tourLeaders: current });
      }

      logActivity({
        userId: currentUser?.uid,
        userName: currentUser?.fullName || currentUser?.email,
        userRole: currentUser?.role,
        action: 'update',
        module: 'Booking',
        targetLabel: pkg?.name || 'Manifest',
        details: `Import manifest dari file "${fileName}": ${summary.jamaahUpdated} jamaah diperbarui, ${summary.jamaahCreated} jamaah baru, ${summary.bookingUpdated} booking (kamar/catatan), ${summary.tlAdded + summary.tlUpdated} Tour Leader.`,
      });
      setResult(summary);
      if (onDone) await onDone();
    } catch (err) {
      alert('Import berhenti di tengah jalan: ' + err.message + '\n\nSebagian data mungkin sudah tersimpan. Buka ulang tab Manifest buat melihat kondisi terakhir, lalu coba lagi (aman diulang, data yang sama tidak dobel).');
    } finally {
      lockRef.current = false;
      setApplying(false);
    }
  };

  const cardBorder = isDark ? 'border-slate-800' : 'border-slate-200';
  const chip = (txt, cls) => <span key={txt} className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${cls}`}>{txt}</span>;

  const renderAction = (p) => {
    const { m } = p;
    const v = choices[m.row.rowNo] || 'skip';
    const sel = `${styles.inputBg} border rounded p-1 text-[11px] max-w-[220px]`;
    if (m.status === 'matched' || m.status === 'jamaah_only') {
      return (
        <select value={v} onChange={e => setChoice(m.row.rowNo, e.target.value)} className={sel}>
          <option value="apply">{m.status === 'jamaah_only' ? 'Update data jamaah saja' : 'Terapkan'}</option>
          <option value="skip">Lewati</option>
        </select>
      );
    }
    return (
      <select value={v} onChange={e => setChoice(m.row.rowNo, e.target.value)} className={sel}>
        <option value="skip">Lewati</option>
        {m.candidates.map(c => c.type === 'booking'
          ? <option key={`b${c.booking.id}`} value={`b:${c.booking.id}`}>Pakai: {c.booking.jamaahName} ({c.booking.groupBookingCode || c.booking.bookingCode || '-'})</option>
          : <option key={`j${c.jamaah.id}`} value={`j:${c.jamaah.id}`}>Pakai jamaah: {c.jamaah.fullName}{c.jamaah.customerCode ? ` (${c.jamaah.customerCode})` : ''}</option>)}
        {m.status === 'notfound' && <option value="create">Buat jamaah baru{m.row.isTL ? ' (Tour Leader)' : ''}</option>}
      </select>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
      <div className={`${styles.cardBg} border rounded-2xl w-full max-w-6xl p-5 relative max-h-[92vh] overflow-y-auto`}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-emerald-500" /> Import Manifest dari File Lama</h3>
        <p className={`text-xs ${styles.textSub} mb-4`}>
          Paket: <b>{pkg?.name || '-'}</b>. Upload file Excel atau CSV (dari Google Sheet: File, Download, Microsoft Excel atau CSV). Format kolom sama seperti hasil Export Excel manifest. Belum ada data yang disimpan sebelum lu tekan Terapkan.
        </p>

        {!result && (
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <label className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium cursor-pointer">
              <Upload className="w-4 h-4" /> {fileName ? 'Ganti file' : 'Pilih file'}
              <input type="file" accept=".xlsx,.xls,.csv,.tsv" className="hidden" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {fileName && <span className={`text-xs ${styles.textSub}`}>{fileName}{parsed ? ` · lembar "${parsed.sheetName}" · ${parsed.rows.length} baris` : ''}</span>}
            {parsing && <span className={`text-xs ${styles.textSub}`}>Membaca file...</span>}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-500 mb-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs mb-3">
            <p className="font-bold text-emerald-500 flex items-center gap-1.5 mb-2"><CheckCircle2 className="w-4 h-4" /> Import selesai</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>{result.jamaahUpdated} data jamaah diperbarui</li>
              <li>{result.jamaahCreated} jamaah baru dibuat di Data Master</li>
              <li>{result.bookingUpdated} booking diperbarui (tipe kamar, nomor kamar, catatan)</li>
              <li>{result.tlAdded} Tour Leader ditambah, {result.tlUpdated} diperbarui</li>
              {result.skippedDup > 0 && <li>{result.skippedDup} baris dilewati karena orang/booking yang sama sudah diproses di baris lain</li>}
            </ul>
            {result.errors.length > 0 && (
              <div className="mt-2 text-rose-500">
                <p className="font-semibold">Gagal ({result.errors.length}):</p>
                <ul className="list-disc list-inside">{result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <button onClick={onClose} className="mt-3 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium">Tutup</button>
          </div>
        )}

        {parsed && !result && (
          <>
            <div className={`border ${cardBorder} rounded-lg p-3 mb-3 text-[11px]`}>
              <p className="font-semibold mb-1">Kolom yang terbaca</p>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {parsed.mapped.map(mp => chip(`${mp.header || mp.label} → ${mp.label}`, 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'))}
              </div>
              {parsed.missing.length > 0 && (
                <p className={styles.textSub}>Nggak ada di file (nggak diisi): {parsed.missing.join(', ')}.</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap mb-3 text-[11px]">
              {Object.entries(STATUS_META).map(([k, meta]) => chip(`${meta.label}: ${counts[k]}`, meta.cls))}
              {chip(`Akan diproses: ${counts.willWrite}`, 'bg-slate-500/10 text-slate-400 border-slate-500/20')}
              {counts.conflicts > 0 && chip(`Ada data beda: ${counts.conflicts}`, 'bg-amber-500/10 text-amber-500 border-amber-500/20')}
              <span className="flex-1" />
              {[['all', 'Semua'], ['check', 'Perlu dicek'], ['ok', 'Aman']].map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-lg ${filter === k ? 'bg-emerald-600 text-white' : (isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')}`}>{label}</button>
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap mb-3 text-[11px]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
                Timpa data yang sudah terisi di sistem (default: cuma isi yang kosong)
              </label>
              {counts.notfound > 0 && (
                <>
                  <button onClick={() => bulkNotFound('create')} className={`px-2.5 py-1 rounded-lg ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}>Buat jamaah baru untuk semua yang tidak ketemu</button>
                  <button onClick={() => bulkNotFound('skip')} className={`px-2.5 py-1 rounded-lg ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}>Lewati semua yang tidak ketemu</button>
                </>
              )}
            </div>

            <div className={`border ${cardBorder} rounded-lg overflow-x-auto mb-3`}>
              <table className="w-full text-left text-xs min-w-[980px]">
                <thead className={`${styles.tableHeaderBg} uppercase`}>
                  <tr>
                    <th className="p-2">Baris</th>
                    <th className="p-2">Di file</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Dicocokkan ke</th>
                    <th className="p-2">Yang diisi / beda</th>
                    <th className="p-2">Aksi</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {visible.length === 0 ? (
                    <tr><td colSpan="6" className={`p-6 text-center ${styles.textSub}`}>Tidak ada baris untuk filter ini.</td></tr>
                  ) : visible.map(p => {
                    const { m, t, jp, bp } = p;
                    const r = m.row;
                    const meta = STATUS_META[m.status];
                    const target = t.action === 'write' ? t : null;
                    return (
                      <tr key={r.rowNo} className={t.action === 'skip' ? 'opacity-60' : ''}>
                        <td className={`p-2 ${styles.textSub}`}>{r.rowNo}</td>
                        <td className="p-2">
                          <div className="font-medium">{r.name}{r.isTL && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-semibold">TL</span>}</div>
                          <div className={`text-[10px] ${styles.textSub}`}>
                            {[r.code, r.passportNumber, r.roomType && `${r.roomType}${r.roomLabel ? ' ' + r.roomLabel : ''}`].filter(Boolean).join(' · ') || '-'}
                          </div>
                          {r.warnings.map((w, i) => <div key={i} className="text-[10px] text-amber-500">⚠ {w}</div>)}
                        </td>
                        <td className="p-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                          <div className={`text-[10px] mt-0.5 ${styles.textSub}`}>{m.reason}</div>
                        </td>
                        <td className="p-2">
                          {target ? (
                            <>
                              {target.createJamaah ? <span className="text-emerald-500">Jamaah baru</span> : (
                                <>
                                  {target.jamaah && <div>{target.jamaah.fullName}</div>}
                                  {target.booking && <div className={`text-[10px] ${styles.textSub}`}>Booking {target.booking.groupBookingCode || target.booking.bookingCode || '-'}</div>}
                                </>
                              )}
                            </>
                          ) : <span className={styles.textSub}>-</span>}
                        </td>
                        <td className="p-2">
                          {target ? (
                            <div className="space-y-1">
                              {(jp?.fills.length || 0) > 0 && (
                                <div className="flex flex-wrap gap-1">{jp.fills.map(f => chip(`+ ${JAMAAH_FIELD_LABELS[f]}`, 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'))}</div>
                              )}
                              {bp && Object.keys(bp.patch).length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {bp.patch.roomType && chip(`+ Tipe ${bp.patch.roomType}`, 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20')}
                                  {bp.patch.roomLabel && chip(`+ No. kamar ${bp.patch.roomLabel}`, 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20')}
                                  {bp.patch.manifestNote && chip('+ Catatan', 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20')}
                                </div>
                              )}
                              {[...(jp?.conflicts || []).map(c => ({ label: JAMAAH_FIELD_LABELS[c.field], current: c.current, incoming: c.incoming, key: `j${c.field}` })), ...(bp?.conflicts || []).map(c => ({ label: c.label, current: c.current, incoming: c.incoming, key: `b${c.field}` }))].map(c => (
                                <div key={c.key} className="text-[10px] text-amber-500">
                                  Beda {c.label}: sistem "{/^\d{4}-\d{2}-\d{2}$/.test(c.current) ? fmtDate(c.current) : c.current}", file "{/^\d{4}-\d{2}-\d{2}$/.test(c.incoming) ? fmtDate(c.incoming) : c.incoming}" {overwrite ? '(ditimpa)' : '(dibiarkan)'}
                                </div>
                              ))}
                              {!(jp?.fills.length) && !(bp && Object.keys(bp.patch).length) && !(jp?.conflicts.length) && !(bp?.conflicts.length) && (
                                <span className={`text-[10px] ${styles.textSub}`}>{target.booking || target.jamaah ? 'Sudah sama semua, tidak ada yang berubah' : '-'}</span>
                              )}
                              {m.kind === 'jamaah' && !target.booking && !r.isTL && (r.roomType || r.roomLabel) && (
                                <div className="text-[10px] text-sky-500">Kamar/catatan nggak disimpan karena belum ada booking di paket ini.</div>
                              )}
                            </div>
                          ) : <span className={`text-[10px] ${styles.textSub}`}>Dilewati</span>}
                        </td>
                        <td className="p-2">{renderAction(p)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className={`text-[11px] ${styles.textSub}`}>
                Import nggak membuat booking baru. Jamaah yang belum punya booking di paket ini cuma diperbarui/ditambahkan data pribadinya.
              </p>
              <div className="flex gap-2">
                <button onClick={onClose} disabled={applying} className={`px-4 py-2 rounded-lg text-xs ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>Batal</button>
                <button onClick={handleApply} disabled={applying || counts.willWrite === 0} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                  {applying ? 'Menyimpan...' : `Terapkan (${counts.willWrite} baris)`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
