# TRW Route to Preference — arsitektur 1.0

Frontend vanilla JavaScript + Vite, idb (IndexedDB), Chart.js, QRCode. Seluruh dependency dibundel, tanpa CDN saat offline. GitHub Pages hanya melayani file statis. Backend satu Google Apps Script Web App V8, default project, SpreadsheetApp/DriveApp; tidak perlu Console, advanced services, Firebase, server GitHub, atau billing.

## Batas kepercayaan

Browser mengirim POST text/plain JSON melalui fetch redirect:follow credentials:omit. GAS memeriksa action whitelist, token 12 jam, pengguna masih aktif dan role aktual di Users setiap permintaan. Cache session hanya akselerator, Sheet adalah otoritas. PIN salted SHA-256 dengan pepper di Script Properties; PIN tidak pernah dikembalikan. Spreadsheet operasional dan folder bukti privat, hanya owner/supervisor tepercaya menerima akses file mentah. Sheet protection tidak memberi kerahasiaan antar editor: jangan share database kepada SPG/FM/client. Semua akses mereka lewat API yang diproyeksikan sesuai role. LeadContacts adalah tabel PII terpisah.

## Transaksi dan offline

Antrean IndexedDB memiliki requestId stabil, pemilik user, urutan dependency (visit.start → photo.upload → visit.submit → survey/lead), payload, attempts, status. Web Locks mencegah dua tab sync; backend tetap idempoten bila platform tidak mendukung Web Locks. Tidak ada auto retry error validasi, privacy, permission, atau konflik; antrean ditandai perlu perbaikan. Token kedaluwarsa menghentikan sync, login kembali dengan user yang sama mempertahankan antrean. Akun berbeda tidak dapat mengirim antrean orang lain. Foto tetap di IDB hingga ada hasil sukses; browser tidak dapat menjamin data setelah user clear storage/uninstall/eviction.

Setiap write melalui ScriptLock, reads/writes range dibatch. Requests menyimpan actor+requestId, hash payload, hasil, dan file journal privat. Sebelum range ditulis, semua perubahan dipersist ke journal Drive. Eksekusi berikutnya memutar ulang journal prepared dengan ID row deterministik. Voucher/points/redeem tidak berganda walaupun eksekusi terputus di tengah commit. Spreadsheet bukan database ACID; read singkat bisa melihat commit parsial. Jangan edit tabel operasional langsung saat aplikasi aktif. Side effect kirim WhatsApp dipisahkan sebagai durable outbox; status sending yang tidak pasti tidak di-retry otomatis (hindari double-send).

## Opsi dan target

Opsi SPG dan FM dapat aktif sendiri-sendiri. SPG membutuhkan 80 outlet fisik unik yang terdaftar sebagai workshop dan 5 staf lolos readiness untuk menghasilkan 16 minggu × 5 = 80 assignment. Setiap blok 4 minggu mengunjungi 20 workshop baru, tidak ada duplikasi global. Seed hanya 20 outlet sesuai brief; generator menolak sampai admin melengkapi 80. FM roster enam primer + satu backup per user per hari, nearest-neighbour berdasarkan koordinat dan area; backup bukan target denominator. Enam-day roster tidak disamakan dengan enam-day working calendar: default 5 field days/minggu ×16=80; Config.working_days dapat diubah, target tetap 2.400.

## Provider dan consent

Default wa_link menghasilkan pekerjaan manual; tidak mengklaim delivered. Gateway Fonnte dan adapter Meta memakai PropertiesService secrets. Pembatalan consent diperiksa ulang saat send, tidak hanya ketika campaign dibentuk. Quiet hours berdasarkan WIB, 08:00 ≤ waktu <19:00. Reminder progress dipersist per customer/cycle/stage; batch continuation trigger melanjutkan cursor. Opt-out STOP diterima dari webhook gateway yang mempunyai shared-secret URL; Meta direct webhook memiliki keterbatasan platform yang didokumentasikan. Tidak ada klaim UU PDP terpenuhi otomatis: versi teks, timestamp, actor, source, audit, export/erase tersedia untuk proses tata kelola klien.
