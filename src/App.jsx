import React, { useState, useEffect, useMemo } from "react";
import { auth, db, googleProvider, SCHOOL_DOMAIN } from "./firebase.js";
import { signInAnonymously, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc } from "firebase/firestore";

const STAGES = [
  { id: "pembuka", label: "Foto Kondisi Awal", short: "Pembuka", mapel: "IPAS", color: "#8a6d3b", icon: "📷", lomba: false, hint: "Link foto kondisi awal area (ambil langsung dari kamera)" },
  { id: "kebersihan", label: "Pemetaan Kebersihan", short: "Kebersihan", mapel: "IPAS", color: "#8a6d3b", icon: "🧹", lomba: false, hint: "Link foto kondisi kebersihan kelas & lingkungan sekolah", extra: "kebersihan" },
  { id: "bahan", label: "Bukti Bahan Baku", short: "Bahan", mapel: "IPAS", color: "#8a6d3b", icon: "🌿", lomba: false, hint: "Link foto bahan di Google Drive" },
  { id: "poster", label: "Poster Edukasi", short: "Poster", mapel: "Informatika", color: "#3d6b52", icon: "🖼️", lomba: true, hint: "Link poster (Drive/Canva)" },
  { id: "kandungan", label: "Perhitungan Kandungan", short: "Kandungan", mapel: "IPAS", color: "#8a6d3b", icon: "🧪", lomba: false, hint: "Link data perhitungan (opsional)", extra: "kandungan" },
  { id: "spreadsheet", label: "Laporan Spreadsheet", short: "Spreadsheet", mapel: "Informatika", color: "#3d6b52", icon: "📊", lomba: false, hint: "Link Google Sheets" },
  { id: "laporanIndo", label: "Laporan Bahasa Indonesia", short: "Lap. Indonesia", mapel: "Bahasa Indonesia", color: "#7a4a3a", icon: "📝", lomba: true, hint: "Link dokumen laporan" },
  { id: "laporanInggris", label: "Laporan Bahasa Inggris", short: "Lap. Inggris", mapel: "Bahasa Inggris", color: "#4a5d7a", icon: "🌍", lomba: true, hint: "Link report document" },
  { id: "video", label: "Video Presentasi", short: "Video", mapel: "Informatika", color: "#3d6b52", icon: "🎬", lomba: true, hint: "Link video (YouTube/Drive)" },
  { id: "refleksi", label: "Refleksi Akhir", short: "Refleksi", mapel: "Refleksi", color: "#5c4a7a", icon: "💭", lomba: false, hint: "Link dokumentasi (opsional)", noLinkRequired: true },
];
const LOMBA_CATS = STAGES.filter((s) => s.lomba);
const MAPEL_OPTIONS = ["IPAS", "Informatika", "Bahasa Indonesia", "Bahasa Inggris", "Wali Kelas", "Koordinator"];
const SKOR_LABELS = { 1: "Perlu Bimbingan", 2: "Cukup", 3: "Baik", 4: "Sangat Baik" };

function stageOf(id) { return STAGES.find((s) => s.id === id); }
function groupKey(kelas, kelompok) { return `${kelas.trim()}__${kelompok.trim()}`.replace(/[/\\]/g, "-"); }
function isValidLink(url, stageId) {
  try {
    const u = new URL(url);
    if (stageId === "video") return /drive\.google\.com|classroom\.google\.com|youtube\.com|youtu\.be/.test(u.hostname);
    if (stageId === "poster") return /drive\.google\.com|docs\.google\.com|classroom\.google\.com|canva\.com/.test(u.hostname);
    return /drive\.google\.com|docs\.google\.com|classroom\.google\.com/.test(u.hostname);
  } catch { return false; }
}
function pct(group) {
  const done = STAGES.filter((s) => {
    const en = group.stages?.[s.id];
    if (!en) return false;
    return s.noLinkRequired ? !!en.catatan : !!en.link;
  }).length;
  return Math.round((done / STAGES.length) * 100);
}
function stagesForMapel(mapel) {
  if (mapel === "Koordinator") return STAGES;
  if (mapel === "Wali Kelas") return STAGES.filter((s) => ["pembuka", "kebersihan", "refleksi"].includes(s.id));
  return STAGES.filter((s) => s.mapel === mapel);
}
function lombaVisibleForMapel(mapel) { return ["Informatika", "Bahasa Indonesia", "Bahasa Inggris", "Koordinator"].includes(mapel); }
function catsForMapel(mapel) { return mapel === "Koordinator" ? LOMBA_CATS : LOMBA_CATS.filter((c) => c.mapel === mapel); }

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #ddd8c8", fontSize: 14, color: "#2b2b26", background: "#fdfcf8", outline: "none" };
function Field({ label, children }) { return (<label style={{ display: "block" }}><div style={{ fontSize: 12.5, fontWeight: 700, color: "#5a564c", marginBottom: 5 }}>{label}</div>{children}</label>); }
function EmptyState({ text }) { return (<div style={{ textAlign: "center", padding: "40px 20px", color: "#8a857a", fontSize: 13.5, background: "#fff", border: "1px dashed #ddd8c8", borderRadius: 14 }}>{text}</div>); }
function Sheet({ onClose, children, width = 520 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(43,43,38,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fdfcf8", borderRadius: "18px 18px 0 0", maxWidth: width, width: "100%", maxHeight: "86vh", overflowY: "auto", padding: 22, boxShadow: "0 -8px 30px rgba(0,0,0,0.2)" }}>{children}</div>
    </div>
  );
}

/* ================= APP ROOT ================= */
export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = belum tahu, null = belum login
  const [isAdmin, setIsAdmin] = useState(false);
  const [groups, setGroups] = useState({});
  const [scores, setScores] = useState({});
  const [reviews, setReviews] = useState({});
  const [role, setRole] = useState(null); // 'siswa' | 'guru' | 'admin'
  const [guruMapel, setGuruMapel] = useState(null);
  const [guruPin, setGuruPin] = useState(""); // disimpan di sesi guru, dikirim tiap tulis
  const [kelasSession, setKelasSession] = useState(null); // { kelas, pin }
  const [kelasPins, setKelasPins] = useState({});
  const [toast, setToast] = useState(null);
  const [pinRole, setPinRole] = useState(null);

  function showToast(msg, kind = "ok") { setToast({ msg, kind }); setTimeout(() => setToast(null), 2800); }

  // Auth listener
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setAuthUser(u);
    if (u && u.email) {
      const snap = await getDoc(doc(db, "admins", u.email));
      setIsAdmin(snap.exists());
    } else {
      setIsAdmin(false);
    }
  }), []);

  // Realtime listeners (aktif setelah ada sesi auth, anonymous ataupun google)
  useEffect(() => {
    if (!authUser) return;
    const unsubG = onSnapshot(collection(db, "groups"), (snap) => {
      const next = {}; snap.forEach((d) => (next[d.id] = d.data())); setGroups(next);
    });
    const unsubS = onSnapshot(collection(db, "scores"), (snap) => {
      const next = {}; snap.forEach((d) => (next[d.id] = d.data())); setScores(next);
    });
    const unsubR = onSnapshot(collection(db, "reviews"), (snap) => {
      const next = {}; snap.forEach((d) => (next[d.id] = d.data())); setReviews(next);
    });
    return () => { unsubG(); unsubS(); unsubR(); };
  }, [authUser]);

  useEffect(() => {
    if (!(role === "admin" && isAdmin)) return;
    const unsub = onSnapshot(collection(db, "kelasPins"), (snap) => {
      const next = {}; snap.forEach((d) => (next[d.id] = d.data())); setKelasPins(next);
    });
    return () => unsub();
  }, [role, isAdmin]);

  const groupList = useMemo(
    () => Object.values(groups).sort((a, b) => a.kelas.localeCompare(b.kelas) || a.kelompok.localeCompare(b.kelompok)),
    [groups]
  );

  async function ensureAnon() { if (!auth.currentUser) await signInAnonymously(auth); }

  async function saveStageEntry(gk, kelas, kelompok, stageId, entry, kelasPin) {
    await ensureAnon();
    const prev = groups[gk] || { kelas, kelompok, stages: {} };
    await setDoc(doc(db, "groups", gk), { ...prev, kelasPinAttempt: kelasPin || "admin", stages: { ...prev.stages, [stageId]: entry } });
  }
  async function saveKelasPin(kelas, pin) { await setDoc(doc(db, "kelasPins", kelas), { pin }); }
  async function deleteStageEntry(gk, stageId) {
    const prev = groups[gk]; if (!prev) return;
    const nextStages = { ...prev.stages }; delete nextStages[stageId];
    await setDoc(doc(db, "groups", gk), { ...prev, stages: nextStages });
  }
  async function deleteGroup(gk) { await deleteDoc(doc(db, "groups", gk)); }

  async function saveScore(gk, catId, field, value, pinAttempt) {
    const id = `${gk}__${catId}`;
    const prev = scores[id] || {};
    try {
      await setDoc(doc(db, "scores", id), { ...prev, [field]: value, gk, catId, pinAttempt: pinAttempt || "admin" });
    } catch (e) { showToast("Gagal simpan — cek PIN", "err"); }
  }
  async function saveReview(gk, stageId, mapel, payload, pinAttempt) {
    const id = `${gk}__${stageId}__${mapel}`;
    try {
      await setDoc(doc(db, "reviews", id), { ...payload, gk, stageId, mapel, pinAttempt: pinAttempt || "admin", waktu: new Date().toISOString() });
      return true;
    } catch (e) { showToast("Gagal simpan — cek PIN", "err"); return false; }
  }
  async function saveSettings(next) { await setDoc(doc(db, "config", "settings"), next, { merge: true }); }
  async function addAdmin(email) { await setDoc(doc(db, "admins", email), { addedAt: new Date().toISOString() }); }

  async function handleAdminLogin() {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast("Berhasil login");
    } catch (e) { showToast("Login dibatalkan atau gagal", "err"); }
  }
  async function handleLogout() {
    setRole(null); setGuruMapel(null); setGuruPin(""); setKelasSession(null);
    if (authUser && !authUser.isAnonymous) await signOut(auth);
  }

  if (authUser === undefined) return <EmptyState text="Menghubungkan ke server..." />;

  if (!role) {
    return (
      <Landing
        onWantSiswa={() => setPinRole("siswa")}
        onWantAdmin={() => setPinRole("admin")}
        onWantGuru={() => setPinRole("guru")}
        pinRole={pinRole}
        onClosePin={() => setPinRole(null)}
        onSiswaSuccess={async (kelas, pin) => { await ensureAnon(); setKelasSession({ kelas, pin }); setRole("siswa"); setPinRole(null); }}
        onGuruSuccess={async (mapel, pin) => { await ensureAnon(); setGuruMapel(mapel); setGuruPin(pin); setRole("guru"); setPinRole(null); }}
        onAdminLogin={handleAdminLogin}
        authUser={authUser}
        isAdmin={isAdmin}
        onEnterAdmin={() => { setRole("admin"); setPinRole(null); }}
      />
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f6f4ee", minHeight: "100%", color: "#2b2b26" }}>
      <style>{`* { box-sizing: border-box; } input, select, textarea, button { font-family: inherit; } ::placeholder { color: #a8a396; } .strata { height: 6px; display: flex; } .strata > div { flex: 1; }`}</style>
      <div className="strata"><div style={{ background: "#3d6b52" }} /><div style={{ background: "#8a6d3b" }} /><div style={{ background: "#c99a4a" }} /><div style={{ background: "#7a4a3a" }} /><div style={{ background: "#4a5d7a" }} /></div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 18px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11.5, letterSpacing: 1.5, textTransform: "uppercase", color: "#8a6d3b", fontWeight: 700 }}>Project Compost</div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>
              {role === "admin" && `Panel Admin ${authUser?.email ? "· " + authUser.email : ""}`}
              {role === "guru" && `Panel Guru · ${guruMapel}`}
              {role === "siswa" && `Panel Kelompok · ${kelasSession?.kelas || ""}`}
            </div>
          </div>
          <button onClick={handleLogout} style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid #ddd8c8", background: "#fff", fontSize: 12.5, fontWeight: 700, color: "#5a564c", cursor: "pointer" }}>Ganti Peran</button>
        </div>

        {role === "siswa" && <SiswaView groupList={groupList} kelasSession={kelasSession} saveStageEntry={saveStageEntry} showToast={showToast} scores={scores} />}
        {role === "guru" && <GuruView groupList={groupList} guruMapel={guruMapel} guruPin={guruPin} saveReview={saveReview} saveScore={saveScore} reviews={reviews} scores={scores} showToast={showToast} />}
        {role === "admin" && isAdmin && <AdminView groupList={groupList} saveStageEntry={saveStageEntry} deleteStageEntry={deleteStageEntry} deleteGroup={deleteGroup} saveScore={saveScore} saveSettings={saveSettings} addAdmin={addAdmin} saveKelasPin={saveKelasPin} kelasPins={kelasPins} scores={scores} authUser={authUser} showToast={showToast} />}
        {role === "admin" && !isAdmin && <EmptyState text="Akun ini belum terdaftar sebagai admin. Minta admin yang sudah ada menambahkan email kamu di tab Pengaturan." />}
      </div>

      {toast && (<div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: toast.kind === "err" ? "#b3453a" : "#2b2b26", color: "#fff", padding: "10px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, boxShadow: "0 6px 20px rgba(0,0,0,0.2)", zIndex: 50 }}>{toast.msg}</div>)}
    </div>
  );
}

/* ================= LANDING ================= */
function Landing({ onWantSiswa, onWantAdmin, onWantGuru, pinRole, onClosePin, onSiswaSuccess, onGuruSuccess, onAdminLogin, authUser, isAdmin, onEnterAdmin }) {
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f6f4ee", minHeight: "100%", color: "#2b2b26" }}>
      <style>{`* { box-sizing: border-box; } input, button { font-family: inherit; } .strata { height: 6px; display: flex; } .strata > div { flex: 1; }`}</style>
      <div className="strata"><div style={{ background: "#3d6b52" }} /><div style={{ background: "#8a6d3b" }} /><div style={{ background: "#c99a4a" }} /><div style={{ background: "#7a4a3a" }} /><div style={{ background: "#4a5d7a" }} /></div>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 18px 60px" }}>
        <div style={{ fontSize: 11.5, letterSpacing: 1.5, textTransform: "uppercase", color: "#8a6d3b", fontWeight: 700, marginBottom: 6 }}>SMK Negeri 2 Tasikmalaya · Kokurikuler Kelas X</div>
        <h1 style={{ fontSize: 26, margin: 0, fontWeight: 800 }}>Dari Sampah Menjadi Berkah</h1>
        <p style={{ margin: "6px 0 26px", fontSize: 13.5, color: "#6b665c", lineHeight: 1.5 }}>Pengolahan sampah organik menjadi kompos — projek lintas mata pelajaran.</p>

        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#5a564c", marginBottom: 8 }}>Masuk sebagai</div>
        <div style={{ display: "grid", gap: 10 }}>
          <RoleCard icon="🛠️" title="Admin" desc="Login pakai akun belajar.id — mengatur kelompok, data, dan papan lomba." onClick={onWantAdmin} color="#7a4a3a" />
          <RoleCard icon="🧑‍🏫" title="Guru" desc="PIN angka — meninjau dan menilai hasil kerja tanpa bisa mengubah data siswa." onClick={onWantGuru} color="#4a5d7a" />
          <RoleCard icon="👥" title="Kelompok Siswa" desc="PIN kelas (dibagikan wali kelas hari ini) — isi dan unggah bukti hasil kerja." onClick={onWantSiswa} color="#3d6b52" />
        </div>
      </div>

      {pinRole === "siswa" && <KelasPinModal onClose={onClosePin} onSuccess={onSiswaSuccess} />}
      {pinRole === "guru" && <GuruPinModal onClose={onClosePin} onSuccess={onGuruSuccess} />}
      {pinRole === "admin" && <AdminLoginModal onClose={onClosePin} onLogin={onAdminLogin} authUser={authUser} isAdmin={isAdmin} onEnter={onEnterAdmin} />}
    </div>
  );
}
function KelasPinModal({ onClose, onSuccess }) {
  const [kelas, setKelas] = useState("");
  const [pin, setPin] = useState("");
  return (
    <Sheet onClose={onClose} width={420}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Masuk sebagai Kelompok Siswa</div>
        <button onClick={onClose} style={{ border: "none", background: "#eae6da", width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Kelas"><input value={kelas} onChange={(e) => setKelas(e.target.value)} placeholder="cth. X TKJ 1" style={inputStyle} autoFocus /></Field>
        <Field label="PIN Kelas"><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Tanyakan ke wali kelas" style={inputStyle} /></Field>
        <p style={{ fontSize: 11.5, color: "#a8a396" }}>PIN ini sama untuk seluruh kelompok di kelas kamu hari ini, dibagikan wali kelas saat orientasi.</p>
        <button onClick={() => kelas.trim() && pin.trim() && onSuccess(kelas.trim(), pin.trim())} disabled={!kelas.trim() || !pin.trim()} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: kelas.trim() && pin.trim() ? "#3d6b52" : "#ccc8ba", color: "#fff", fontWeight: 700, fontSize: 14, cursor: kelas.trim() && pin.trim() ? "pointer" : "default" }}>Masuk</button>
      </div>
    </Sheet>
  );
}
function RoleCard({ icon, title, desc, onClick, color }) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", display: "flex", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 14, border: "1px solid #e4e0d3", background: "#fff", cursor: "pointer" }}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <div><div style={{ fontWeight: 800, fontSize: 15, color }}>{title}</div><div style={{ fontSize: 12.5, color: "#6b665c", marginTop: 2, lineHeight: 1.5 }}>{desc}</div></div>
    </button>
  );
}

function GuruPinModal({ onClose, onSuccess }) {
  const [mapel, setMapel] = useState(MAPEL_OPTIONS[0]);
  const [pin, setPin] = useState("");
  return (
    <Sheet onClose={onClose} width={420}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Masuk sebagai Guru</div>
        <button onClick={onClose} style={{ border: "none", background: "#eae6da", width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Mata pelajaran / peran"><select value={mapel} onChange={(e) => setMapel(e.target.value)} style={inputStyle}>{MAPEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
        <Field label="PIN angka"><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="cth. 123456" style={inputStyle} autoFocus /></Field>
        <p style={{ fontSize: 11.5, color: "#a8a396" }}>PIN divalidasi di server saat kamu pertama kali menyimpan penilaian — kalau salah, akan muncul pesan gagal simpan.</p>
        <button onClick={() => pin.trim() && onSuccess(mapel, pin.trim())} disabled={!pin.trim()} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: pin.trim() ? "#2b2b26" : "#ccc8ba", color: "#fff", fontWeight: 700, fontSize: 14, cursor: pin.trim() ? "pointer" : "default" }}>Masuk</button>
      </div>
    </Sheet>
  );
}

function AdminLoginModal({ onClose, onLogin, authUser, isAdmin, onEnter }) {
  const signedIn = authUser && !authUser.isAnonymous;
  return (
    <Sheet onClose={onClose} width={420}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Masuk sebagai Admin</div>
        <button onClick={onClose} style={{ border: "none", background: "#eae6da", width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✕</button>
      </div>
      {!signedIn && (
        <button onClick={onLogin} style={{ width: "100%", padding: "13px 16px", borderRadius: 10, border: "1px solid #ddd8c8", background: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Masuk dengan akun Google (belajar.id)</button>
      )}
      {signedIn && isAdmin && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#2b2b26" }}>Masuk sebagai <strong>{authUser.email}</strong> — terverifikasi admin ✓</div>
          <button onClick={onEnter} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "#2b2b26", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Lanjut ke Panel Admin</button>
        </div>
      )}
      {signedIn && !isAdmin && (
        <div style={{ fontSize: 13, color: "#b3453a", lineHeight: 1.6 }}>Akun <strong>{authUser.email}</strong> belum terdaftar sebagai admin. Minta admin yang sudah ada menambahkan email ini di tab Pengaturan, lalu coba lagi.</div>
      )}
    </Sheet>
  );
}

/* ================= SISWA ================= */
function SiswaView({ groupList, kelasSession, saveStageEntry, showToast, scores }) {
  const [tab, setTab] = useState("isi");
  const kelas = kelasSession.kelas;
  const [kelompok, setKelompok] = useState("");
  const [stageId, setStageId] = useState(STAGES[0].id);
  const [link, setLink] = useState(""); const [catatan, setCatatan] = useState("");
  const [beratTotal, setBeratTotal] = useState(""); const [rasioCN, setRasioCN] = useState(""); const [kadarAir, setKadarAir] = useState("");
  const [skorKelas, setSkorKelas] = useState(""); const [skorLingkungan, setSkorLingkungan] = useState("");
  const [walikelasHadir, setWalikelasHadir] = useState(false);
  const [linkErr, setLinkErr] = useState(""); const [saving, setSaving] = useState(false);
  const currentStage = stageOf(stageId);
  const ownGroups = useMemo(() => groupList.filter((g) => g.kelas === kelas), [groupList, kelas]);

  async function handleSubmit(e) {
    e.preventDefault();
    const linkRequired = !currentStage.noLinkRequired;
    if (!kelompok.trim()) return showToast("Isi nama kelompok dulu ya", "err");
    if (linkRequired && !link.trim()) return showToast("Link bukti wajib diisi untuk tahap ini", "err");
    if (currentStage.noLinkRequired && !catatan.trim()) return showToast("Tulis refleksinya di kolom catatan ya", "err");
    if (link.trim() && !isValidLink(link.trim(), stageId)) return setLinkErr("Format link tidak sesuai untuk tahap ini");
    if (!walikelasHadir) return showToast("Verifikasi kehadiran wali kelas wajib dicentang", "err");
    setLinkErr(""); setSaving(true);
    const gk = groupKey(kelas, kelompok);
    const entry = { link: link.trim(), catatan: catatan.trim(), walikelasHadir: true, waktu: new Date().toISOString() };
    if (stageId === "kandungan") Object.assign(entry, { beratTotal, rasioCN, kadarAir });
    if (stageId === "kebersihan") Object.assign(entry, { skorKelas, skorLingkungan });
    try { await saveStageEntry(gk, kelas, kelompok.trim(), stageId, entry, kelasSession.pin); showToast(`Tahap "${currentStage.label}" tersimpan ✓`); }
    catch { showToast("Gagal menyimpan — PIN kelas salah atau koneksi bermasalah", "err"); }
    setSaving(false); setLink(""); setCatatan(""); setBeratTotal(""); setRasioCN(""); setKadarAir(""); setSkorKelas(""); setSkorLingkungan(""); setWalikelasHadir(false);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 4, background: "#eae6da", padding: 4, borderRadius: 12, marginBottom: 18, overflowX: "auto" }}>
        {[{ id: "isi", label: "Isi Tugas" }, { id: "progress", label: "Progress Kelas" }, { id: "lomba", label: "Papan Lomba" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: "1 0 auto", padding: "10px 14px", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === t.id ? "#2b2b26" : "transparent", color: tab === t.id ? "#f6f4ee" : "#5a564c" }}>{t.label}</button>
        ))}
      </div>

      {tab === "isi" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {STAGES.map((s, i) => (
              <button key={s.id} onClick={() => setStageId(s.id)} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 999, border: `1.5px solid ${stageId === s.id ? s.color : "#ddd8c8"}`, background: stageId === s.id ? s.color : "#fff", color: stageId === s.id ? "#fff" : "#5a564c", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                <span>{s.icon}</span><span>{i + 1}. {s.short}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ background: "#fff", border: "1px solid #e4e0d3", borderRadius: 16, padding: 20, display: "grid", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 20 }}>{currentStage.icon}</span><div><div style={{ fontWeight: 800, fontSize: 15.5 }}>{currentStage.label}</div><div style={{ fontSize: 12, color: currentStage.color, fontWeight: 700 }}>{currentStage.mapel}</div></div></div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Kelas"><input value={kelas} disabled style={{ ...inputStyle, background: "#eae6da", color: "#8a857a" }} /></Field>
              <Field label="Nama Kelompok"><input value={kelompok} onChange={(e) => setKelompok(e.target.value)} placeholder="cth. Kelompok 3" style={inputStyle} /></Field>
            </div>

            {ownGroups.length > 0 && (
              <div style={{ fontSize: 12, color: "#8a857a" }}>Kelompok di kelasmu: {ownGroups.map((g) => (
                <button key={g.kelompok} type="button" onClick={() => setKelompok(g.kelompok)} style={{ border: "none", background: "none", color: "#3d6b52", fontWeight: 700, cursor: "pointer", marginRight: 8, fontSize: 12 }}>{g.kelompok}</button>
              ))}</div>
            )}

            {stageId === "kandungan" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <Field label="Berat Total (kg)"><input value={beratTotal} onChange={(e) => setBeratTotal(e.target.value)} style={inputStyle} /></Field>
                <Field label="Rasio C:N"><input value={rasioCN} onChange={(e) => setRasioCN(e.target.value)} style={inputStyle} /></Field>
                <Field label="Kadar Air (%)"><input value={kadarAir} onChange={(e) => setKadarAir(e.target.value)} style={inputStyle} /></Field>
              </div>
            )}
            {stageId === "kebersihan" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Skor Kebersihan Kelas (1-5)"><input value={skorKelas} onChange={(e) => setSkorKelas(e.target.value)} style={inputStyle} /></Field>
                <Field label="Skor Kebersihan Lingkungan (1-5)"><input value={skorLingkungan} onChange={(e) => setSkorLingkungan(e.target.value)} style={inputStyle} /></Field>
              </div>
            )}

            <Field label={currentStage.hint}>
              <input value={link} onChange={(e) => { setLink(e.target.value); if (linkErr) setLinkErr(""); }} placeholder="https://..." style={{ ...inputStyle, borderColor: linkErr ? "#b3453a" : "#ddd8c8" }} />
              {linkErr && <div style={{ fontSize: 12, color: "#b3453a", marginTop: 5 }}>{linkErr}</div>}
            </Field>
            <Field label={stageId === "refleksi" ? "Refleksi kelompok" : "Catatan (opsional)"}><textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={stageId === "refleksi" ? 4 : 2} style={{ ...inputStyle, resize: "vertical" }} /></Field>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#eae6da", padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={walikelasHadir} onChange={(e) => setWalikelasHadir(e.target.checked)} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.5 }}><strong>Wajib:</strong> tahap ini didampingi dan diverifikasi wali kelas.</span>
            </label>

            <button type="submit" disabled={saving} style={{ padding: "13px 16px", borderRadius: 10, border: "none", background: currentStage.color, color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>{saving ? "Menyimpan..." : `Simpan Tahap ${currentStage.short}`}</button>
          </form>
        </div>
      )}

      {tab === "progress" && <GroupBoard groupList={ownGroups} mode="view" />}
      {tab === "lomba" && <LombaTabs cats={LOMBA_CATS} groupList={ownGroups} scores={scores} editable={false} />}
    </div>
  );
}

/* ================= SHARED: GROUP BOARD ================= */
function GroupBoard({ groupList, mode, onBadgeClick, filterStages }) {
  if (groupList.length === 0) return <EmptyState text="Belum ada kelompok yang mengisi tugas." />;
  const stages = filterStages || STAGES;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {groupList.map((g) => {
        const gk = groupKey(g.kelas, g.kelompok); const p = pct(g);
        return (
          <div key={gk} style={{ background: "#fff", border: "1px solid #e4e0d3", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>{g.kelas} · {g.kelompok}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: p === 100 ? "#3d6b52" : "#8a6d3b" }}>{p}%</div>
            </div>
            <div style={{ height: 6, background: "#eae6da", borderRadius: 999, overflow: "hidden", marginBottom: 12 }}><div style={{ height: "100%", width: `${p}%`, background: p === 100 ? "#3d6b52" : "#c99a4a" }} /></div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {stages.map((s) => {
                const en = g.stages?.[s.id];
                const complete = en && (s.noLinkRequired ? !!en.catatan : !!en.link);
                const clickable = mode === "admin" || (mode === "guru" && complete);
                return (
                  <button key={s.id} type="button"
                    onClick={() => { if (clickable && onBadgeClick) onBadgeClick(g, s); else if (mode === "view" && en?.link) window.open(en.link, "_blank"); }}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, padding: "5px 9px", borderRadius: 999, border: `1px solid ${complete ? s.color + "40" : "#e4e0d3"}`, background: complete ? s.color + "1a" : "#f2f0e8", color: complete ? s.color : "#a8a396", fontWeight: 700, cursor: "pointer" }}>
                    <span>{s.icon}</span><span>{s.short}</span><span>{complete ? (en.walikelasHadir ? "✓👤" : "✓") : "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================= SHARED: LOMBA ================= */
function LombaTabs({ cats, groupList, scores, editable, onScore }) {
  const [cat, setCat] = useState(cats[0]?.id);
  useEffect(() => { if (cats.length && !cats.find((c) => c.id === cat)) setCat(cats[0].id); }, [cats]);
  if (cats.length === 0) return <EmptyState text="Tidak ada kategori lomba untuk peran ini." />;
  if (groupList.length === 0) return <EmptyState text="Belum ada kelompok yang bisa dinilai." />;
  const activeCat = stageOf(cat);
  const rows = groupList.map((g) => {
    const gk = groupKey(g.kelas, g.kelompok); const id = `${gk}__${cat}`;
    const submission = g.stages?.[cat];
    const score = scores?.[id]?.score; const note = scores?.[id]?.note || "";
    return { gk, g, submission, score: score === undefined ? "" : score, note };
  }).sort((a, b) => (Number(b.score) || -1) - (Number(a.score) || -1));
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 16 }}>
        {cats.map((c) => (<button key={c.id} onClick={() => setCat(c.id)} style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 999, border: `1.5px solid ${cat === c.id ? c.color : "#ddd8c8"}`, background: cat === c.id ? c.color : "#fff", color: cat === c.id ? "#fff" : "#5a564c", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{c.icon} {c.short}</button>))}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r, idx) => (
          <div key={r.gk} style={{ background: "#fff", border: "1px solid #e4e0d3", borderRadius: 14, padding: 14, borderLeft: `4px solid ${activeCat.color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14.5 }}>{r.score !== "" && idx < 3 ? medals[idx] + " " : ""}{r.g.kelas} · {r.g.kelompok}</div>
                {r.submission ? (<a href={r.submission.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: "#3d6b52", fontWeight: 700, textDecoration: "none" }}>Lihat karya →</a>) : (<span style={{ fontSize: 12.5, color: "#b3453a" }}>Belum submit</span>)}
              </div>
              {editable ? (<input type="number" min={0} max={100} value={r.score} onChange={(e) => onScore(r.gk, cat, "score", e.target.value)} style={{ width: 66, padding: "7px 8px", borderRadius: 8, border: "1px solid #ddd8c8", fontSize: 13, textAlign: "center" }} />) : (<div style={{ fontSize: 13, fontWeight: 800 }}>{r.score !== "" ? r.score : "—"}</div>)}
            </div>
            {editable ? (<input value={r.note} onChange={(e) => onScore(r.gk, cat, "note", e.target.value)} placeholder="Catatan juri" style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid #eae6da", fontSize: 12.5, background: "#fdfcf8" }} />) : (r.note && <div style={{ fontSize: 12.5, color: "#6b665c" }}>{r.note}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= GURU ================= */
function GuruView({ groupList, guruMapel, guruPin, saveReview, saveScore, reviews, scores, showToast }) {
  const [tab, setTab] = useState("tinjau");
  const [reviewTarget, setReviewTarget] = useState(null);
  const stages = stagesForMapel(guruMapel);
  const showLomba = lombaVisibleForMapel(guruMapel);
  const cats = catsForMapel(guruMapel);

  const reminders = useMemo(() => {
    return groupList.map((g) => {
      const missing = stages.filter((s) => {
        const en = g.stages?.[s.id];
        return !(en && (s.noLinkRequired ? !!en.catatan : !!en.link));
      });
      return { g, missing };
    }).filter((r) => r.missing.length > 0);
  }, [groupList, stages]);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, background: "#eae6da", padding: 4, borderRadius: 12, marginBottom: 18, overflowX: "auto" }}>
        <button onClick={() => setTab("tinjau")} style={{ flex: "1 0 auto", padding: "10px 14px", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === "tinjau" ? "#2b2b26" : "transparent", color: tab === "tinjau" ? "#f6f4ee" : "#5a564c" }}>Tinjau Submission</button>
        {showLomba && <button onClick={() => setTab("lomba")} style={{ flex: "1 0 auto", padding: "10px 14px", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === "lomba" ? "#2b2b26" : "transparent", color: tab === "lomba" ? "#f6f4ee" : "#5a564c" }}>Papan Lomba</button>}
      </div>
      <div style={{ fontSize: 12, color: "#8a857a", marginBottom: 12, background: "#fff", border: "1px dashed #ddd8c8", borderRadius: 10, padding: "8px 12px" }}>Anda meninjau sebagai <strong>{guruMapel}</strong>. Data siswa bersifat baca-saja.</div>

      {tab === "tinjau" && reminders.length > 0 && (
        <div style={{ background: "#fdf2ea", border: "1px solid #e8c9a0", borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: "#8a6d3b", marginBottom: 8 }}>⏰ Perlu ditindaklanjuti ({reminders.length} kelompok)</div>
          <div style={{ display: "grid", gap: 6 }}>
            {reminders.map(({ g, missing }) => (
              <div key={groupKey(g.kelas, g.kelompok)} style={{ fontSize: 12.5, color: "#5a564c" }}>
                <strong>{g.kelas} · {g.kelompok}</strong> — belum: {missing.map((s) => s.short).join(", ")}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "tinjau" && <GroupBoard groupList={groupList} mode="guru" filterStages={stages} onBadgeClick={(g, s) => setReviewTarget({ g, s })} />}
      {tab === "lomba" && showLomba && <LombaTabs cats={cats} groupList={groupList} scores={scores} editable={true} onScore={(gk, catId, field, value) => saveScore(gk, catId, field, value, guruPin)} />}

      {reviewTarget && (
        <ReviewSheet group={reviewTarget.g} stage={reviewTarget.s} guruMapel={guruMapel}
          existing={reviews?.[`${groupKey(reviewTarget.g.kelas, reviewTarget.g.kelompok)}__${reviewTarget.s.id}__${guruMapel}`]}
          onClose={() => setReviewTarget(null)}
          onSave={async (payload) => {
            const ok = await saveReview(groupKey(reviewTarget.g.kelas, reviewTarget.g.kelompok), reviewTarget.s.id, guruMapel, payload, guruPin);
            if (ok) { showToast("Penilaian tersimpan ✓"); setReviewTarget(null); }
          }} />
      )}
    </div>
  );
}

function ReviewSheet({ group, stage, guruMapel, existing, onClose, onSave }) {
  const en = group.stages?.[stage.id];
  const [skor, setSkor] = useState(existing?.skor || 0);
  const [catatan, setCatatan] = useState(existing?.catatan || "");
  const [verified, setVerified] = useState(existing?.verified || false);
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, fontWeight: 700, color: "#a8a396" }}>{group.kelas} · {group.kelompok}</div><div style={{ fontWeight: 800, fontSize: 17 }}>{stage.icon} {stage.label}</div></div>
        <button onClick={onClose} style={{ border: "none", background: "#eae6da", width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ background: "#f2f0e8", borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, display: "grid", gap: 6 }}>
        {en?.link && (<div>🔗 <a href={en.link} target="_blank" rel="noopener noreferrer" style={{ color: "#3d6b52", fontWeight: 700 }}>Buka bukti kelompok →</a></div>)}
        {en?.catatan && (<div><strong>Catatan kelompok:</strong> {en.catatan}</div>)}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#5a564c", marginBottom: 8 }}>Skor ({guruMapel})</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 14 }}>
        {[1, 2, 3, 4].map((n) => (<button key={n} type="button" onClick={() => setSkor(n)} style={{ padding: "10px 6px", borderRadius: 10, border: `1.5px solid ${skor === n ? stage.color : "#ddd8c8"}`, background: skor === n ? stage.color : "#fff", color: skor === n ? "#fff" : "#5a564c", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>{n}<div style={{ fontSize: 9.5, fontWeight: 600, marginTop: 2 }}>{SKOR_LABELS[n]}</div></button>))}
      </div>
      <Field label="Catatan guru"><textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></Field>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer" }}><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /><span style={{ fontSize: 12.5 }}>Saya konfirmasi bukti ini valid</span></label>
      <button onClick={() => onSave({ skor, catatan, verified })} disabled={!skor} style={{ marginTop: 16, width: "100%", padding: "13px 16px", borderRadius: 10, border: "none", background: skor ? stage.color : "#ccc8ba", color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: skor ? "pointer" : "default" }}>Simpan Penilaian</button>
    </Sheet>
  );
}

/* ================= ADMIN ================= */
function AdminView({ groupList, saveStageEntry, deleteStageEntry, deleteGroup, saveScore, saveSettings, addAdmin, saveKelasPin, kelasPins, scores, authUser, showToast }) {
  const [tab, setTab] = useState("kelompok");
  const [editTarget, setEditTarget] = useState(null);
  const [guruPin, setGuruPin] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newKelas, setNewKelas] = useState("");
  const [newKelasPin, setNewKelasPin] = useState("");

  function handleDeleteGroup(gk, label) { if (window.confirm(`Hapus kelompok "${label}"?`)) { deleteGroup(gk); showToast("Kelompok dihapus"); } }

  return (
    <div>
      <div style={{ display: "flex", gap: 4, background: "#eae6da", padding: 4, borderRadius: 12, marginBottom: 18, overflowX: "auto" }}>
        {[{ id: "kelompok", label: "Kelola Kelompok" }, { id: "data", label: "Semua Data" }, { id: "lomba", label: "Papan Lomba" }, { id: "pengaturan", label: "Pengaturan" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: "1 0 auto", padding: "10px 14px", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === t.id ? "#2b2b26" : "transparent", color: tab === t.id ? "#f6f4ee" : "#5a564c" }}>{t.label}</button>
        ))}
      </div>

      {tab === "kelompok" && (groupList.length === 0 ? <EmptyState text="Belum ada kelompok terdaftar." /> : (
        <div style={{ display: "grid", gap: 10 }}>
          {groupList.map((g) => { const gk = groupKey(g.kelas, g.kelompok); return (
            <div key={gk} style={{ background: "#fff", border: "1px solid #e4e0d3", borderRadius: 14, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontWeight: 800, fontSize: 14.5 }}>{g.kelas} · {g.kelompok}</div><div style={{ fontSize: 12, color: "#8a857a" }}>{pct(g)}% tahap terisi</div></div>
              <button onClick={() => handleDeleteGroup(gk, `${g.kelas} · ${g.kelompok}`)} style={{ border: "none", background: "#f7e6e3", color: "#b3453a", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer" }}>Hapus</button>
            </div>
          ); })}
        </div>
      ))}

      {tab === "data" && <GroupBoard groupList={groupList} mode="admin" onBadgeClick={(g, s) => setEditTarget({ g, s })} />}
      {tab === "lomba" && <LombaTabs cats={LOMBA_CATS} groupList={groupList} scores={scores} editable={true} onScore={(gk, catId, field, value) => saveScore(gk, catId, field, value, "admin")} />}

      {tab === "pengaturan" && (
        <div style={{ background: "#fff", border: "1px solid #e4e0d3", borderRadius: 16, padding: 20, display: "grid", gap: 20 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>PIN Kelas (untuk siswa)</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Nama Kelas"><input value={newKelas} onChange={(e) => setNewKelas(e.target.value)} placeholder="cth. X TKJ 1" style={inputStyle} /></Field>
                <Field label="PIN angka"><input value={newKelasPin} onChange={(e) => setNewKelasPin(e.target.value)} placeholder="cth. 111111" style={inputStyle} /></Field>
              </div>
              <button onClick={() => { if (newKelas.trim() && newKelasPin.trim()) { saveKelasPin(newKelas.trim(), newKelasPin.trim()); showToast(`PIN untuk ${newKelas.trim()} disimpan ✓`); setNewKelas(""); setNewKelasPin(""); } }} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "#3d6b52", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Simpan PIN Kelas</button>
              {Object.keys(kelasPins || {}).length > 0 && (
                <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                  {Object.entries(kelasPins).sort((a, b) => a[0].localeCompare(b[0])).map(([kelas, v]) => (
                    <div key={kelas} style={{ fontSize: 12.5, color: "#5a564c", display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#f2f0e8", borderRadius: 8 }}>
                      <span>{kelas}</span><span style={{ fontWeight: 700 }}>{v.pin}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ borderTop: "1px solid #eae6da", paddingTop: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>PIN Guru</div>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="PIN angka baru (berlaku untuk semua mapel guru)"><input value={guruPin} onChange={(e) => setGuruPin(e.target.value)} placeholder="cth. 654321" style={inputStyle} /></Field>
              <button onClick={() => { if (guruPin.trim()) { saveSettings({ guruPin: guruPin.trim() }); showToast("PIN guru diperbarui ✓"); setGuruPin(""); } }} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "#2b2b26", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Simpan PIN Guru</button>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #eae6da", paddingTop: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Tambah Admin</div>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="Email belajar.id admin baru"><input value={newAdminEmail} onChange={(e) => setNewAdminEmail(e.target.value)} placeholder="nama@sekolah.belajar.id" style={inputStyle} /></Field>
              <button onClick={() => { if (newAdminEmail.trim()) { addAdmin(newAdminEmail.trim()); showToast("Admin ditambahkan ✓"); setNewAdminEmail(""); } }} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "#2b2b26", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Tambah Admin</button>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "#a8a396" }}>Login sebagai: {authUser?.email}</div>
        </div>
      )}

      {editTarget && (
        <AdminEditSheet group={editTarget.g} stage={editTarget.s} existing={editTarget.g.stages?.[editTarget.s.id]}
          onClose={() => setEditTarget(null)}
          onSave={async (entry) => { await saveStageEntry(groupKey(editTarget.g.kelas, editTarget.g.kelompok), editTarget.g.kelas, editTarget.g.kelompok, editTarget.s.id, entry); showToast("Data tersimpan ✓"); setEditTarget(null); }}
          onDelete={async () => { await deleteStageEntry(groupKey(editTarget.g.kelas, editTarget.g.kelompok), editTarget.s.id); showToast("Data tahap dihapus"); setEditTarget(null); }} />
      )}
    </div>
  );
}

function AdminEditSheet({ group, stage, existing, onClose, onSave, onDelete }) {
  const [link, setLink] = useState(existing?.link || ""); const [catatan, setCatatan] = useState(existing?.catatan || "");
  const [beratTotal, setBeratTotal] = useState(existing?.beratTotal || ""); const [rasioCN, setRasioCN] = useState(existing?.rasioCN || ""); const [kadarAir, setKadarAir] = useState(existing?.kadarAir || "");
  const [skorKelas, setSkorKelas] = useState(existing?.skorKelas || ""); const [skorLingkungan, setSkorLingkungan] = useState(existing?.skorLingkungan || "");
  const [walikelasHadir, setWalikelasHadir] = useState(existing?.walikelasHadir || false);
  function submit() {
    const entry = { link: link.trim(), catatan: catatan.trim(), walikelasHadir, waktu: new Date().toISOString() };
    if (stage.id === "kandungan") Object.assign(entry, { beratTotal, rasioCN, kadarAir });
    if (stage.id === "kebersihan") Object.assign(entry, { skorKelas, skorLingkungan });
    onSave(entry);
  }
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div><div style={{ fontSize: 11, fontWeight: 700, color: "#a8a396" }}>{group.kelas} · {group.kelompok}</div><div style={{ fontWeight: 800, fontSize: 17 }}>{stage.icon} {stage.label}</div></div>
        <button onClick={onClose} style={{ border: "none", background: "#eae6da", width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {stage.id === "kandungan" && (<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Berat Total"><input value={beratTotal} onChange={(e) => setBeratTotal(e.target.value)} style={inputStyle} /></Field>
          <Field label="Rasio C:N"><input value={rasioCN} onChange={(e) => setRasioCN(e.target.value)} style={inputStyle} /></Field>
          <Field label="Kadar Air"><input value={kadarAir} onChange={(e) => setKadarAir(e.target.value)} style={inputStyle} /></Field>
        </div>)}
        {stage.id === "kebersihan" && (<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Skor Kelas"><input value={skorKelas} onChange={(e) => setSkorKelas(e.target.value)} style={inputStyle} /></Field>
          <Field label="Skor Lingkungan"><input value={skorLingkungan} onChange={(e) => setSkorLingkungan(e.target.value)} style={inputStyle} /></Field>
        </div>)}
        <Field label="Link bukti"><input value={link} onChange={(e) => setLink(e.target.value)} style={inputStyle} /></Field>
        <Field label="Catatan"><textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={walikelasHadir} onChange={(e) => setWalikelasHadir(e.target.checked)} /><span style={{ fontSize: 12.5 }}>Diverifikasi wali kelas</span></label>
        <div style={{ display: "flex", gap: 8 }}>
          {existing && (<button onClick={onDelete} style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid #b3453a", background: "#fff", color: "#b3453a", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Hapus</button>)}
          <button onClick={submit} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: stage.color, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Simpan</button>
        </div>
      </div>
    </Sheet>
  );
}
