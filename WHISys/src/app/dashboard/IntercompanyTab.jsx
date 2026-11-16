'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, getDoc, doc, query, where, writeBatch, increment } from 'firebase/firestore';
import { Loader2, Plus, X, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import DateFieldID from '@/components/DateFieldID';
import { logActivity } from '../../lib/activityLog';
import { postIntercompanyTransaction, postIntercompanySettlement, deleteJournalEntriesBySource } from '../../lib/journal';

// ---------------------------------------------------------------------
// Tab "Hutang Piutang Antar PT" (Laporan Keuangan).
// Perusahaan dipisah jadi dua PT: WHINDO (umroh dan haji, dicatat di
// erahajj) dan WHINTER (wisata, dicatat di WHISys ini). Tab ini nyatet
// sisi WHINTER dari transaksi antar dua PT itu:
//  - Talangan biaya: satu PT bayarin biaya yang jadi beban PT lain.
//  - Biaya bersama dibagi: satu PT bayar biaya bersama, lalu dibagi dua.
// Dua koleksi: `intercompany_transactions` (1 dokumen per transaksi, ada
// claimAmount = jumlah yang ditagih/ditagih balik dan paidAmount = yang
// sudah dilunasi) dan `intercompany_settlements` (tiap cicilan pelunasan).
// Jurnal otomatis: Piutang Afiliasi (1501) kalau WHINTER yang nalangin,
// Hutang Afiliasi (2501) kalau WHINDO yang nalangin. Porsi beban WHINTER
// dicatat juga di `expenses_operational` (source 'intercompany') supaya
// Laba Rugi ikut. Saldo WHINDO di erahajj dicocokkan manual.
// ---------------------------------------------------------------------

const COUNTERPARTY = 'WHINDO';
const DEFAULT_CATEGORY = 'Biaya Antar PT';

const fmt = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
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
const byNewest = (a, b) => {
  const da = String(a.transactionDate || a.settlementDate || a.date || '');
  const dbb = String(b.transactionDate || b.settlementDate || b.date || '');
  if (da !== dbb) return da < dbb ? 1 : -1;
  return String(b.createdAt || '') < String(a.createdAt || '') ? -1 : 1;
};

const emptyTxnForm = () => ({
  kind: 'talangan', paidBy: 'whindo', date: todayISODate(), description: '',
  total: '', ownShare: '', category: DEFAULT_CATEGORY, accountId: '', notes: ''
});

const computeAmounts = (f) => {
  const total = Math.round(Number(f.total) || 0);
  const own = f.kind === 'talangan'
    ? (f.paidBy === 'whindo' ? total : 0)
    : Math.round(Number(f.ownShare) || 0);
  const claim = f.paidBy === 'whinter' ? total - own : own;
  return { total, own, claim };
};

export default function IntercompanyTab({ isDark, styles, currentUser, financialAccounts = [], operationalExpenses = [], onChanged }) {
  const roleLower = (currentUser?.role || '').toLowerCase();
  const canManage = roleLower.includes('super') || roleLower === 'finance';

  const [txns, setTxns] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('open');
  const [dirFilter, setDirFilter] = useState('all');
  const [expanded, setExpanded] = useState([]);

  const [showTxnModal, setShowTxnModal] = useState(false);
  const [txnForm, setTxnForm] = useState(emptyTxnForm());
  const [savingTxn, setSavingTxn] = useState(false);
  const savingTxnRef = useRef(false);

  const [settleTxn, setSettleTxn] = useState(null);
  const [settleForm, setSettleForm] = useState({ amount: '', date: todayISODate(), accountId: '', notes: '' });
  const [savingSettle, setSavingSettle] = useState(false);
  const savingSettleRef = useRef(false);

  const [busyId, setBusyId] = useState(null);

  const categoryOptions = useMemo(() => {
    const set = new Set([DEFAULT_CATEGORY]);
    operationalExpenses.forEach((o) => {
      if (o.category && o.source !== 'income_payment_mdr') set.add(o.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [operationalExpenses]);

  const load = async () => {
    setLoading(true);
    try {
      const [tSnap, sSnap] = await Promise.all([
        getDocs(collection(db, 'intercompany_transactions')),
        getDocs(collection(db, 'intercompany_settlements'))
      ]);
      setTxns(tSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setSettlements(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Gagal memuat hutang piutang antar PT:', err);
      alert('Gagal memuat data hutang piutang antar PT: ' + err.message);
    }
    setLoading(false);
  };
  useEffect(() => { if (canManage) load(); else setLoading(false); }, []); // eslint-disable-line

  const rows = useMemo(() => txns.map((t) => {
    const claim = Number(t.claimAmount) || 0;
    const paid = Number(t.paidAmount) || 0;
    const remaining = Math.max(0, claim - paid);
    const status = remaining <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'open');
    return { ...t, claim, paid, remaining, status, direction: t.paidBy === 'whinter' ? 'receivable' : 'payable' };
  }).sort(byNewest), [txns]);

  const summary = useMemo(() => {
    let receivable = 0; let payable = 0;
    rows.forEach((r) => { if (r.direction === 'receivable') receivable += r.remaining; else payable += r.remaining; });
    return { receivable, payable, net: receivable - payable };
  }, [rows]);

  const shownRows = rows.filter((r) => {
    if (statusFilter === 'open' && r.status === 'paid') return false;
    if (statusFilter === 'paid' && r.status !== 'paid') return false;
    if (dirFilter !== 'all' && r.direction !== dirFilter) return false;
    return true;
  });

  const toggleExpand = (id) => setExpanded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const byActor = () => ({ createdByUid: currentUser?.uid || '', createdByName: currentUser?.fullName || currentUser?.email || '' });
  const logBy = (extra) => logActivity({
    userId: currentUser?.uid, userName: currentUser?.fullName || currentUser?.email, userRole: currentUser?.role,
    module: 'Hutang Piutang Antar PT', ...extra
  });

  // Mutasi yang sudah dicocokkan di Rekonsiliasi Bank tidak boleh dibatalkan.
  const isReconciled = async (accountId, mutationIds) => {
    if (!accountId || !mutationIds.length) return false;
    const ids = new Set(mutationIds);
    const snap = await getDocs(query(collection(db, 'bank_statement_lines'), where('accountId', '==', accountId), where('matchStatus', '==', 'matched')));
    return snap.docs.some((d) => ids.has(d.data().matchedMutationId));
  };
  const RECON_MSG = 'Mutasi bank dari transaksi ini sudah "dicocokkan" di Rekonsiliasi Bank. Lepas dulu kecocokannya di Laporan Keuangan > Rekonsiliasi Bank, baru bisa dibatalkan.';

  // ------------------------------------------------------------------
  // Catat transaksi baru
  // ------------------------------------------------------------------
  const handleTxnSubmit = async (e) => {
    e.preventDefault();
    if (savingTxnRef.current) return;
    if (!canManage) { alert('Cuma Finance dan Super Admin yang boleh mencatat hutang piutang antar PT.'); return; }
    const f = txnForm;
    const { total, own, claim } = computeAmounts(f);
    const desc = (f.description || '').trim();
    if (!desc) { alert('Isi keterangan transaksinya dulu.'); return; }
    if (total <= 0) { alert('Isi nominal yang valid (lebih dari 0).'); return; }
    if (f.kind === 'biaya_bersama') {
      if (own < 0 || own > total) { alert('Porsi beban WHINTER harus antara 0 dan total biaya.'); return; }
      if (claim <= 0) { alert(f.paidBy === 'whinter' ? 'Porsi WHINDO nggak boleh 0 (nggak ada yang ditagihkan). Kurangi porsi WHINTER.' : 'Porsi WHINTER harus lebih dari 0.'); return; }
    }
    const acc = f.paidBy === 'whinter' ? financialAccounts.find((a) => a.id === f.accountId) : null;
    if (f.paidBy === 'whinter' && !acc) { alert('Pilih rekening yang dipakai buat bayar.'); return; }
    if (acc && (Number(acc.balance) || 0) < total) {
      if (!confirm(`Saldo ${acc.name} sekarang ${fmt(acc.balance)}, lebih kecil dari uang yang keluar (${fmt(total)}). Saldonya akan jadi minus. Tetap lanjut?`)) return;
    }
    const category = (f.category || '').trim() || DEFAULT_CATEGORY;

    savingTxnRef.current = true;
    setSavingTxn(true);
    try {
      const createdAt = toIsoWithNowTime(f.date);
      const txnId = `ict_${Date.now()}`;
      const expId = `${txnId}_exp`;
      const batch = writeBatch(db);
      batch.set(doc(db, 'intercompany_transactions', txnId), {
        kind: f.kind, paidBy: f.paidBy, counterparty: COUNTERPARTY,
        description: desc, notes: (f.notes || '').trim(),
        totalAmount: total, ownShare: own, claimAmount: claim, paidAmount: 0, status: 'open',
        category: own > 0 ? category : '',
        accountId: acc ? acc.id : '', accountName: acc ? acc.name : '',
        transactionDate: f.date || todayISODate(), createdAt, ...byActor()
      });
      if (acc) {
        batch.update(doc(db, 'financial_accounts', acc.id), { balance: increment(-total) });
        batch.set(doc(collection(db, 'account_mutations')), {
          accountId: acc.id, accountName: acc.name, type: 'out', amount: total,
          description: `${f.kind === 'talangan' ? 'Talangan untuk' : 'Biaya bersama dengan'} ${COUNTERPARTY} - ${desc}`,
          reference: COUNTERPARTY, source: 'intercompany_txn', sourceDocId: txnId, createdAt
        });
      }
      if (own > 0) {
        batch.set(doc(db, 'expenses_operational', expId), {
          category, amount: own, notes: `[Antar PT ${COUNTERPARTY}] ${desc}`,
          expenseDate: f.date || todayISODate(), source: 'intercompany', sourceDocId: txnId, createdAt
        });
      }
      await batch.commit();

      try {
        await postIntercompanyTransaction({
          txnId, label: desc, paidBy: f.paidBy, totalAmount: total, ownShare: own, claimAmount: claim,
          category, accountId: acc?.id, accountName: acc?.name, date: createdAt, ...byActor()
        });
      } catch (jErr) {
        console.error('Gagal posting jurnal antar PT:', jErr);
        alert(`Transaksi tersimpan, TAPI jurnalnya GAGAL diposting (${jErr.message}). Neraca belum akurat untuk transaksi ini sampai dikoreksi, segera lapor ke tim IT/Finance.`);
      }

      logBy({
        action: 'create', targetLabel: desc,
        details: `Mencatat ${f.kind === 'talangan' ? 'talangan' : 'biaya bersama'} antar PT (${f.paidBy === 'whinter' ? 'dibayar WHINTER' : 'dibayar WHINDO'}) total ${fmt(total)}, tagihan ${fmt(claim)}`
      });
      setShowTxnModal(false);
      setTxnForm(emptyTxnForm());
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      alert('Gagal menyimpan transaksi: ' + err.message);
    } finally {
      savingTxnRef.current = false;
      setSavingTxn(false);
    }
  };

  // ------------------------------------------------------------------
  // Pelunasan / cicilan
  // ------------------------------------------------------------------
  const openSettle = (r) => {
    setSettleTxn(r);
    setSettleForm({ amount: String(r.remaining), date: todayISODate(), accountId: '', notes: '' });
  };

  const handleSettleSubmit = async (e) => {
    e.preventDefault();
    if (savingSettleRef.current || !settleTxn) return;
    if (!canManage) { alert('Cuma Finance dan Super Admin yang boleh mencatat pelunasan.'); return; }
    const r = settleTxn;
    const amt = Math.round(Number(settleForm.amount) || 0);
    if (amt <= 0) { alert('Isi nominal yang valid (lebih dari 0).'); return; }
    if (amt > r.remaining) { alert(`Nominal melebihi sisa tagihan (${fmt(r.remaining)}).`); return; }
    const acc = financialAccounts.find((a) => a.id === settleForm.accountId);
    if (!acc) { alert(r.direction === 'receivable' ? 'Pilih rekening yang menerima uangnya.' : 'Pilih rekening yang dipakai buat bayar.'); return; }
    if (r.direction === 'payable' && (Number(acc.balance) || 0) < amt) {
      if (!confirm(`Saldo ${acc.name} sekarang ${fmt(acc.balance)}, lebih kecil dari nominal bayar (${fmt(amt)}). Saldonya akan jadi minus. Tetap lanjut?`)) return;
    }
    savingSettleRef.current = true;
    setSavingSettle(true);
    try {
      const createdAt = toIsoWithNowTime(settleForm.date);
      const sid = `ics_${Date.now()}`;
      const newPaid = r.paid + amt;
      const isIn = r.direction === 'receivable';
      const batch = writeBatch(db);
      batch.set(doc(db, 'intercompany_settlements', sid), {
        txnId: r.id, txnDescription: r.description, direction: r.direction, amount: amt,
        accountId: acc.id, accountName: acc.name, notes: (settleForm.notes || '').trim(),
        settlementDate: settleForm.date || todayISODate(), createdAt, ...byActor()
      });
      batch.update(doc(db, 'intercompany_transactions', r.id), {
        paidAmount: increment(amt), status: newPaid >= r.claim ? 'paid' : 'partial'
      });
      batch.update(doc(db, 'financial_accounts', acc.id), { balance: increment(isIn ? amt : -amt) });
      batch.set(doc(collection(db, 'account_mutations')), {
        accountId: acc.id, accountName: acc.name, type: isIn ? 'in' : 'out', amount: amt,
        description: `${isIn ? 'Pelunasan dari' : 'Bayar ke'} ${COUNTERPARTY} - ${r.description}`,
        reference: COUNTERPARTY, source: 'intercompany_settlement', sourceDocId: sid, createdAt
      });
      await batch.commit();

      try {
        await postIntercompanySettlement({
          settlementId: sid, label: r.description, direction: r.direction, amount: amt,
          accountId: acc.id, accountName: acc.name, date: createdAt, ...byActor()
        });
      } catch (jErr) {
        console.error('Gagal posting jurnal pelunasan antar PT:', jErr);
        alert(`Pelunasan tersimpan & saldo sudah berubah, TAPI jurnalnya GAGAL diposting (${jErr.message}). Segera lapor ke tim IT/Finance.`);
      }

      logBy({
        action: 'create', targetLabel: r.description,
        details: `${isIn ? 'Menerima pelunasan dari' : 'Membayar ke'} ${COUNTERPARTY} ${fmt(amt)} (${r.description})`
      });
      setSettleTxn(null);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      alert('Gagal menyimpan pelunasan: ' + err.message);
    } finally {
      savingSettleRef.current = false;
      setSavingSettle(false);
    }
  };

  const handleCancelSettlement = async (st) => {
    if (!canManage) { alert('Cuma Finance dan Super Admin yang boleh membatalkan pelunasan.'); return; }
    if (busyId) return;
    setBusyId(st.id);
    try {
      const stSnap = await getDoc(doc(db, 'intercompany_settlements', st.id));
      if (!stSnap.exists()) { alert('Pelunasan ini sudah dibatalkan sebelumnya. Muat ulang buat lihat kondisi terbaru.'); await load(); return; }
      const s = stSnap.data();
      const mutSnap = await getDocs(query(collection(db, 'account_mutations'), where('sourceDocId', '==', st.id)));
      if (await isReconciled(s.accountId, mutSnap.docs.map((d) => d.id))) { alert(RECON_MSG); return; }
      if (!confirm(`Batalkan pelunasan ${fmt(s.amount)} (${fmtDate(s.settlementDate)})? Saldo rekening ${s.accountName} dan sisa tagihan dikembalikan seperti semula.`)) return;

      const txnSnap = await getDoc(doc(db, 'intercompany_transactions', s.txnId));
      const batch = writeBatch(db);
      const delta = s.direction === 'receivable' ? -(Number(s.amount) || 0) : (Number(s.amount) || 0);
      if (s.accountId) batch.update(doc(db, 'financial_accounts', s.accountId), { balance: increment(delta) });
      mutSnap.docs.forEach((d) => batch.delete(d.ref));
      if (txnSnap.exists()) {
        const t = txnSnap.data();
        const newPaid = Math.max(0, (Number(t.paidAmount) || 0) - (Number(s.amount) || 0));
        batch.update(txnSnap.ref, { paidAmount: increment(-(Number(s.amount) || 0)), status: newPaid > 0 ? 'partial' : 'open' });
      }
      batch.delete(doc(db, 'intercompany_settlements', st.id));
      await batch.commit();
      await deleteJournalEntriesBySource('intercompany_settlement', st.id);

      logBy({ action: 'delete', targetLabel: s.txnDescription || '-', details: `Membatalkan pelunasan antar PT ${fmt(s.amount)} (${s.txnDescription || '-'})` });
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      alert('Gagal membatalkan pelunasan: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelTxn = async (r) => {
    if (!canManage) { alert('Cuma Finance dan Super Admin yang boleh membatalkan transaksi.'); return; }
    if (busyId) return;
    setBusyId(r.id);
    try {
      const tSnap = await getDoc(doc(db, 'intercompany_transactions', r.id));
      if (!tSnap.exists()) { alert('Transaksi ini sudah dibatalkan sebelumnya. Muat ulang buat lihat kondisi terbaru.'); await load(); return; }
      const t = tSnap.data();
      const stSnap = await getDocs(query(collection(db, 'intercompany_settlements'), where('txnId', '==', r.id)));
      if (!stSnap.empty) { alert('Transaksi ini sudah punya catatan pelunasan. Batalkan dulu pelunasannya (buka baris, klik Batalkan di riwayat pelunasan), baru transaksinya bisa dibatalkan.'); return; }
      const mutSnap = await getDocs(query(collection(db, 'account_mutations'), where('sourceDocId', '==', r.id)));
      if (t.accountId && await isReconciled(t.accountId, mutSnap.docs.map((d) => d.id))) { alert(RECON_MSG); return; }
      if (!confirm(`Batalkan transaksi "${t.description}" senilai ${fmt(t.totalAmount)}?${t.accountId ? ` Saldo ${t.accountName} dikembalikan.` : ''} Jurnal dan catatan biayanya ikut dihapus.`)) return;

      const batch = writeBatch(db);
      if (t.accountId) batch.update(doc(db, 'financial_accounts', t.accountId), { balance: increment(Number(t.totalAmount) || 0) });
      mutSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'expenses_operational', `${r.id}_exp`));
      batch.delete(doc(db, 'intercompany_transactions', r.id));
      await batch.commit();
      await deleteJournalEntriesBySource('intercompany_txn', r.id);

      logBy({ action: 'delete', targetLabel: t.description || '-', details: `Membatalkan transaksi antar PT "${t.description}" senilai ${fmt(t.totalAmount)}` });
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      alert('Gagal membatalkan transaksi: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (!canManage) {
    return (
      <div className={`${styles.cardBg} border rounded-xl p-8 text-center text-xs ${styles.textSub}`}>
        Tab ini cuma bisa dibuka oleh Finance dan Super Admin.
      </div>
    );
  }
  if (loading) {
    return (
      <div className={`${styles.cardBg} border rounded-xl p-10 flex items-center justify-center gap-2 text-xs ${styles.textSub}`}>
        <Loader2 className="w-4 h-4 animate-spin" /> Memuat hutang piutang antar PT...
      </div>
    );
  }

  const preview = computeAmounts(txnForm);
  const borderCls = isDark ? 'border-slate-800' : 'border-slate-200';
  const statusBadge = (s) => {
    if (s === 'paid') return <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">Lunas</span>;
    if (s === 'partial') return <span className="bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">Sebagian</span>;
    return <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">Belum dibayar</span>;
  };
  const dirBadge = (d) => d === 'receivable'
    ? <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">Piutang</span>
    : <span className="bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2 py-0.5 rounded-full text-[10px] font-medium">Hutang</span>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={`text-sm font-bold ${styles.textTitle}`}>Hutang Piutang Antar PT</h3>
        </div>
        <button
          onClick={() => { setTxnForm(emptyTxnForm()); setShowTxnModal(true); }}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Catat Transaksi
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Piutang ke {COUNTERPARTY} (belum dibayar)</p>
          <p className="text-lg font-bold text-emerald-500">{fmt(summary.receivable)}</p>
          <p className={`text-[10px] ${styles.textSub} mt-0.5`}>WHINTER nalangin, {COUNTERPARTY} masih berhutang.</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Hutang ke {COUNTERPARTY} (belum dibayar)</p>
          <p className="text-lg font-bold text-rose-500">{fmt(summary.payable)}</p>
          <p className={`text-[10px] ${styles.textSub} mt-0.5`}>{COUNTERPARTY} nalangin, WHINTER masih berhutang.</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Posisi bersih</p>
          <p className={`text-lg font-bold ${summary.net >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{fmt(Math.abs(summary.net))}</p>
          <p className={`text-[10px] ${styles.textSub} mt-0.5`}>
            {summary.net === 0 ? 'Impas.' : summary.net > 0 ? `${COUNTERPARTY} berhutang ke WHINTER.` : `WHINTER berhutang ke ${COUNTERPARTY}.`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className={`${styles.inputBg} rounded-lg p-2 text-xs h-9`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">Belum lunas</option>
          <option value="paid">Sudah lunas</option>
          <option value="all">Semua status</option>
        </select>
        <select className={`${styles.inputBg} rounded-lg p-2 text-xs h-9`} value={dirFilter} onChange={(e) => setDirFilter(e.target.value)}>
          <option value="all">Piutang dan Hutang</option>
          <option value="receivable">Piutang saja</option>
          <option value="payable">Hutang saja</option>
        </select>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={styles.tableHeaderBg}>
              <tr>
                <th className="p-3 w-8" />
                <th className="p-3 text-left font-medium">Tanggal</th>
                <th className="p-3 text-left font-medium">Keterangan</th>
                <th className="p-3 text-left font-medium">Arah</th>
                <th className="p-3 text-right font-medium">Tagihan</th>
                <th className="p-3 text-right font-medium">Terbayar</th>
                <th className="p-3 text-right font-medium">Sisa</th>
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-center font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {shownRows.length === 0 ? (
                <tr><td colSpan="9" className={`p-8 text-center ${styles.textSub}`}>Belum ada transaksi antar PT{statusFilter === 'open' ? ' yang belum lunas' : ''}.</td></tr>
              ) : shownRows.map((r) => {
                const isOpen = expanded.includes(r.id);
                const rowSettlements = settlements.filter((s) => s.txnId === r.id).sort(byNewest);
                return (
                  <React.Fragment key={r.id}>
                    <tr className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                      <td className="p-3">
                        <button onClick={() => toggleExpand(r.id)} className={styles.textSub} title="Lihat rincian">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className={`p-3 whitespace-nowrap ${styles.textSub}`}>{fmtDate(r.transactionDate)}</td>
                      <td className={`p-3 ${styles.textTitle}`}>
                        <div className="font-medium">{r.description}</div>
                        <div className={`text-[10px] ${styles.textSub}`}>{r.kind === 'talangan' ? 'Talangan biaya' : 'Biaya bersama dibagi'}, dibayar {r.paidBy === 'whinter' ? 'WHINTER' : COUNTERPARTY}</div>
                      </td>
                      <td className="p-3">{dirBadge(r.direction)}</td>
                      <td className="p-3 text-right font-medium">{fmt(r.claim)}</td>
                      <td className="p-3 text-right text-emerald-500">{fmt(r.paid)}</td>
                      <td className={`p-3 text-right font-bold ${r.remaining > 0 ? 'text-amber-500' : styles.textSub}`}>{fmt(r.remaining)}</td>
                      <td className="p-3">{statusBadge(r.status)}</td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {r.remaining > 0 && (
                            <button onClick={() => openSettle(r)} className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-medium whitespace-nowrap">
                              {r.direction === 'receivable' ? 'Terima pelunasan' : 'Bayar'}
                            </button>
                          )}
                          {rowSettlements.length === 0 && (
                            <button onClick={() => handleCancelTxn(r)} disabled={busyId === r.id} className={`px-2.5 py-1.5 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} text-rose-500 rounded-lg text-[11px] font-medium whitespace-nowrap disabled:opacity-60`}>
                              {busyId === r.id ? '...' : 'Batalkan'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className={isDark ? 'bg-slate-950/50' : 'bg-slate-50/70'}>
                        <td />
                        <td colSpan="8" className="p-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                            <div className="space-y-1">
                              <div className="flex justify-between gap-4"><span className={styles.textSub}>Uang yang dikeluarkan</span><span className="font-medium">{fmt(r.totalAmount)}</span></div>
                              <div className="flex justify-between gap-4"><span className={styles.textSub}>Beban WHINTER{r.category ? ` (${r.category})` : ''}</span><span className="font-medium">{fmt(r.ownShare)}</span></div>
                              <div className="flex justify-between gap-4"><span className={styles.textSub}>Rekening WHINTER</span><span className="font-medium">{r.accountName || '- (tidak lewat rekening WHINTER)'}</span></div>
                              {r.notes && <div className="flex justify-between gap-4"><span className={styles.textSub}>Catatan</span><span className="font-medium text-right">{r.notes}</span></div>}
                            </div>
                            <div>
                              <div className={`font-semibold mb-1 ${styles.textTitle}`}>Riwayat pelunasan</div>
                              {rowSettlements.length === 0 ? (
                                <div className={styles.textSub}>Belum ada pelunasan.</div>
                              ) : rowSettlements.map((s) => (
                                <div key={s.id} className={`flex items-center justify-between gap-3 py-1 border-b ${borderCls}`}>
                                  <div>
                                    <div className="font-medium">{fmt(s.amount)} <span className={`font-normal ${styles.textSub}`}>({fmtDate(s.settlementDate)}, {s.accountName})</span></div>
                                    {s.notes && <div className={styles.textSub}>{s.notes}</div>}
                                  </div>
                                  <button onClick={() => handleCancelSettlement(s)} disabled={busyId === s.id} className="text-rose-500 hover:underline flex items-center gap-1 disabled:opacity-60 whitespace-nowrap">
                                    <RotateCcw className="w-3 h-3" /> Batalkan
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL CATAT TRANSAKSI */}
      {showTxnModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative`}>
            <div className={`p-5 border-b ${borderCls} flex justify-between items-start gap-4`}>
              <div>
                <h3 className={`text-lg font-bold ${styles.textTitle}`}>Catat Transaksi Antar PT</h3>
                <p className={`text-xs ${styles.textSub} mt-1`}>Talangan biaya atau biaya bersama antara WHINTER dan {COUNTERPARTY}.</p>
              </div>
              <button onClick={() => setShowTxnModal(false)} className={`p-1.5 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'} rounded-lg`}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleTxnSubmit} className="p-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-medium text-xs">Jenis</label>
                  <select className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.kind} onChange={(e) => setTxnForm({ ...txnForm, kind: e.target.value, ownShare: '' })}>
                    <option value="talangan">Talangan biaya</option>
                    <option value="biaya_bersama">Biaya bersama dibagi</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium text-xs">Siapa yang bayar</label>
                  <select className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.paidBy} onChange={(e) => setTxnForm({ ...txnForm, paidBy: e.target.value, accountId: '', ownShare: '' })}>
                    <option value="whindo">{COUNTERPARTY} (kita jadi berhutang)</option>
                    <option value="whinter">WHINTER (kita menalangi)</option>
                  </select>
                </div>
              </div>
              <p className={`text-[10px] ${styles.textSub} -mt-2`}>
                {txnForm.kind === 'talangan'
                  ? (txnForm.paidBy === 'whindo'
                    ? `${COUNTERPARTY} membayar biaya yang jadi beban WHINTER. Seluruhnya dicatat jadi Biaya Operasional WHINTER dan Hutang ke ${COUNTERPARTY}.`
                    : `WHINTER membayar biaya yang jadi beban ${COUNTERPARTY}. Uang keluar dari rekening WHINTER dan dicatat sebagai Piutang ke ${COUNTERPARTY}.`)
                  : (txnForm.paidBy === 'whindo'
                    ? `${COUNTERPARTY} membayar biaya bersama. Porsi WHINTER jadi Biaya Operasional dan Hutang ke ${COUNTERPARTY}.`
                    : `WHINTER membayar biaya bersama. Porsi WHINTER jadi Biaya Operasional, porsi ${COUNTERPARTY} jadi Piutang.`)}
              </p>
              <div>
                <label className="block mb-1 font-medium text-xs">Keterangan</label>
                <input type="text" required placeholder="cth: Sewa kantor November 2026" className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.description} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-medium text-xs">{txnForm.kind === 'talangan' ? 'Nominal (Rp)' : 'Total biaya (Rp)'}</label>
                  <input type="number" min="1" inputMode="numeric" required placeholder="0" className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.total} onChange={(e) => setTxnForm({ ...txnForm, total: e.target.value })} />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-xs">Tanggal</label>
                  <DateFieldID value={txnForm.date} onChange={(val) => setTxnForm({ ...txnForm, date: val })} className={`w-full ${styles.inputBg} rounded-lg p-2.5`} />
                </div>
              </div>
              {txnForm.kind === 'biaya_bersama' && (
                <div>
                  <label className="block mb-1 font-medium text-xs">Porsi beban WHINTER (Rp)</label>
                  <input type="number" min="0" inputMode="numeric" placeholder="0" className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.ownShare} onChange={(e) => setTxnForm({ ...txnForm, ownShare: e.target.value })} />
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {[30, 40, 50, 60, 70].map((p) => (
                      <button
                        key={p} type="button"
                        disabled={preview.total <= 0}
                        onClick={() => setTxnForm({ ...txnForm, ownShare: String(Math.round(preview.total * p / 100)) })}
                        className={`px-2 py-1 rounded-md text-[10px] border ${borderCls} ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'} disabled:opacity-50`}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {txnForm.paidBy === 'whinter' && (
                <div>
                  <label className="block mb-1 font-medium text-xs">Dibayar dari rekening</label>
                  <select required className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.accountId} onChange={(e) => setTxnForm({ ...txnForm, accountId: e.target.value })}>
                    <option value="">- Pilih rekening -</option>
                    {financialAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} (saldo {fmt(a.balance)})</option>)}
                  </select>
                </div>
              )}
              {preview.own > 0 && (
                <div>
                  <label className="block mb-1 font-medium text-xs">Kategori biaya WHINTER</label>
                  <select className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.category} onChange={(e) => setTxnForm({ ...txnForm, category: e.target.value })}>
                    {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block mb-1 font-medium text-xs">Catatan (opsional)</label>
                <input type="text" placeholder="cth: sesuai invoice vendor" className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={txnForm.notes} onChange={(e) => setTxnForm({ ...txnForm, notes: e.target.value })} />
              </div>
              {preview.total > 0 && (
                <div className={`${styles.innerBg} border rounded-lg p-3 text-xs space-y-1`}>
                  {txnForm.paidBy === 'whinter' && <div className="flex justify-between"><span className={styles.textSub}>Keluar dari rekening WHINTER</span><span className="font-semibold text-rose-500">{fmt(preview.total)}</span></div>}
                  {preview.own > 0 && <div className="flex justify-between"><span className={styles.textSub}>Biaya Operasional WHINTER</span><span className="font-semibold">{fmt(preview.own)}</span></div>}
                  <div className="flex justify-between">
                    <span className={styles.textSub}>{txnForm.paidBy === 'whinter' ? `Piutang ke ${COUNTERPARTY}` : `Hutang ke ${COUNTERPARTY}`}</span>
                    <span className={`font-semibold ${txnForm.paidBy === 'whinter' ? 'text-emerald-500' : 'text-rose-500'}`}>{fmt(preview.claim)}</span>
                  </div>
                </div>
              )}
              <div className={`pt-3 flex justify-end gap-3 border-t ${borderCls}`}>
                <button type="button" onClick={() => setShowTxnModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>Batal</button>
                <button type="submit" disabled={savingTxn} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium disabled:opacity-60">{savingTxn ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PELUNASAN */}
      {settleTxn && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto relative`}>
            <div className={`p-5 border-b ${borderCls} flex justify-between items-start gap-4`}>
              <div>
                <h3 className={`text-lg font-bold ${styles.textTitle}`}>{settleTxn.direction === 'receivable' ? `Terima Pelunasan dari ${COUNTERPARTY}` : `Bayar ke ${COUNTERPARTY}`}</h3>
                <p className={`text-xs ${styles.textSub} mt-1`}>{settleTxn.description}. Sisa tagihan {fmt(settleTxn.remaining)}.</p>
              </div>
              <button onClick={() => setSettleTxn(null)} className={`p-1.5 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'} rounded-lg`}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSettleSubmit} className="p-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-medium text-xs">Nominal (Rp)</label>
                  <input type="number" min="1" max={settleTxn.remaining} inputMode="numeric" required className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={settleForm.amount} onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })} />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-xs">Tanggal</label>
                  <DateFieldID value={settleForm.date} onChange={(val) => setSettleForm({ ...settleForm, date: val })} className={`w-full ${styles.inputBg} rounded-lg p-2.5`} />
                </div>
              </div>
              <div>
                <label className="block mb-1 font-medium text-xs">{settleTxn.direction === 'receivable' ? 'Uang masuk ke rekening' : 'Dibayar dari rekening'}</label>
                <select required className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={settleForm.accountId} onChange={(e) => setSettleForm({ ...settleForm, accountId: e.target.value })}>
                  <option value="">- Pilih rekening -</option>
                  {financialAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} (saldo {fmt(a.balance)})</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium text-xs">Catatan (opsional)</label>
                <input type="text" placeholder="cth: transfer BCA tanggal 20" className={`w-full ${styles.inputBg} rounded-lg p-2.5`} value={settleForm.notes} onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })} />
              </div>
              <div className={`pt-3 flex justify-end gap-3 border-t ${borderCls}`}>
                <button type="button" onClick={() => setSettleTxn(null)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>Batal</button>
                <button type="submit" disabled={savingSettle} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium disabled:opacity-60">{savingSettle ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
