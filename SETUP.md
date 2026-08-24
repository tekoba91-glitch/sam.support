# Setup Project Compost — Firebase

Panduan ini mengasumsikan kamu belum pernah pakai Firebase sama sekali.
Semua langkah gratis (Spark plan), tidak butuh kartu kredit.

## 1. Buat project Firebase

1. Buka https://console.firebase.google.com
2. Login pakai akun Google kamu (boleh akun pribadi atau belajar.id — ini
   hanya untuk *memiliki* project, bukan untuk login siswa/guru).
3. Klik **Add project** → beri nama (mis. `project-compost-smkn2`) → lanjut
   sampai selesai. Analytics boleh dimatikan, tidak perlu.

## 2. Aktifkan Authentication

1. Di sidebar kiri, buka **Build → Authentication → Get started**.
2. Tab **Sign-in method** → aktifkan dua provider:
   - **Anonymous** → Enable → Save.
   - **Google** → Enable → isi *Project support email* → Save.

## 3. Buat Firestore Database

1. Sidebar **Build → Firestore Database → Create database**.
2. Pilih lokasi server (pilih yang paling dekat, mis. `asia-southeast2`
   Jakarta kalau tersedia).
3. Mode: pilih **Start in production mode** (bukan test mode) — karena kita
   sudah punya file `firestore.rules` sendiri.

## 4. Install tools & login

Di komputer kamu (butuh Node.js sudah terpasang):

```bash
npm install -g firebase-tools
firebase login
```

Ikuti proses login browser yang muncul.

## 5. Hubungkan folder project ini ke project Firebase kamu

Buka file `.firebaserc`, ganti `GANTI_DENGAN_PROJECT_ID_FIREBASE_KAMU`
dengan **Project ID** (bukan nama project) — bisa dilihat di Firebase
Console → ⚙️ Project settings → General → Project ID.

## 6. Isi konfigurasi di `src/firebase.js`

Firebase Console → ⚙️ Project settings → General → scroll ke **Your apps**
→ klik ikon web `</>` → daftarkan app (nama bebas) → Firebase akan
menampilkan blok `firebaseConfig`. Salin nilainya ke `src/firebase.js`,
menggantikan semua tulisan `GANTI_INI`.

Juga ganti `SCHOOL_DOMAIN` dengan domain belajar.id sekolah kamu, contoh:
`"smkn2tasikmalaya.belajar.id"`.

## 7. Deploy security rules

```bash
firebase deploy --only firestore:rules
```

## 8. Bootstrap admin pertama (WAJIB, manual sekali saja)

Karena hanya admin yang boleh menambah admin lain, admin pertama harus
dibuat manual lewat Firebase Console:

1. Firestore Database → **Start collection** → Collection ID: `admins`
2. Document ID: **isi persis email belajar.id admin pertama**, misalnya
   `koordinator@smkn2tasikmalaya.belajar.id`
3. Tambahkan satu field apa saja, misal `role` (string) = `admin` → Save.

## 9. Bootstrap PIN guru pertama

1. Firestore Database → **Start collection** → Collection ID: `config`
2. Document ID: `settings`
3. Field: `guruPin` (string) = misal `123456` → Save.

(Admin bisa mengganti PIN ini kapan saja lewat tab Pengaturan di aplikasi,
tanpa perlu buka Firebase Console lagi.)

## 10. Install dependency & jalankan lokal (opsional, untuk cek dulu)

```bash
npm install
npm run dev
```

Buka `http://localhost:5173` — coba masuk sebagai ketiga peran.

## 11. Build & deploy hosting

```bash
firebase init hosting
```
Saat ditanya:
- "What do you want to use as your public directory?" → ketik `dist`
- "Configure as a single-page app?" → **Yes**
- "Set up automatic builds with GitHub?" → No (boleh No dulu)
- Kalau ditanya overwrite `dist/index.html` → **No**

Lalu:

```bash
npm run build
firebase deploy --only hosting
```

Firebase akan menampilkan URL akhir, contoh:
`https://project-compost-smkn2.web.app` — inilah link yang dibagikan ke
siswa, guru, dan admin.

## Catatan keamanan (baca ini)

- **Siswa** login otomatis secara anonim (tanpa layar login). Mereka bisa
  menulis/mengubah data kelompok manapun dalam satu Firestore ini —
  ini disengaja demi kemudahan, bukan bug. Kalau nanti butuh mencegah satu
  kelompok mengubah punya kelompok lain, perlu login per-siswa yang lebih
  kuat (bisa ditingkatkan belakangan).
- **Guru** PIN divalidasi di server (Firestore rules), bukan cuma di
  tampilan — PIN yang salah akan gagal tersimpan, bukan cuma diblokir di
  layar.
- **Admin** wajib login Google asli dan emailnya harus terdaftar di
  koleksi `admins`. Mengetik `hd` domain di Google Sign-In hanya
  mempercantik tampilan pilihan akun — keamanan sesungguhnya ada di
  pengecekan `admins` collection.
- Kalau PIN guru bocor, dampaknya terbatas: guru cuma bisa menilai/skor,
  tidak bisa menghapus atau mengubah data asli siswa.
