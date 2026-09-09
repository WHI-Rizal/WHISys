'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import {
  BookOpen, Wallet, TrendingUp, Scale, Users, RefreshCw, Download,
  ChevronDown, ChevronRight, ShieldCheck, X
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  COA, ACC, seedChartOfAccounts, fetchAllJournalEntries, fetchChartOfAccounts,
  runInitialJournalMigration, postJournalEntry
} from '../../lib/journal';

// ---------------------------------------------------------------------
// Helper tanggal/format kecil — duplikat sengaja dari FinanceModule.jsx
// (bukan di-share lewat import) biar modul ini tetap independen & nggak
// nambah kopling ke file lain yang nggak perlu.
// ---------------------------------------------------------------------
const todayISODate = () => new Date().toISOString().slice(0, 10);

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatRp = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

const getPeriodKey = (dateString) => {
  const d = dateString ? new Date(dateString) : new Date();
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const formatPeriodLabel = (periodKey) => {
  if (!periodKey || periodKey === '-') return '-';
  const [y, m] = periodKey.split('-');
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${months[Number(m) - 1] || m} ${y}`;
};

const ACCOUNT_TYPE_ORDER = ['Aset', 'Liabilitas', 'Ekuitas', 'Pendapatan', 'Beban'];

const AGING_BUCKETS = [
  { key: '0-30', label: '0-30 Hari', min: 0, max: 30 },
  { key: '31-60', label: '31-60 Hari', min: 31, max: 60 },
  { key: '61-90', label: '61-90 Hari', min: 61, max: 90 },
  { key: '90+', label: '> 90 Hari', min: 91, max: Infinity },
];

const daysBetween = (fromISO, toISO) => {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0;
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
};

const bucketFor = (days) => AGING_BUCKETS.find(b => days >= b.min && days <= b.max) || AGING_BUCKETS[AGING_BUCKETS.length - 1];

export default function LaporanKeuanganModule({ theme = 'dark', currentUser = null }) {
  const isDark = theme === 'dark';
  const isSuperAdmin = (currentUser?.role || '').toLowerCase().includes('super');

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    tableHeaderBg: isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    tableRowBorder: isDark ? 'divide-slate-800/60' : 'divide-slate-200',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
    tabActive: isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300 text-slate-900 font-bold',
  };

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('journal');

  const [journalEntries, setJournalEntries] = useState([]);
  const [chartOfAccounts, setChartOfAccounts] = useState(COA);
  const [bookingsList, setBookingsList] = useState([]);
  const [packagesList, setPackagesList] = useState([]);
  const [vendorBills, setVendorBills] = useState([]);
  const [vendorsList, setVendorsList] = useState([]);
  const [financialAccounts, setFinancialAccounts] = useState([]);
  const [paymentsIncome, setPaymentsIncome] = useState([]);
  const [paymentsVendor, setPaymentsVendor] = useState([]);
  const [operationalExpenses, setOperationalExpenses] = useState([]);

  const [migrating, setMigrating] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      await seedChartOfAccounts();
      const [
        jeList, coaList, bookSnap, pkgSnap, billSnap, vendorSnap, accSnap,
        incomeSnap, vendorPaySnap, opexSnap, migFlagSnap
      ] = await Promise.all([
        fetchAllJournalEntries(),
        fetchChartOfAccounts(),
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'packages')),
        getDocs(collection(db, 'vendor_bills')),
        getDocs(collection(db, 'vendors')),
        getDocs(collection(db, 'financial_accounts')),
        getDocs(collection(db, 'payments_income')),
        getDocs(collection(db, 'payments_vendor')),
        getDocs(collection(db, 'expenses_operational')),
        getDoc(doc(db, 'settings', 'journal_migration')),
      ]);
      setJournalEntries(jeList);
      setChartOfAccounts(coaList);
      setBookingsList(bookSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPackagesList(pkgSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setVendorBills(billSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setVendorsList(vendorSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.isCategoryConfig));
      setFinancialAccounts(accSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPaymentsIncome(incomeSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPaymentsVendor(vendorPaySnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setOperationalExpenses(opexSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setMigrationDone(!!(migFlagSnap.exists() && migFlagSnap.data().done));
    } catch (err) {
      console.error('Gagal memuat data Laporan Keuangan:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleRunMigration = async () => {
    if (!confirm('Migrasi data awal ini akan bikin jurnal dari SELURUH data lama (booking, setoran, bayar vendor, biaya operasional, pengakuan pendapatan, pembatalan) yang belum pernah dijurnal sebelumnya. Proses ini SEKALI JALAN doang dan tidak bisa diulang kalau sudah pernah sukses. Lanjutkan?')) return;
    setMigrating(true);
    try {
      const summary = await runInitialJournalMigration({
        financialAccounts, bookings: bookingsList, paymentsIncome, paymentsVendor,
        operationalExpenses, packages: packagesList,
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email
      });
      alert(`Migrasi selesai!\n\nJurnal dibuat: ${summary.created}\nDilewati (nominal 0): ${summary.skipped}\nError: ${summary.errors.length}${summary.errors.length > 0 ? `\n\nDetail error:\n${summary.errors.slice(0, 10).join('\n')}` : ''}`);
      await fetchData();
    } catch (err) {
      alert('Gagal menjalankan migrasi: ' + err.message);
    }
    setMigrating(false);
  };

  if (loading) {
    return (
      <div className={`${styles.cardBg} border rounded-xl p-12 text-center`}>
        <RefreshCw className={`w-6 h-6 mx-auto mb-3 animate-spin ${styles.textSub}`} />
        <p className={`text-xs ${styles.textSub}`}>Memuat data Laporan Keuangan...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3`}>
        <div>
          <h2 className={`text-lg font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Scale className="w-5 h-5 text-indigo-500" /> Laporan Keuangan
          </h2>
          <p className={`text-xs ${styles.textSub} mt-0.5`}>Jurnal Umum, Buku Besar, Neraca, Arus Kas, Piutang & Hutang — jurnal ganda otomatis dari setiap transaksi.</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && !migrationDone && (
            <button
              onClick={handleRunMigration}
              disabled={migrating}
              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${migrating ? 'animate-spin' : ''}`} /> {migrating ? 'Memproses...' : 'Migrasi Data Awal'}
            </button>
          )}
          {isSuperAdmin && migrationDone && (
            <span className="text-[10.5px] text-emerald-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Migrasi data awal sudah pernah dijalankan.</span>
          )}
        </div>
      </div>

      <div className={`${styles.cardBg} border rounded-xl p-1.5 flex flex-wrap gap-1`}>
        {[
          { key: 'journal', label: 'Jurnal Umum', icon: BookOpen },
          { key: 'ledger', label: 'Buku Besar', icon: Wallet },
          { key: 'balance_sheet', label: 'Neraca', icon: Scale },
          { key: 'cash_flow', label: 'Arus Kas', icon: TrendingUp },
          { key: 'ar_ap', label: 'Piutang & Hutang', icon: Users },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 border ${activeTab === t.key ? styles.tabActive : `border-transparent ${styles.textSub} hover:${styles.textTitle}`}`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'journal' && (
        <JournalTab styles={styles} isDark={isDark} journalEntries={journalEntries} chartOfAccounts={chartOfAccounts} currentUser={currentUser} onRefresh={fetchData} />
      )}
      {activeTab === 'ledger' && (
        <LedgerTab styles={styles} isDark={isDark} journalEntries={journalEntries} chartOfAccounts={chartOfAccounts} />
      )}
      {activeTab === 'balance_sheet' && (
        <BalanceSheetTab styles={styles} isDark={isDark} journalEntries={journalEntries} chartOfAccounts={chartOfAccounts} generatingPdf={generatingPdf} setGeneratingPdf={setGeneratingPdf} />
      )}
      {activeTab === 'cash_flow' && (
        <CashFlowTab styles={styles} isDark={isDark} journalEntries={journalEntries} financialAccounts={financialAccounts} />
      )}
      {activeTab === 'ar_ap' && (
        <ArApTab styles={styles} isDark={isDark} bookingsList={bookingsList} vendorBills={vendorBills} vendorsList={vendorsList} />
      )}
    </div>
  );
}

// =====================================================================
// TAB 1: JURNAL UMUM
// =====================================================================
function JournalTab({ styles, isDark, journalEntries, chartOfAccounts, currentUser, onRefresh }) {
  const [expandedIds, setExpandedIds] = useState([]);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterSource, setFilterSource] = useState('all');
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({
    date: todayISODate(), description: '', debitAccount: '', creditAccount: '', amount: ''
  });
  const [savingManual, setSavingManual] = useState(false);

  const isFinanceOrAdmin = ['finance', 'admin', 'super admin'].includes((currentUser?.role || '').toLowerCase()) || (currentUser?.role || '').toLowerCase().includes('super');

  const sources = Array.from(new Set(journalEntries.map(e => e.source).filter(Boolean)));

  const filtered = journalEntries.filter(e => {
    const dateStr = (e.date || '').slice(0, 10);
    if (filterStart && dateStr < filterStart) return false;
    if (filterEnd && dateStr > filterEnd) return false;
    if (filterSource !== 'all' && e.source !== filterSource) return false;
    return true;
  });

  const toggleExpand = (id) => setExpandedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    const amt = Number(manualForm.amount);
    if (!manualForm.debitAccount || !manualForm.creditAccount) {
      alert('Pilih akun Debit dan akun Kredit dulu.');
      return;
    }
    if (manualForm.debitAccount === manualForm.creditAccount) {
      alert('Akun Debit dan Kredit tidak boleh sama.');
      return;
    }
    if (!(amt > 0)) {
      alert('Isi nominal yang valid (lebih dari 0).');
      return;
    }
    setSavingManual(true);
    try {
      const debitAcc = chartOfAccounts.find(a => a.code === manualForm.debitAccount);
      const creditAcc = chartOfAccounts.find(a => a.code === manualForm.creditAccount);
      await postJournalEntry({
        date: new Date(manualForm.date).toISOString(),
        description: manualForm.description || 'Jurnal Koreksi Manual',
        source: 'manual', sourceDocId: `manual_${Date.now()}`, reference: '',
        lines: [
          { accountCode: debitAcc.code, accountName: debitAcc.name, debit: amt, credit: 0 },
          { accountCode: creditAcc.code, accountName: creditAcc.name, debit: 0, credit: amt },
        ],
        createdByUid: currentUser?.uid, createdByName: currentUser?.fullName || currentUser?.email,
        isManual: true
      });
      setShowManualModal(false);
      setManualForm({ date: todayISODate(), description: '', debitAccount: '', creditAccount: '', amount: '' });
      onRefresh();
    } catch (err) {
      alert('Gagal menyimpan jurnal manual: ' + err.message);
    }
    setSavingManual(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-wrap items-end gap-3`}>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Dari Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterStart} onChange={e => setFilterStart(e.target.value)} />
        </div>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Sampai Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />
        </div>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Sumber</label>
          <select className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="all">Semua Sumber</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        {isFinanceOrAdmin && (
          <button onClick={() => setShowManualModal(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
            + Jurnal Manual
          </button>
        )}
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={styles.tableHeaderBg}>
              <tr>
                <th className="text-left p-3 font-medium">Tanggal</th>
                <th className="text-left p-3 font-medium">Deskripsi</th>
                <th className="text-left p-3 font-medium">Sumber</th>
                <th className="text-right p-3 font-medium">Debit</th>
                <th className="text-right p-3 font-medium">Kredit</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className={`p-6 text-center ${styles.textSub}`}>Belum ada jurnal pada periode/filter ini.</td></tr>
              )}
              {filtered.map(entry => (
                <React.Fragment key={entry.id}>
                  <tr className={`cursor-pointer ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`} onClick={() => toggleExpand(entry.id)}>
                    <td className="p-3 whitespace-nowrap">{formatDateDDMMYYYY(entry.date)}</td>
                    <td className={`p-3 ${styles.textTitle}`}>{entry.description}{entry.isManual ? <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">Manual</span> : ''}</td>
                    <td className={`p-3 ${styles.textSub}`}>{entry.source}</td>
                    <td className="p-3 text-right font-medium">{formatRp(entry.totalDebit)}</td>
                    <td className="p-3 text-right font-medium">{formatRp(entry.totalCredit)}</td>
                    <td className="p-3 text-right">{expandedIds.includes(entry.id) ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}</td>
                  </tr>
                  {expandedIds.includes(entry.id) && (
                    <tr>
                      <td colSpan={6} className={`p-0 ${styles.innerBg}`}>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className={styles.textSub}>
                              <th className="text-left px-6 py-1.5 font-medium">Akun</th>
                              <th className="text-right px-6 py-1.5 font-medium">Debit</th>
                              <th className="text-right px-6 py-1.5 font-medium">Kredit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(entry.lines || []).map((line, i) => (
                              <tr key={i}>
                                <td className={`px-6 py-1 ${styles.textTitle}`}>{line.accountCode} - {line.accountName}{line.financialAccountName ? ` (${line.financialAccountName})` : ''}</td>
                                <td className="px-6 py-1 text-right">{line.debit > 0 ? formatRp(line.debit) : '-'}</td>
                                <td className="px-6 py-1 text-right">{line.credit > 0 ? formatRp(line.credit) : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showManualModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative`}>
            <button onClick={() => setShowManualModal(false)} className={`absolute right-4 top-4 ${styles.textSub}`}><X className="w-5 h-5" /></button>
            <h3 className={`text-lg font-bold ${styles.textTitle} mb-4`}>Jurnal Koreksi Manual</h3>
            <p className={`text-[10.5px] ${styles.textSub} mb-4`}>Buat entry jurnal 2 baris (1 Debit, 1 Kredit) buat koreksi yang nggak bisa lewat transaksi normal. Nominal debit & kredit otomatis sama (balance).</p>
            <form onSubmit={handleManualSubmit} className={`space-y-4 text-xs ${styles.textSub}`}>
              <div>
                <label className="block mb-1 font-medium">Tanggal</label>
                <input type="date" required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.date} onChange={e => setManualForm({ ...manualForm, date: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 font-medium">Akun Debit</label>
                <select required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.debitAccount} onChange={e => setManualForm({ ...manualForm, debitAccount: e.target.value })}>
                  <option value="">-- Pilih Akun --</option>
                  {chartOfAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Akun Kredit</label>
                <select required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.creditAccount} onChange={e => setManualForm({ ...manualForm, creditAccount: e.target.value })}>
                  <option value="">-- Pilih Akun --</option>
                  {chartOfAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-medium">Nominal (Rp)</label>
                <input type="number" required className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.amount} onChange={e => setManualForm({ ...manualForm, amount: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 font-medium">Keterangan</label>
                <input type="text" className={`w-full ${styles.inputBg} rounded-lg p-2.5 border`} value={manualForm.description} onChange={e => setManualForm({ ...manualForm, description: e.target.value })} placeholder="Koreksi saldo..." />
              </div>
              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button type="button" onClick={() => setShowManualModal(false)} className={`px-4 py-2 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'} rounded-lg`}>Batal</button>
                <button type="submit" disabled={savingManual} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-60">{savingManual ? 'Menyimpan...' : 'Simpan Jurnal'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB 2: BUKU BESAR
// =====================================================================
function LedgerTab({ styles, isDark, journalEntries, chartOfAccounts }) {
  const [accountCode, setAccountCode] = useState(chartOfAccounts[0]?.code || '');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');

  const account = chartOfAccounts.find(a => a.code === accountCode);

  // Semua baris jurnal yang nyentuh akun terpilih, diurutkan tanggal ASC,
  // dihitung saldo berjalan (running balance) sesuai normalBalance akun
  // (debit-normal: +debit -credit; credit-normal: +credit -debit).
  const rows = journalEntries
    .filter(e => (e.lines || []).some(l => l.accountCode === accountCode))
    .filter(e => {
      const d = (e.date || '').slice(0, 10);
      if (filterStart && d < filterStart) return false;
      if (filterEnd && d > filterEnd) return false;
      return true;
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .flatMap(e => (e.lines || []).filter(l => l.accountCode === accountCode).map(l => ({
      date: e.date, description: e.description, source: e.source,
      debit: l.debit || 0, credit: l.credit || 0, financialAccountName: l.financialAccountName
    })));

  let running = 0;
  const isDebitNormal = !account || account.normalBalance === 'debit';
  const rowsWithBalance = rows.map(r => {
    running += isDebitNormal ? (r.debit - r.credit) : (r.credit - r.debit);
    return { ...r, balance: running };
  });

  const handleExportPdf = () => {
    const docPdf = new jsPDF({ unit: 'mm', format: 'a4' });
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(12);
    docPdf.text(`BUKU BESAR - ${account?.code || ''} ${account?.name || ''}`, 14, 16);
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(8);
    docPdf.setTextColor(120);
    docPdf.text(`Dicetak: ${formatDateDDMMYYYY(new Date().toISOString())}`, 14, 21);
    docPdf.setTextColor(0);
    autoTable(docPdf, {
      startY: 26,
      margin: { left: 14, right: 14 },
      head: [['Tanggal', 'Deskripsi', 'Debit', 'Kredit', 'Saldo']],
      body: rowsWithBalance.map(r => [
        formatDateDDMMYYYY(r.date), r.description,
        r.debit > 0 ? r.debit.toLocaleString('id-ID') : '-',
        r.credit > 0 ? r.credit.toLocaleString('id-ID') : '-',
        r.balance.toLocaleString('id-ID')
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
    });
    docPdf.save(`Buku-Besar-${account?.code || ''}-${todayISODate()}.pdf`);
  };

  return (
    <div className="space-y-3">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-wrap items-end gap-3`}>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Pilih Akun</label>
          <select className={`${styles.inputBg} rounded-lg p-2 text-xs border min-w-[220px]`} value={accountCode} onChange={e => setAccountCode(e.target.value)}>
            {chartOfAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Dari Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterStart} onChange={e => setFilterStart(e.target.value)} />
        </div>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Sampai Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />
        </div>
        <div className="flex-1" />
        <button onClick={handleExportPdf} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> Export PDF
        </button>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={styles.tableHeaderBg}>
              <tr>
                <th className="text-left p-3 font-medium">Tanggal</th>
                <th className="text-left p-3 font-medium">Deskripsi</th>
                <th className="text-right p-3 font-medium">Debit</th>
                <th className="text-right p-3 font-medium">Kredit</th>
                <th className="text-right p-3 font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {rowsWithBalance.length === 0 && (
                <tr><td colSpan={5} className={`p-6 text-center ${styles.textSub}`}>Belum ada mutasi buat akun ini.</td></tr>
              )}
              {rowsWithBalance.map((r, i) => (
                <tr key={i}>
                  <td className="p-3 whitespace-nowrap">{formatDateDDMMYYYY(r.date)}</td>
                  <td className={`p-3 ${styles.textTitle}`}>{r.description}{r.financialAccountName ? ` — ${r.financialAccountName}` : ''}</td>
                  <td className="p-3 text-right">{r.debit > 0 ? formatRp(r.debit) : '-'}</td>
                  <td className="p-3 text-right">{r.credit > 0 ? formatRp(r.credit) : '-'}</td>
                  <td className={`p-3 text-right font-semibold ${styles.textTitle}`}>{formatRp(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            {rowsWithBalance.length > 0 && (
              <tfoot>
                <tr className={styles.tableHeaderBg}>
                  <td colSpan={4} className="p-3 text-right font-bold">Saldo Akhir</td>
                  <td className="p-3 text-right font-bold">{formatRp(rowsWithBalance[rowsWithBalance.length - 1].balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 3: NERACA (BALANCE SHEET)
// =====================================================================
function BalanceSheetTab({ styles, isDark, journalEntries, chartOfAccounts, generatingPdf, setGeneratingPdf }) {
  const [asOfDate, setAsOfDate] = useState(todayISODate());

  // Saldo tiap akun s/d tanggal terpilih — jumlahin semua baris jurnal yang
  // tanggalnya <= asOfDate, arah saldo sesuai normalBalance akun.
  const balanceByAccount = {};
  chartOfAccounts.forEach(a => { balanceByAccount[a.code] = 0; });
  journalEntries
    .filter(e => (e.date || '').slice(0, 10) <= asOfDate)
    .forEach(e => {
      (e.lines || []).forEach(l => {
        const acc = chartOfAccounts.find(a => a.code === l.accountCode);
        if (!acc) return;
        const delta = acc.normalBalance === 'debit' ? (l.debit - l.credit) : (l.credit - l.debit);
        balanceByAccount[l.accountCode] = (balanceByAccount[l.accountCode] || 0) + delta;
      });
    });

  const byType = {};
  ACCOUNT_TYPE_ORDER.forEach(t => { byType[t] = []; });
  chartOfAccounts.forEach(a => {
    const bal = balanceByAccount[a.code] || 0;
    if (Math.abs(bal) < 1 && !['Aset', 'Liabilitas', 'Ekuitas'].includes(a.type)) return;
    (byType[a.type] || (byType[a.type] = [])).push({ ...a, balance: bal });
  });

  const totalAset = (byType['Aset'] || []).reduce((acc, a) => acc + a.balance, 0);
  const totalLiabilitas = (byType['Liabilitas'] || []).reduce((acc, a) => acc + a.balance, 0);
  // Laba Ditahan berjalan (belum ditutup ke Modal) dihitung dari selisih
  // Pendapatan - Beban s/d tanggal ini, ditambahkan ke Modal/Laba Ditahan
  // biar Neraca tetap balance walau belum ada proses tutup buku periodik.
  const totalPendapatan = (byType['Pendapatan'] || []).reduce((acc, a) => acc + a.balance, 0);
  const totalBeban = (byType['Beban'] || []).reduce((acc, a) => acc + a.balance, 0);
  const labaBerjalan = totalPendapatan - totalBeban;
  const totalEkuitasBase = (byType['Ekuitas'] || []).reduce((acc, a) => acc + a.balance, 0);
  const totalEkuitas = totalEkuitasBase + labaBerjalan;

  const selisih = totalAset - (totalLiabilitas + totalEkuitas);

  const handleExportPdf = async () => {
    setGeneratingPdf(true);
    try {
      const docPdf = new jsPDF({ unit: 'mm', format: 'a4' });
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(12);
      docPdf.text('NERACA (BALANCE SHEET)', 105, 16, { align: 'center' });
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(9);
      docPdf.text(`Per Tanggal: ${formatDateDDMMYYYY(asOfDate)}`, 105, 22, { align: 'center' });

      const assetRows = (byType['Aset'] || []).map(a => [`${a.code} - ${a.name}`, a.balance.toLocaleString('id-ID')]);
      assetRows.push(['TOTAL ASET', totalAset.toLocaleString('id-ID')]);
      autoTable(docPdf, {
        startY: 28, margin: { left: 14, right: 110 },
        head: [['Aset', 'Rp']], body: assetRows,
        styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (d) => { if (d.row.index === assetRows.length - 1) d.cell.styles.fontStyle = 'bold'; }
      });

      const liabRows = (byType['Liabilitas'] || []).map(a => [`${a.code} - ${a.name}`, a.balance.toLocaleString('id-ID')]);
      liabRows.push(['TOTAL LIABILITAS', totalLiabilitas.toLocaleString('id-ID')]);
      const eqRows = [...(byType['Ekuitas'] || []).map(a => [`${a.code} - ${a.name}`, a.balance.toLocaleString('id-ID')]), ['Laba Berjalan', labaBerjalan.toLocaleString('id-ID')], ['TOTAL EKUITAS', totalEkuitas.toLocaleString('id-ID')]];
      autoTable(docPdf, {
        startY: 28, margin: { left: 110, right: 14 },
        head: [['Liabilitas & Ekuitas', 'Rp']], body: [...liabRows, ['', ''], ...eqRows],
        styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 1: { halign: 'right' } }
      });

      const finalY = Math.max(docPdf.lastAutoTable.finalY, 28) + 10;
      docPdf.setFontSize(9);
      docPdf.text(`Selisih Aset vs (Liabilitas + Ekuitas): Rp ${selisih.toLocaleString('id-ID')} ${Math.abs(selisih) < 2 ? '(Balance)' : '(TIDAK BALANCE — cek jurnal)'}`, 14, finalY);

      docPdf.save(`Neraca-WHISys-${asOfDate}.pdf`);
    } catch (err) {
      alert('Gagal membuat PDF Neraca: ' + err.message);
    }
    setGeneratingPdf(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${styles.cardBg} border rounded-xl p-4 flex flex-wrap items-end gap-3`}>
        <div>
          <label className={`block mb-1 text-[10.5px] font-medium ${styles.textSub}`}>Per Tanggal</label>
          <input type="date" className={`${styles.inputBg} rounded-lg p-2 text-xs border`} value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
        </div>
        <div className="flex-1" />
        <button onClick={handleExportPdf} disabled={generatingPdf} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-60">
          <Download className="w-3.5 h-3.5" /> {generatingPdf ? 'Membuat...' : 'Export PDF'}
        </button>
      </div>

      <div className={`rounded-xl p-3 border flex items-center gap-2 text-xs ${Math.abs(selisih) < 2 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-rose-500/10 border-rose-500/30 text-rose-500'}`}>
        <Scale className="w-4 h-4" />
        {Math.abs(selisih) < 2 ? 'Neraca Balance — Total Aset = Total Liabilitas + Ekuitas.' : `Neraca TIDAK Balance — selisih ${formatRp(selisih)}. Cek jurnal (kemungkinan ada input yang belum lewat mekanisme auto-jurnal).`}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Aset</h3>
          <table className="w-full text-xs">
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {(byType['Aset'] || []).map(a => (
                <tr key={a.code}>
                  <td className={`p-3 ${styles.textSub}`}>{a.code} - {a.name}</td>
                  <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(a.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={styles.tableHeaderBg}>
                <td className="p-3 font-bold">Total Aset</td>
                <td className="p-3 text-right font-bold">{formatRp(totalAset)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Liabilitas & Ekuitas</h3>
          <table className="w-full text-xs">
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {(byType['Liabilitas'] || []).map(a => (
                <tr key={a.code}>
                  <td className={`p-3 ${styles.textSub}`}>{a.code} - {a.name}</td>
                  <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(a.balance)}</td>
                </tr>
              ))}
              <tr>
                <td className={`p-3 font-semibold ${styles.textTitle}`}>Total Liabilitas</td>
                <td className={`p-3 text-right font-semibold ${styles.textTitle}`}>{formatRp(totalLiabilitas)}</td>
              </tr>
              {(byType['Ekuitas'] || []).map(a => (
                <tr key={a.code}>
                  <td className={`p-3 ${styles.textSub}`}>{a.code} - {a.name}</td>
                  <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(a.balance)}</td>
                </tr>
              ))}
              <tr>
                <td className={`p-3 ${styles.textSub}`}>Laba Berjalan (Pendapatan - Beban)</td>
                <td className={`p-3 text-right ${styles.textTitle}`}>{formatRp(labaBerjalan)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className={styles.tableHeaderBg}>
                <td className="p-3 font-bold">Total Ekuitas</td>
                <td className="p-3 text-right font-bold">{formatRp(totalEkuitas)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 4: ARUS KAS
// =====================================================================
function CashFlowTab({ styles, isDark, journalEntries, financialAccounts }) {
  // Semua baris jurnal yang nyentuh akun 1101 Kas & Bank, dikelompokkan per
  // bulan (kas masuk = debit, kas keluar = credit) & per source.
  const cashLines = [];
  journalEntries.forEach(e => {
    (e.lines || []).filter(l => l.accountCode === ACC.KAS_BANK).forEach(l => {
      cashLines.push({ period: getPeriodKey(e.date), source: e.source, debit: l.debit || 0, credit: l.credit || 0, date: e.date, description: e.description });
    });
  });

  const byPeriod = {};
  cashLines.forEach(l => {
    if (!byPeriod[l.period]) byPeriod[l.period] = { masuk: 0, keluar: 0, bySource: {} };
    byPeriod[l.period].masuk += l.debit;
    byPeriod[l.period].keluar += l.credit;
    if (!byPeriod[l.period].bySource[l.source]) byPeriod[l.period].bySource[l.source] = { masuk: 0, keluar: 0 };
    byPeriod[l.period].bySource[l.source].masuk += l.debit;
    byPeriod[l.period].bySource[l.source].keluar += l.credit;
  });

  const periods = Object.keys(byPeriod).sort().reverse();
  const [expandedPeriods, setExpandedPeriods] = useState([]);
  const togglePeriod = (p) => setExpandedPeriods(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const totalMasuk = cashLines.reduce((acc, l) => acc + l.debit, 0);
  const totalKeluar = cashLines.reduce((acc, l) => acc + l.credit, 0);
  const netKasJurnal = totalMasuk - totalKeluar;
  const totalSaldoAkunSaatIni = financialAccounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Kas Masuk</p>
          <p className="text-lg font-bold text-emerald-500">{formatRp(totalMasuk)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Kas Keluar</p>
          <p className="text-lg font-bold text-rose-500">{formatRp(totalKeluar)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Kas Bersih (dari Jurnal)</p>
          <p className={`text-lg font-bold ${styles.textTitle}`}>{formatRp(netKasJurnal)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Saldo Kas/Bank Saat Ini (Rekonsiliasi)</p>
          <p className={`text-lg font-bold ${Math.abs(netKasJurnal - totalSaldoAkunSaatIni) < 2 ? 'text-emerald-500' : 'text-amber-500'}`}>{formatRp(totalSaldoAkunSaatIni)}</p>
          {Math.abs(netKasJurnal - totalSaldoAkunSaatIni) >= 2 && (
            <p className="text-[10px] text-amber-500 mt-1">Beda dgn Kas Bersih Jurnal (mungkin ada saldo awal/mutasi manual di luar jurnal).</p>
          )}
        </div>
      </div>

      <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={styles.tableHeaderBg}>
              <tr>
                <th className="text-left p-3 font-medium">Periode</th>
                <th className="text-right p-3 font-medium">Kas Masuk</th>
                <th className="text-right p-3 font-medium">Kas Keluar</th>
                <th className="text-right p-3 font-medium">Kas Bersih</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className={`divide-y ${styles.tableRowBorder}`}>
              {periods.length === 0 && (
                <tr><td colSpan={5} className={`p-6 text-center ${styles.textSub}`}>Belum ada mutasi Kas & Bank.</td></tr>
              )}
              {periods.map(p => (
                <React.Fragment key={p}>
                  <tr className={`cursor-pointer ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`} onClick={() => togglePeriod(p)}>
                    <td className={`p-3 font-medium ${styles.textTitle}`}>{formatPeriodLabel(p)}</td>
                    <td className="p-3 text-right text-emerald-500">{formatRp(byPeriod[p].masuk)}</td>
                    <td className="p-3 text-right text-rose-500">{formatRp(byPeriod[p].keluar)}</td>
                    <td className={`p-3 text-right font-semibold ${styles.textTitle}`}>{formatRp(byPeriod[p].masuk - byPeriod[p].keluar)}</td>
                    <td className="p-3 text-right">{expandedPeriods.includes(p) ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}</td>
                  </tr>
                  {expandedPeriods.includes(p) && (
                    <tr>
                      <td colSpan={5} className={`p-0 ${styles.innerBg}`}>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className={styles.textSub}>
                              <th className="text-left px-6 py-1.5 font-medium">Sumber</th>
                              <th className="text-right px-6 py-1.5 font-medium">Masuk</th>
                              <th className="text-right px-6 py-1.5 font-medium">Keluar</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(byPeriod[p].bySource).map(([src, v]) => (
                              <tr key={src}>
                                <td className={`px-6 py-1 ${styles.textTitle}`}>{src}</td>
                                <td className="px-6 py-1 text-right">{v.masuk > 0 ? formatRp(v.masuk) : '-'}</td>
                                <td className="px-6 py-1 text-right">{v.keluar > 0 ? formatRp(v.keluar) : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 5: PIUTANG & HUTANG (AR/AP AGING)
// =====================================================================
function ArApTab({ styles, isDark, bookingsList, vendorBills, vendorsList }) {
  const today = todayISODate();

  // Piutang Jamaah — booking aktif dgn totalAmount > totalPaid, umur
  // dihitung dari tanggal booking dibuat (createdAt).
  const arList = bookingsList
    .filter(b => (b.status || 'active') === 'active')
    .map(b => ({ ...b, outstanding: Math.max(0, Number(b.totalAmount || 0) - Number(b.totalPaid || 0)) }))
    .filter(b => b.outstanding > 0)
    .map(b => ({ ...b, days: daysBetween(b.createdAt, today) }))
    .map(b => ({ ...b, bucket: bucketFor(b.days) }));

  // Hutang Vendor — dari vendor_bills status unpaid/partial, umur dari
  // dueDate (kalau ada) fallback billDate.
  const apList = vendorBills
    .filter(b => b.status !== 'paid')
    .map(b => ({ ...b, outstanding: Math.max(0, Number(b.amount || 0) - Number(b.amountPaid || 0)) }))
    .filter(b => b.outstanding > 0)
    .map(b => ({ ...b, days: daysBetween(b.dueDate || b.billDate, today) }))
    .map(b => ({ ...b, bucket: bucketFor(Math.max(0, b.days)) }));

  const arByBucket = {};
  AGING_BUCKETS.forEach(bk => { arByBucket[bk.key] = 0; });
  arList.forEach(b => { arByBucket[b.bucket.key] += b.outstanding; });
  const totalAr = arList.reduce((acc, b) => acc + b.outstanding, 0);

  const apByBucket = {};
  AGING_BUCKETS.forEach(bk => { apByBucket[bk.key] = 0; });
  apList.forEach(b => { apByBucket[b.bucket.key] += b.outstanding; });
  const totalAp = apList.reduce((acc, b) => acc + b.outstanding, 0);

  const vendorDepositPositive = vendorsList.filter(v => Number(v.depositBalance || 0) > 0);
  const totalVendorDeposit = vendorDepositPositive.reduce((acc, v) => acc + Number(v.depositBalance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Piutang Jamaah</p>
          <p className="text-lg font-bold text-amber-500">{formatRp(totalAr)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Total Hutang Vendor</p>
          <p className="text-lg font-bold text-rose-500">{formatRp(totalAp)}</p>
        </div>
        <div className={`${styles.cardBg} border rounded-xl p-4`}>
          <p className={`text-[10.5px] ${styles.textSub}`}>Piutang Deposit Vendor (Kredit ke Kita)</p>
          <p className="text-lg font-bold text-emerald-500">{formatRp(totalVendorDeposit)}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* ---- Piutang Jamaah ---- */}
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Piutang Jamaah (AR)</h3>
          <div className={`grid grid-cols-4 divide-x ${isDark ? 'divide-slate-800' : 'divide-slate-200'} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} text-[10.5px]`}>
            {AGING_BUCKETS.map(bk => (
              <div key={bk.key} className="p-2 text-center">
                <p className={styles.textSub}>{bk.label}</p>
                <p className={`font-semibold ${styles.textTitle}`}>{formatRp(arByBucket[bk.key])}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Booking</th>
                  <th className="text-left p-2.5 font-medium">Jamaah</th>
                  <th className="text-right p-2.5 font-medium">Sisa</th>
                  <th className="text-right p-2.5 font-medium">Umur</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {arList.length === 0 && (
                  <tr><td colSpan={4} className={`p-4 text-center ${styles.textSub}`}>Tidak ada piutang jamaah outstanding.</td></tr>
                )}
                {arList.sort((a, b) => b.outstanding - a.outstanding).map(b => (
                  <tr key={b.id}>
                    <td className={`p-2.5 ${styles.textSub}`}>{b.bookingCode}</td>
                    <td className={`p-2.5 ${styles.textTitle}`}>{b.jamaahName}</td>
                    <td className="p-2.5 text-right text-amber-500 font-medium">{formatRp(b.outstanding)}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{b.days}h ({b.bucket.label})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---- Hutang Vendor ---- */}
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Hutang Vendor (AP)</h3>
          <div className={`grid grid-cols-4 divide-x ${isDark ? 'divide-slate-800' : 'divide-slate-200'} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} text-[10.5px]`}>
            {AGING_BUCKETS.map(bk => (
              <div key={bk.key} className="p-2 text-center">
                <p className={styles.textSub}>{bk.label}</p>
                <p className={`font-semibold ${styles.textTitle}`}>{formatRp(apByBucket[bk.key])}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Vendor</th>
                  <th className="text-left p-2.5 font-medium">No. Tagihan</th>
                  <th className="text-right p-2.5 font-medium">Sisa</th>
                  <th className="text-right p-2.5 font-medium">Umur</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {apList.length === 0 && (
                  <tr><td colSpan={4} className={`p-4 text-center ${styles.textSub}`}>Tidak ada hutang vendor outstanding.</td></tr>
                )}
                {apList.sort((a, b) => b.outstanding - a.outstanding).map(b => (
                  <tr key={b.id}>
                    <td className={`p-2.5 ${styles.textTitle}`}>{b.vendorName}</td>
                    <td className={`p-2.5 ${styles.textSub}`}>{b.billNumber || '-'}</td>
                    <td className="p-2.5 text-right text-rose-500 font-medium">{formatRp(b.outstanding)}</td>
                    <td className={`p-2.5 text-right ${styles.textSub}`}>{Math.max(0, b.days)}h ({b.bucket.label})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {vendorDepositPositive.length > 0 && (
        <div className={`${styles.cardBg} border rounded-xl overflow-hidden`}>
          <h3 className={`p-3 font-bold text-sm ${styles.textTitle} border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>Piutang Deposit Vendor (Saldo Kredit ke Kita)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={styles.tableHeaderBg}>
                <tr>
                  <th className="text-left p-2.5 font-medium">Vendor</th>
                  <th className="text-right p-2.5 font-medium">Saldo Deposit</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${styles.tableRowBorder}`}>
                {vendorDepositPositive.map(v => (
                  <tr key={v.id}>
                    <td className={`p-2.5 ${styles.textTitle}`}>{v.name}</td>
                    <td className="p-2.5 text-right text-emerald-500 font-medium">{formatRp(v.depositBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
