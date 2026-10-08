# Batas platform dan release

## Deployment dan pengujian nyata

Build dan pengujian lokal tersedia. Deployment Google/GitHub, CORS/302 pada URL live, kebijakan OAuth Workspace, gateway device/delivery callback, approved Meta templates, dan Lighthouse URL live perlu diuji oleh pemilik akun. Paket ini belum di-deploy ke akun Anda.

## Google Apps Script

Default project otomatis dikelola Google. Tidak diperlukan Cloud Console, standard GCP project, billing Google, Firebase, advanced services, Cloud Functions, atau Cloud Storage. Apps Script tetap menggunakan layanan cloud Google secara internal.

Kuota resmi yang diperiksa 8 Oktober 2026: enam menit per eksekusi; URL Fetch 20.000/hari pada consumer dan 100.000/hari Workspace; total trigger 90 menit/hari atau enam jam/hari Workspace; 30 eksekusi bersamaan per user; 20 trigger per user/script; sembilan KB per property. Kuota dapat berubah. Batch pesan maksimal 25 dan time budget 260 detik. Burst write diserialisasi ScriptLock dan dapat menerima BUSY.

[Kuota Google](https://developers.google.com/apps-script/guides/services/quotas) · [Default project](https://developers.google.com/apps-script/guides/cloud-platform-projects) · [ContentService redirect](https://developers.google.com/apps-script/guides/content)

## Offline dan transaksi

IndexedDB mengikuti kebijakan browser. Clear storage, uninstall, eviction, atau perangkat rusak dapat menghapus data. Initial login dan jadwal perlu dimuat online. Visits, photos, surveys, dan leads dapat diantrekan offline; customer/voucher/campaign/approval/training membutuhkan koneksi.

Background Sync membangunkan tab yang terbuka. Jika semua tab tertutup, sync dilanjutkan saat app dibuka. Token berakhir setelah 12 jam; login ulang akun yang sama mempertahankan antrean.

Sheets bukan database ACID. Journal memulihkan partial writes dan mencegah duplikasi; read singkat dapat melihat commit yang sedang berjalan. Jangan edit row transaksi manual. Default request retention 180 hari, minimum 60 hari; frontend menyimpan metadata queue selesai 31 hari. Visit yang lebih dari 31 hari tidak diterima. Jalankan arsip bulanan.

## WhatsApp dan webhook

wa_link tidak mempunyai biaya API dan memerlukan pengiriman manual. Delivered tidak dapat dibuktikan. Tautan yang sudah disalin tidak dapat ditarik; operator wajib mengikuti opt-out terbaru. Backend memeriksa consent pada link creation, confirmation, dan dispatch.

Fonnte adalah gateway pihak ketiga; biaya, aturan, koneksi device, dan perilaku delivery provider berlaku. Callback harus mengikuti 302 dan menyertakan shared secret. Acceptance API tidak disamakan dengan delivered. Unknown state tidak dipromosikan menjadi delivered.

Adapter Meta outbound menggunakan template yang sudah disetujui. **Direct Meta webhook belum didukung aman** karena membutuhkan GET challenge dan signature header, sedangkan brief meminta doGet health-only dan GAS tidak memberi akses request headers. Tidak ada endpoint Meta yang menerima callback tanpa verifikasi. Untuk Meta, STOP ditangani admin dari inbox resmi; pilih Fonnte jika STOP otomatis wajib dalam arsitektur ini. [Dokumentasi Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/)

Send yang jelas ditolak provider di-retry setelah lima lalu sepuluh menit, maksimal tiga attempts. Timeout, 5xx, atau interrupted dispatch diberi unknown dan memerlukan pemeriksaan provider; retry otomatis dapat menggandakan pesan. Database idempotency tidak menjamin exactly-once pada gateway tanpa fasilitas idempotency provider.

## Privacy, retensi, dan indikator

Pencatatan consent bukan sertifikasi kepatuhan UU PDP. Owner menetapkan dasar pemrosesan, teks approved, retensi, akses, dan prosedur permintaan subjek. Raw Sheet/Drive tidak dibagikan kepada field staff atau client.

customer.delete menghapus registry, kontak lead dengan nomor yang sama, dan meredaksi PII pada linked messages/request responses. Referensi ledger finansial dideidentifikasi. Arsip, Drive trash, export eksternal, backup, dan perangkat browser harus diproses terpisah. DriveApp tidak menyediakan permanent trash purge pada flow ini.

PointsLedger append-only dalam operasi; erasure dapat meredaksi link customer. Tier memakai saldo poin yang belum expired. Odometer due membutuhkan projected_km_per_day untuk estimasi tanggal masa depan; tanpa telemetry angka ini bukan pembacaan jarak aktual.

Repeat-visit lift per workshop belum dihitung tanpa baseline client yang sebanding. Dashboard menampilkan kebutuhan baseline, bukan angka rekaan. Return rate memakai verified service events setelah reminder. Voucher cost/value adalah diskon atau estimasi benefit dan transaksi redeemed; bukan margin atau ROI.

Rencana SPG penuh memerlukan 80 workshop. Seed 20 tidak memenuhi. Lima FM dengan primer unik harian memerlukan setidaknya 31 outlet. Route planner memakai nearest-neighbour geo clustering; tidak menghitung traffic/waktu jalan. Navigasi Maps eksternal tersedia.

PDF export opsional tidak disertakan; CSV tersedia. Training demo adalah synthetic process quiz, harus diganti product knowledge approved sebelum live. EN mengubah navigation/primary labels; legal consent tersimpan persis sesuai konfigurasi.
