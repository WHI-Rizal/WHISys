'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, getDoc, doc, query, where, writeBatch, increment } from 'firebase/firestore';
import { Loader2, CheckCircle2, RotateCcw, Clock } from 'lucide-react';
import DateFieldID from '@/components/DateFieldID';
import { logActivity } from '../../lib/activityLog';
import { postEdcSettlement, deleteJournalEntriesBySource } from '../../lib/journal';

// ---------------------------------------------------------------------
// Tab "Settlement EDC" (modul Keuangan).
// Setoran jamaah yang dibayar lewat mesin EDC TIDAK langsung masuk rekening:
// statusnya "Menunggu Settlement" (payments_income.settlementStatus =
// 'pending', uang ditahan di akun 1102 Piutang Settlement EDC). Begitu bank
// mencairkan, Finance pilih beberapa setoran sekaligus (1 batch), isi
// tanggal cair + nominal yang BENERAN masuk rekening. Selisih gross vs
// nominal cair = potongan MDR (dicatat Biaya Admin EDC), saldo rekening
// naik sebesar nominal cair, jurnal otomatis. Koleksi `edc_settlements`
// nyimpen 1 dokumen per batch (dipakai juga buat pembatalan settlement).
// ---------------------------------------------------------------------

const fmt = (n) => `Rp ${(Number(n) || 0).toLocaleString('id-ID')}`;
const fmtDate = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const todayISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toIsoWithNowTime = (dateStr) => {
  if (!dateStr) return new Date().toISOString();
  const timePart = new Date().toTimeString().slice(0, 8);
  const combined = new Date(`${dateStr}T${timePart}`);
  return isNaN(combined.getTime()) ? new Date().toISOString() : combined.toISOString();
};

export default function SettlementEdcTab({ isDark, styles, financialAccounts = [], currentUser, isFinanceRole, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [pendingDocs, setPendingDocs] = useState([]);
  const [edcMethods, setEdcMethods] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [form, setForm] = useState({ date: todayISODate(), received: '', accountId: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('pending'); // 'pending' | 'history'

  const load = async () => {
    setLoading(true);
    try {
      const [pSnap, mSnap, sSnap] = await Promise.all([
        getDocs(query(collection(db, 'payments_income'), where('settlementStatus', '==', 'pending'))),
        getDocs(collection(db, 'edc_methods')),
        getDocs(collection(db, 'edc_settlements'))
      ]);
      setPendingDocs(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setEdcMethods(mSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSettlements(sSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.settlementDate || '').localeCompare(String(a.settlementDate || ''))));
    } catch (err) {
      console.error('Gagal memuat data settlement EDC:', err);
      alert('Gagal memuat data settlement EDC: ' + err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Gabungkan pecahan pax dari 1 transaksi grup jadi 1 baris (kunci =
  // groupTransactionId), sama kayak Riwayat Pembayaran.
  const rows = useMemo(() => {
    const map = new Map();
    pendingDocs.forEach(p => {
      const key = p.groupTransactionId || p.id;
      if (!map.has(key)) map.set(key, { key, docs: [] });
      map.get(key).docs.push(p);
    });
    return [...map.values()].map(r => {
      const first = r.docs[0];
      return {
        ...r,
        amount: r.docs.reduce((a, d) => a + (Number(d.amount) || 0), 0),
        estMdr: r.docs.reduce((a, d) => a + (Number(d.estimatedMdrAmount) || 0), 0),
        method: first.paymentMethod,
        edcMethodId: first.edcMethodId || null,
        accountId: first.accountId || '',
        createdAt: r.docs.map(d => d.createdAt).filter(Boolean).sort()[0] || '',
        label: r.docs.length > 1
          ? `Grup ${first.notes?.match(/Grup ([^,)]+)/)?.[1] || first.bookingCode} (${r.docs.length} peserta)`
          : `${first.bookingCode || '-'} - ${first.jamaahName || '-'}`
      };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [pendingDocs]);

  const selectedRows = rows.filter(r => selectedKeys.includes(r.key));
  const grossTotal = selectedRows.reduce((a, r) => a + r.amount, 0);
  const estMdrTotal = selectedRows.reduce((a, r) => a + r.estMdr, 0);
  const pendingTotal = rows.reduce((a, r) => a + r.amount, 0);

  const edcAccountFor = (row) => {
    const m = edcMethods.find(x => x.id === row?.edcMethodId) || edcMethods.find(x => x.name === row?.method);
    return m?.accountId || row?.accountId || '';
  };

  const toggleRow = (row) => {
    if (selectedKeys.includes(row.key)) {
      const next = selectedKeys.filter(k => k !== row.key);
      setSelectedKeys(next);
      if (next.length === 0) setForm(f => ({ ...f, received: '', accountId: '' }));
      return;
    }
    const firstSel = rows.find(r => r.key === selectedKeys[0]);
    if (firstSel && firstSel.method !== row.method) {
      alert(`Satu settlement cuma boleh untuk satu metode EDC. Yang sudah dipilih "${firstSel.method}", yang ini "${row.method}". Selesaikan per metode EDC ya.`);
      return;
    }
    const next = [...selectedKeys, row.key];
    setSelectedKeys(next);
    const nextRows = rows.filter(r => next.includes(r.key));
    const g = nextRows.reduce((a, r) => a + r.amount, 0);
    const e = nextRows.reduce((a, r) => a + r.estMdr, 0);
    setForm(f => ({ ...f, received: String(g - e), accountId: edcAccountFor(nextRows[0]) || f.accountId }));
  };

  const toggleAll = () => {
    if (selectedKeys.length === rows.length) { setSelectedKeys([]); setForm(f => ({ ...f, received: '', accountId: '' })); return; }
    const m0 = rows[0]?.method;
    const sameMethod = rows.filter(r => r.method === m0);
    if (sameMethod.length !== rows.length) alert(`Ada lebih dari satu metode EDC. Yang dipilih otomatis cuma metode "${m0}".`);
    const next = sameMethod.map(r => r.key);
    setSelectedKeys(next);
    const g = sameMethod.reduce((a, r) => a + r.amount, 0);
    const e = sameMethod.reduce((a, r) => a + r.estMdr, 0);
    setForm(f => ({ ...f, received: String(g - e), accountId: edcAccountFor(sameMethod[0]) || f.accountId }));
  };

  const receivedNum = Number(form.received) || 0;
  const mdrActual = grossTotal - receivedNum;
  const mdrPct = grossTotal > 0 ? (mdrActual / grossTotal) * 100 : 0;

  const handleSettle = async (e) => {
    e.preventDefault();
    if (!isFinanceRole) { alert('Cuma Finance & Super Admin yang boleh memproses settlement.'); return; }
    if (saving) return;
    if (selectedRows.length === 0) { alert('Pilih dulu setoran yang mau di-settlement.'); return; }
    if (!form.date) { alert('Tanggal cair wajib diisi.'); return; }
    if (!form.accountId) { alert('Pilih akun Kas/Bank tujuan.'); return; }
    if (!(receivedNum > 0)) { alert('Nominal yang masuk rekening harus lebih dari 0.'); return; }
    if (receivedNum > grossTotal) { alert('Nominal masuk rekening nggak boleh lebih besar dari total setoran (gross). Cek lagi angkanya.'); return; }
    const acc = financialAccounts.find(a => a.id === form.accountId);
    const methodName = selectedRows[0].method;
    const allDocs = selectedRows.flatMap(r => r.docs);
    const label = `${methodName} ${fmtDate(form.date)}`;
    if (!confirm(`Proses settlement ${methodName}?\n\nTotal setoran: ${fmt(grossTotal)}\nMasuk rekening ${acc?.name || ''}: ${fmt(receivedNum)}\nPotongan MDR: ${fmt(mdrActual)} (${mdrPct.toFixed(2)}%)`)) return;

    setSaving(true);
    try {
      // Sanity check ulang ke Firestore: pastikan semua setoran ini MASIH
      // pending (bisa aja user lain barusan memprosesnya / mengedit).
      for (const d of allDocs) {
        const snap = await getDoc(doc(db, 'payments_income', d.id));
        if (!snap.exists() || snap.data().settlementStatus !== 'pending') {
          alert('Ada setoran yang statusnya sudah berubah (diproses/diedit/dihapus orang lain). Data akan dimuat ulang, coba pilih lagi.');
          setSelectedKeys([]);
          await load();
          return;
        }
      }

      // Bagi MDR aktual ke tiap dokumen setoran secara proporsional (sisa
      // pembulatan masuk ke dokumen pertama) supaya laporan per-booking
      // tetap punya angka MDR yang jumlahnya persis sama dengan total.
      const shares = allDocs.map(d => Math.floor((mdrActual * (Number(d.amount) || 0)) / grossTotal));
      shares[0] += mdrActual - shares.reduce((a, b) => a + b, 0);

      const nowIso = new Date().toISOString();
      const settleIso = toIsoWithNowTime(form.date);
      const settlementRef = doc(collection(db, 'edc_settlements'));
      const batch = writeBatch(db);

      batch.set(settlementRef, {
        status: 'settled',
        settlementDate: form.date,
        grossAmount: grossTotal,
        receivedAmount: receivedNum,
        mdrAmount: mdrActual,
        mdrPercentActual: Number(mdrPct.toFixed(4)),
        edcMethodName: methodName,
        accountId: form.accountId,
        accountName: acc?.name || '',
        paymentIds: allDocs.map(d => d.id),
        paymentCount: allDocs.length,
        notes: form.notes || '',
        label,
        createdAt: nowIso,
        createdByUid: currentUser?.uid || '',
        createdByName: currentUser?.fullName || currentUser?.email || ''
      });

      allDocs.forEach((d, i) => {
        batch.update(doc(db, 'payments_income', d.id), {
          settlementStatus: 'settled',
          settlementId: settlementRef.id,
          settledAt: settleIso,
          mdrAmount: shares[i]
        });
      });

      batch.update(doc(db, 'financial_accounts', form.accountId), { balance: increment(receivedNum) });
      batch.set(doc(collection(db, 'account_mutations')), {
        accountId: form.accountId,
        accountName: acc?.name || '-',
        type: 'in',
        amount: receivedNum,
        description: `Settlement EDC ${methodName} (${allDocs.length} setoran, MDR ${fmt(mdrActual)})`,
        reference: label,
        source: 'edc_settlement',
        sourceDocId: settlementRef.id,
        createdAt: settleIso
      });

      if (mdrActual > 0) {
        batch.set(doc(collection(db, 'expenses_operational')), {
          category: 'Biaya Admin EDC',
          amount: mdrActual,
          accountId: form.accountId,
          accountName: acc?.name || '-',
          date: settleIso,
          expenseDate: String(form.date).slice(0, 10),
          notes: 'Potongan MDR EDC (otomatis)',
          description: `Potongan MDR EDC - Settlement ${label}`,
          // source sama dgn MDR EDC lain biar baris ini terkunci (otomatis)
          // di tab Biaya Operasional & nggak diposting dobel oleh migrasi jurnal.
          source: 'income_payment_mdr',
          sourceDocId: settlementRef.id,
          createdAt: nowIso,
          updatedAt: nowIso
        });
      }

      await batch.commit();

      try {
        await postEdcSettlement({
          settlementId: settlementRef.id, label, grossTotal, receivedAmount: receivedNum,
          accountId: form.accountId, accountName: acc?.name || '', date: settleIso,
          createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
        });
      } catch (err) {
        console.error('Gagal posting jurnal settlement EDC:', err);
        alert(`Settlement tersimpan, TAPI jurnalnya GAGAL diposting (${err.message}). Laporan Keuangan belum akurat sampai dikoreksi. Segera lapor ke tim IT.`);
      }

      logActivity({
        userId: currentUser?.uid, userName: currentUser?.fullName || currentUser?.email, userRole: currentUser?.role,
        action: 'create', module: 'Settlement EDC', targetLabel: label,
        details: `Settlement EDC ${methodName}: ${allDocs.length} setoran, total ${fmt(grossTotal)}, masuk ${acc?.name || ''} ${fmt(receivedNum)}, MDR ${fmt(mdrActual)}.`
      });

      setSelectedKeys([]);
      setForm({ date: todayISODate(), received: '', accountId: '', notes: '' });
      await load();
      if (onChanged) onChanged();
      alert('Settlement berhasil diproses.');
    } catch (err) {
      alert('Gagal memproses settlement: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSettlement = async (st) => {
    if (!isFinanceRole) { alert('Cuma Finance & Super Admin yang boleh membatalkan settlement.'); return; }
    if (saving) return;
    // Blok kalau mutasinya sudah dicocokkan di Rekonsiliasi Bank.
    try {
      const mutSnap = await getDocs(query(collection(db, 'account_mutations'), where('accountId', '==', st.accountId), where('sourceDocId', '==', st.id)));
      const mutIds = mutSnap.docs.map(d => d.id);
      for (let i = 0; i < mutIds.length; i += 10) {
        const bsl = await getDocs(query(collection(db, 'bank_statement_lines'), where('matchedMutationId', 'in', mutIds.slice(i, i + 10)), where('matchStatus', '==', 'matched')));
        if (!bsl.empty) {
          alert('Settlement ini sudah "dicocokkan" di Rekonsiliasi Bank. Lepas dulu kecocokannya lewat Laporan Keuangan > Rekonsiliasi Bank, baru bisa dibatalkan.');
          return;
        }
      }
    } catch (err) {
      alert('Gagal mengecek status rekonsiliasi: ' + err.message);
      return;
    }
    if (!confirm(`Batalkan settlement "${st.label}"?\n\nSaldo ${st.accountName} dikurangi ${fmt(st.receivedAmount)}, ${st.paymentCount} setoran kembali ke "Menunggu Settlement", biaya MDR dan jurnalnya dihapus.`)) return;

    setSaving(true);
    try {
      const batch = writeBatch(db);
      (st.paymentIds || []).forEach(pid => {
        batch.update(doc(db, 'payments_income', pid), {
          settlementStatus: 'pending', settlementId: null, settledAt: null, mdrAmount: 0
        });
      });
      batch.update(doc(db, 'financial_accounts', st.accountId), { balance: increment(-(Number(st.receivedAmount) || 0)) });
      const mutSnap = await getDocs(query(collection(db, 'account_mutations'), where('accountId', '==', st.accountId), where('sourceDocId', '==', st.id)));
      mutSnap.docs.forEach(d => batch.delete(d.ref));
      const expSnap = await getDocs(query(collection(db, 'expenses_operational'), where('source', '==', 'income_payment_mdr'), where('sourceDocId', '==', st.id)));
      expSnap.docs.forEach(d => batch.delete(d.ref));
      batch.update(doc(db, 'edc_settlements', st.id), {
        status: 'cancelled', cancelledAt: new Date().toISOString(),
        cancelledByName: currentUser?.fullName || currentUser?.email || ''
      });
      await batch.commit();
      await deleteJournalEntriesBySource('edc_settlement', st.id);

      logActivity({
        userId: currentUser?.uid, userName: currentUser?.fullName || currentUser?.email, userRole: currentUser?.role,
        action: 'delete', module: 'Settlement EDC', targetLabel: st.label,
        details: `Membatalkan settlement EDC ${st.label} senilai ${fmt(st.receivedAmount)}.`
      });
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      alert('Gagal membatalkan settlement: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={`${styles.cardBg} border rounded-xl p-10 flex items-center justify-center gap-2 ${styles.textSub}`}>
        <Loader2 className="w-4 h-4 animate-spin" /> Memuat data settlement...
      </div>
    );
  }

  const activeSettlements = settlements.filter(s => s.status !== 'cancelled');
  const cancelledSettlements = settlements.filter(s => s.status === 'cancelled');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setView('pending')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === 'pending' ? `${styles.tabActive} border text-amber-500` : styles.textSub}`}
        >
          Menunggu Settlement ({rows.length})
        </button>
        <button
          onClick={() => setView('history')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === 'history' ? `${styles.tabActive} border text-sky-500` : styles.textSub}`}
        >
          Riwayat Settlement ({activeSettlements.length})
        </button>
        <span className={`ml-auto text-xs ${styles.textSub}`}>Total tertahan: <b className="text-amber-500">{fmt(pendingTotal)}</b></span>
      </div>

      {view === 'pending' && (
        <>
          <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
            {rows.length === 0 ? (
              <div className={`p-8 text-center text-sm ${styles.textSub}`}>
                <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
                Nggak ada setoran EDC yang menunggu settlement.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className={styles.tableHeaderBg}>
                    <tr>
                      <th className="p-3 w-8">
                        <input type="checkbox" checked={selectedKeys.length > 0 && selectedKeys.length === rows.length} onChange={toggleAll} />
                      </th>
                      <th className="p-3">Tanggal Gesek</th>
                      <th className="p-3">Booking / Jamaah</th>
                      <th className="p-3">Metode EDC</th>
                      <th className="p-3 text-right">Nominal</th>
                      <th className="p-3 text-right">Estimasi MDR</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${styles.tableRowBorder}`}>
                    {rows.map(r => (
                      <tr key={r.key} onClick={() => toggleRow(r)} className={`cursor-pointer ${selectedKeys.includes(r.key) ? (isDark ? 'bg-amber-500/10' : 'bg-amber-50') : ''}`}>
                        <td className="p-3"><input type="checkbox" readOnly checked={selectedKeys.includes(r.key)} /></td>
                        <td className={`p-3 ${styles.textSub}`}>{fmtDate(r.createdAt)}</td>
                        <td className={`p-3 ${styles.textTitle}`}>{r.label}</td>
                        <td className="p-3">{r.method}</td>
                        <td className="p-3 text-right font-bold text-emerald-500">{fmt(r.amount)}</td>
                        <td className={`p-3 text-right ${styles.textSub}`}>{fmt(r.estMdr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selectedRows.length > 0 && (
            <form onSubmit={handleSettle} className={`${styles.cardBg} border rounded-xl p-4 space-y-3`}>
              <h4 className={`text-sm font-bold ${styles.textTitle}`}>Proses Settlement ({selectedRows.length} transaksi, {selectedRows.flatMap(r => r.docs).length} setoran)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block mb-1 font-medium">Tanggal Cair di Rekening</label>
                  <DateFieldID required className={`w-full ${styles.inputBg} border rounded-lg p-2.5`} value={form.date} onChange={(val) => setForm({ ...form, date: val })} />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Masuk ke Akun Kas/Bank</label>
                  <select required className={`w-full ${styles.inputBg} border rounded-lg p-2.5`} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                    <option value="">- Pilih akun -</option>
                    {financialAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Nominal yang Beneran Masuk Rekening (Rp)</label>
                  <input type="number" min="1" required className={`w-full ${styles.inputBg} border rounded-lg p-2.5`} value={form.received} onChange={(e) => setForm({ ...form, received: e.target.value })} />
                  <p className={`mt-1 text-[10px] ${styles.textSub}`}>Isi sesuai mutasi bank. Default = total dikurangi estimasi MDR.</p>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Catatan (opsional)</label>
                  <input type="text" className={`w-full ${styles.inputBg} border rounded-lg p-2.5`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Misal: batch settlement 3 Okt" />
                </div>
              </div>
              <div className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-1`}>
                <div className="flex justify-between"><span className={styles.textSub}>Total setoran (gross)</span><b>{fmt(grossTotal)}</b></div>
                <div className="flex justify-between"><span className={styles.textSub}>Masuk rekening</span><b className="text-emerald-500">{fmt(receivedNum)}</b></div>
                <div className="flex justify-between"><span className={styles.textSub}>Potongan MDR (dicatat Biaya Admin EDC)</span><b className="text-amber-500">{fmt(mdrActual)} ({mdrPct.toFixed(2)}%)</b></div>
                {estMdrTotal > 0 && <div className="flex justify-between"><span className={styles.textSub}>Estimasi MDR saat gesek</span><span>{fmt(estMdrTotal)}</span></div>}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setSelectedKeys([]); setForm({ date: todayISODate(), received: '', accountId: '', notes: '' }); }} className={`px-4 py-2 rounded-lg text-xs ${styles.textSub}`}>Batal</button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 flex items-center gap-1.5">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Proses Settlement
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {view === 'history' && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          {activeSettlements.length === 0 ? (
            <div className={`p-8 text-center text-sm ${styles.textSub}`}>Belum ada riwayat settlement.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className={styles.tableHeaderBg}>
                  <tr>
                    <th className="p-3">Tanggal Cair</th>
                    <th className="p-3">Metode</th>
                    <th className="p-3">Akun</th>
                    <th className="p-3 text-right">Gross</th>
                    <th className="p-3 text-right">Masuk Rekening</th>
                    <th className="p-3 text-right">MDR</th>
                    <th className="p-3 text-center">Setoran</th>
                    <th className="p-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${styles.tableRowBorder}`}>
                  {activeSettlements.map(st => (
                    <tr key={st.id}>
                      <td className={`p-3 ${styles.textSub}`}>{fmtDate(st.settlementDate)}</td>
                      <td className="p-3">{st.edcMethodName}</td>
                      <td className="p-3">{st.accountName}</td>
                      <td className="p-3 text-right">{fmt(st.grossAmount)}</td>
                      <td className="p-3 text-right font-bold text-emerald-500">{fmt(st.receivedAmount)}</td>
                      <td className="p-3 text-right text-amber-500">{fmt(st.mdrAmount)}</td>
                      <td className="p-3 text-center">{st.paymentCount}</td>
                      <td className="p-3 text-center">
                        {isFinanceRole && (
                          <button onClick={() => handleCancelSettlement(st)} disabled={saving} className="text-rose-500 hover:underline inline-flex items-center gap-1 disabled:opacity-50">
                            <RotateCcw className="w-3 h-3" /> Batalkan
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cancelledSettlements.length > 0 && (
            <p className={`p-3 text-[10px] ${styles.textSub} border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              {cancelledSettlements.length} settlement pernah dibatalkan (nggak ditampilkan).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
