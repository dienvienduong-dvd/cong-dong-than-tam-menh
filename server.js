// Load .env if present (no dotenv dependency needed)
const fs0 = require('fs'), path0 = require('path');
const envPath = path0.join(__dirname, '.env');
if (fs0.existsSync(envPath)) {
  fs0.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const express   = require('express');
const bcrypt    = require('bcryptjs');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const initSqlJs = require('sql.js');

const https    = require('https');
const http     = require('http');
const crypto   = require('crypto');
const { Resend } = require('resend');

const app      = express();
const PORT     = process.env.PORT || 3000;
const ADMIN_KEY   = process.env.ADMIN_KEY   || 'nguhanh-admin-2025';
const SEPAY_KEY   = process.env.SEPAY_KEY   || 'ae3066fa595768259e92553aa371405a8fa814c6';
const GSHEET_ID   = process.env.GSHEET_ID   || '1TNzXmIR9Qcu_oqeNxYGFdnFxt2YN9xik4OPJOtac4nI';
const RESEND_KEY       = process.env.RESEND_API_KEY    || '';
const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY || '';

// ── Community identity (override via .env) ───────────────────
const COMMUNITY_NAME = process.env.COMMUNITY_NAME || 'Cộng đồng Ăn Uống Ngũ Hành';
// ASCII-only version for HTTP headers (Latin-1 only) — strips Vietnamese diacritics
const COMMUNITY_NAME_ASCII = COMMUNITY_NAME
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^\x20-\x7E]/g, '').trim() || 'Community';
const SITE_URL       = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SITE_DOMAIN    = SITE_URL.replace(/^https?:\/\//, '');
const FROM_EMAIL  = process.env.FROM_EMAIL || `${COMMUNITY_NAME} <no-reply@${SITE_DOMAIN.split(':')[0]}>`;
const SEPAY_MEMO_PREFIX = process.env.SEPAY_MEMO_PREFIX || 'NGUHANH';
const ADMIN_EMAIL = 'tuchinguyen.ctv@gmail.com';

const resendClient = RESEND_KEY ? new Resend(RESEND_KEY) : null;

async function sendEmail({ to, subject, html }) {
  if (!resendClient) {
    console.warn('[Email] Skipped — RESEND_API_KEY not set');
    return;
  }
  try {
    console.log(`[Email] Sending to ${to} | "${subject}"`);
    const result = await resendClient.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (result?.error) {
      console.error(`[Email] ❌ Rejected by Resend — ${result.error.name || ''}: ${result.error.message || JSON.stringify(result.error)}`);
    } else {
      console.log(`[Email] ✅ Sent — id: ${result?.data?.id || result?.id || JSON.stringify(result)}`);
    }
  } catch (err) {
    console.error('[Email] ❌ Error:', err.message, err?.response?.data || '');
  }
}

function emailWrap(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:24px}
    .box{background:#fff;border-radius:12px;max-width:560px;margin:0 auto;padding:40px;border:1px solid #e2e8f0}
    h1{color:#0f172a;font-size:22px;margin:0 0 16px}
    p{color:#475569;line-height:1.6;margin:0 0 12px}
    .btn{display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;margin:16px 0}
    .footer{color:#94a3b8;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0}
    .badge{background:#e0f2fe;color:#0284c7;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600}
    .rule{background:#f8fafc;border-left:3px solid #0ea5e9;padding:12px 16px;border-radius:0 8px 8px 0;margin:8px 0}
    .green{color:#10b981;font-weight:700}
  </style></head><body>
  <div class="box">
    <p style="color:#0ea5e9;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">${COMMUNITY_NAME.toUpperCase()}</p>
    <h1>${title}</h1>
    ${body}
    <div class="footer">${COMMUNITY_NAME}<br>${SITE_DOMAIN}</div>
  </div></body></html>`;
}

// Fetch URL với redirect support (dùng cho Google Sheet CSV export)
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Parse một dòng CSV (xử lý quoted fields)
function parseCSVRow(line) {
  const cells = []; let inQ = false; let cell = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cell += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
    else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}
const DB_PATH  = path.join(__dirname, 'brain.db');

// ── Ttm body photos/video upload (Hồ sơ ảnh) — lưu tạm rồi đẩy lên Google Drive ──
const TTM_PHOTOS_TMP_DIR = path.join(__dirname, 'uploads', 'ttm-photos-tmp');
fs.mkdirSync(TTM_PHOTOS_TMP_DIR, { recursive: true });

const ttmPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TTM_PHOTOS_TMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `u${req.params.userId}-${file.fieldname}-${Date.now()}${ext}`);
  },
});
const ttmPhotoUpload = multer({
  storage: ttmPhotoStorage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB — đủ cho ảnh + 1 video ngắn
  fileFilter: (req, file, cb) => {
    const isImage = ['front', 'back', 'side'].includes(file.fieldname) && file.mimetype.startsWith('image/');
    const isVideo = file.fieldname === 'video' && file.mimetype.startsWith('video/');
    cb(isImage || isVideo ? null : new Error('Định dạng file không hợp lệ.'), isImage || isVideo);
  },
});

// ── Google Drive (OAuth với tài khoản dienvienduong@gmail.com — kho lưu ảnh/video Hồ sơ ảnh) ──
// Service Account trần không có storage quota nên không upload được file thật (chỉ tạo được
// thư mục 0-byte) — phải dùng OAuth với 1 tài khoản Google thật để file dùng đúng quota của
// tài khoản đó, khớp với cách dữ liệu cũ (thư mục "377hsttm - Hồ sơ Khách hàng") đang được lưu.
const { google }                    = require('googleapis');
const GOOGLE_DRIVE_OAUTH_CLIENT_ID     = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || '';
const GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_DRIVE_REDIRECT_URI        = `${SITE_URL}/api/admin/drive-oauth/callback`;
const GOOGLE_DRIVE_PARENT_FOLDER_ID    = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '';
const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
];

function newDriveOAuthClient() {
  if (!GOOGLE_DRIVE_OAUTH_CLIENT_ID || !GOOGLE_DRIVE_OAUTH_CLIENT_SECRET) {
    throw new Error('Chưa cấu hình GOOGLE_DRIVE_OAUTH_CLIENT_ID / GOOGLE_DRIVE_OAUTH_CLIENT_SECRET.');
  }
  return new google.auth.OAuth2(GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI);
}

// Upload 1 file local lên 1 thư mục Drive, set quyền "anyone with link" để nhúng lại được,
// trả về { fileId, displayUrl } — ảnh dùng link xem trực tiếp, video dùng link nhúng iframe.
async function uploadToUserDrive(drive, localFilePath, filename, mimeType, folderId, isVideo) {
  const created = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(localFilePath) },
    fields: 'id',
  });
  const fileId = created.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  // `uc?export=view` đôi khi trả về trang HTML xác nhận thay vì ảnh thật khi nhúng trực tiếp trong
  // trình duyệt (tuỳ session/cookie của người xem) — dùng endpoint thumbnail chính thức của Drive,
  // ổn định hơn cho việc nhúng <img>.
  const displayUrl = isVideo
    ? `https://drive.google.com/file/d/${fileId}/preview`
    : `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  return { fileId, displayUrl };
}

// Xoá 1 file Drive cũ khi bị thay thế (best-effort, không throw nếu lỗi).
async function deleteDriveFileByUrl(drive, url) {
  if (!url) return;
  const m = url.match(/[?&]id=([^&]+)/) || url.match(/\/file\/d\/([^/]+)/);
  if (!m) return;
  try {
    await drive.files.delete({ fileId: m[1] });
  } catch (e) { /* file đã bị xoá tay trên Drive hoặc lỗi mạng — bỏ qua */ }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // `no-cache` (not `no-store`): browser still revalidates every request
      // (never serves stale JS/CSS after an edit) but can get a 304 instead
      // of re-downloading the whole file — full downloads on every single
      // page navigation were a major source of the menu-click stutter.
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── Thin wrapper: sql.js → better-sqlite3-style API ──────────
class DB {
  constructor(sqlJs) {
    this._ = fs.existsSync(DB_PATH)
      ? new sqlJs.Database(fs.readFileSync(DB_PATH))
      : new sqlJs.Database();
  }

  _save() {
    fs.writeFileSync(DB_PATH, Buffer.from(this._.export()));
  }

  exec(sql) {
    this._.run(sql);
    this._save();
    return this;
  }

  run(sql, params = []) {
    this._.run(sql, params);
    const lastInsertRowid = this._.exec('SELECT last_insert_rowid()')[0].values[0][0];
    this._save();
    return { lastInsertRowid };
  }

  get(sql, params = []) {
    const stmt = this._.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  all(sql, params = []) {
    const stmt = this._.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

// ── Schema ────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name     TEXT    NOT NULL,
    last_name      TEXT    NOT NULL,
    email          TEXT    UNIQUE NOT NULL,
    password_hash  TEXT,
    google_id      TEXT,
    avatar_url     TEXT,
    level          INTEGER DEFAULT 1,
    xp             INTEGER DEFAULT 0,
    streak         INTEGER DEFAULT 0,
    status         TEXT    DEFAULT 'active',
    last_active_at TEXT,
    created_at     TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    title          TEXT    NOT NULL,
    content        TEXT    NOT NULL,
    pillar         TEXT,
    post_type      TEXT    DEFAULT 'post',
    likes_count    INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    is_pinned      INTEGER DEFAULT 0,
    created_at     TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    content    TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS challenge_days (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number  INTEGER UNIQUE NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT,
    xp_reward   INTEGER DEFAULT 5
  );
  CREATE TABLE IF NOT EXISTS user_challenge_progress (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    day_number   INTEGER NOT NULL,
    completed_at TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, day_number)
  );
  CREATE TABLE IF NOT EXISTS xp_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    amount     INTEGER NOT NULL,
    source     TEXT    NOT NULL,
    note       TEXT,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    type       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    is_read    INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    token      TEXT    UNIQUE NOT NULL,
    expires_at TEXT    NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    token      TEXT    UNIQUE NOT NULL,
    expires_at TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS admin_secrets (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS ai_providers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    provider_type TEXT    NOT NULL,
    api_key       TEXT    NOT NULL,
    model         TEXT,
    is_active     INTEGER DEFAULT 0,
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS challenges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    duration    INTEGER NOT NULL DEFAULT 21,
    status      TEXT DEFAULT 'active',
    cover_color TEXT DEFAULT '#0ea5e9',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS challenge_submissions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    challenge_id INTEGER NOT NULL REFERENCES challenges(id),
    day_id       INTEGER NOT NULL REFERENCES challenge_days(id),
    content      TEXT NOT NULL,
    status       TEXT DEFAULT 'pending',
    admin_note   TEXT,
    submitted_at TEXT DEFAULT (datetime('now','localtime')),
    reviewed_at  TEXT,
    is_late      INTEGER DEFAULT 0,
    UNIQUE(user_id, day_id)
  );
  CREATE TABLE IF NOT EXISTS late_reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    challenge_id INTEGER NOT NULL REFERENCES challenges(id),
    day_id       INTEGER NOT NULL REFERENCES challenge_days(id),
    first_sent_at TEXT DEFAULT (datetime('now','localtime')),
    last_sent_at  TEXT DEFAULT (datetime('now','localtime')),
    sent_count   INTEGER DEFAULT 1,
    UNIQUE(user_id, day_id)
  );
  CREATE TABLE IF NOT EXISTS challenge_enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    challenge_id INTEGER NOT NULL REFERENCES challenges(id),
    status       TEXT DEFAULT 'pending',
    enrolled_at  TEXT DEFAULT (datetime('now','localtime')),
    approved_at  TEXT,
    started_at   TEXT,
    UNIQUE(user_id, challenge_id)
  );
  CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS products (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id        INTEGER NOT NULL REFERENCES users(id),
    title            TEXT NOT NULL,
    description      TEXT,
    long_description TEXT,
    price            INTEGER NOT NULL DEFAULT 0,
    category         TEXT DEFAULT 'other',
    cover_color      TEXT DEFAULT '#0ea5e9',
    status           TEXT DEFAULT 'published',
    sales_count      INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    buyer_id        INTEGER NOT NULL REFERENCES users(id),
    amount          INTEGER NOT NULL,
    payment_method  TEXT DEFAULT 'bank',
    status          TEXT DEFAULT 'pending',
    note            TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS courses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    cover_color  TEXT DEFAULT '#6366f1',
    status       TEXT DEFAULT 'draft',
    instructor   TEXT,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS course_modules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    title        TEXT NOT NULL,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS course_lessons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    module_id    INTEGER REFERENCES course_modules(id),
    title        TEXT NOT NULL,
    content      TEXT,
    video_url    TEXT,
    duration_min INTEGER DEFAULT 0,
    order_num    INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'published',
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS course_enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    status       TEXT DEFAULT 'pending',
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS lesson_exercise_submissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    lesson_id       INTEGER NOT NULL REFERENCES course_lessons(id),
    course_id       INTEGER NOT NULL REFERENCES courses(id),
    answer_text     TEXT    NOT NULL,
    score           INTEGER NOT NULL,
    max_score       INTEGER NOT NULL,
    pass_score      INTEGER NOT NULL,
    passed          INTEGER NOT NULL DEFAULT 0,
    issues          TEXT,
    hints           TEXT,
    ai_feedback_raw TEXT,
    xp_awarded      INTEGER NOT NULL DEFAULT 0,
    submitted_at    TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, lesson_id)
  );
  CREATE TABLE IF NOT EXISTS lesson_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id  INTEGER NOT NULL REFERENCES course_lessons(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    content    TEXT    NOT NULL,
    parent_id  INTEGER REFERENCES lesson_comments(id),
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS lesson_exercise_questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id     INTEGER NOT NULL REFERENCES course_lessons(id),
    question_text TEXT NOT NULL,
    options       TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    explanation   TEXT,
    order_num     INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ielts_tests (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    skill              TEXT NOT NULL,
    title              TEXT NOT NULL,
    description        TEXT,
    time_limit_minutes INTEGER DEFAULT 60,
    status             TEXT DEFAULT 'published',
    max_score          INTEGER DEFAULT 100,
    passages           TEXT,
    task_type          TEXT,
    writing_prompt     TEXT,
    writing_rubric     TEXT,
    writing_image_url  TEXT,
    created_at         TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ielts_test_questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id        INTEGER NOT NULL REFERENCES ielts_tests(id),
    question_type  TEXT NOT NULL,
    passage_ref    TEXT,
    question_text  TEXT NOT NULL,
    options        TEXT,
    correct_answer TEXT NOT NULL,
    explanation    TEXT,
    order_num      INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS space_groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS spaces (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id            INTEGER REFERENCES space_groups(id),
    name                TEXT    NOT NULL,
    icon                TEXT    DEFAULT '💬',
    description         TEXT,
    visibility          TEXT    DEFAULT 'public',
    min_level           INTEGER DEFAULT 1,
    allow_join_requests INTEGER DEFAULT 1,
    order_num           INTEGER DEFAULT 0,
    created_at          TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS space_members (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id     INTEGER NOT NULL REFERENCES spaces(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    status       TEXT    DEFAULT 'pending',
    invited_by   INTEGER REFERENCES users(id),
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(space_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS topics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id     INTEGER NOT NULL REFERENCES spaces(id),
    name         TEXT    NOT NULL,
    icon         TEXT    DEFAULT '🏷️',
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id      INTEGER NOT NULL REFERENCES posts(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    option_index INTEGER NOT NULL,
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS pillars (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    UNIQUE NOT NULL,
    label      TEXT    NOT NULL,
    icon       TEXT    DEFAULT '🔥',
    color      TEXT    DEFAULT '#0ea5e9',
    order_num  INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS foods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    element    TEXT,          -- kim | moc | thuy | hoa | tho
    color      TEXT,          -- trắng | xanh | đen | đỏ | vàng
    taste      TEXT,          -- cay | chua | mặn | đắng | ngọt | chát
    nature     TEXT,          -- hàn | lương | bình | ôn | nhiệt
    organ      TEXT,          -- Phổi/Đại tràng, Gan/Mật, ...
    note       TEXT,
    order_num  INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    element_tags TEXT,        -- comma-separated: kim,moc,...
    buoi         TEXT,        -- sáng | trưa | tối | cả ngày
    summary      TEXT,
    ingredients  TEXT,
    steps        TEXT,
    dung_khi     TEXT,        -- "dùng khi" — điều kiện phù hợp
    note         TEXT,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS camnang_docs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    pdf_url    TEXT    NOT NULL,
    icon       TEXT    DEFAULT '📄',
    note       TEXT,
    order_num  INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS meal_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    log_date   TEXT    NOT NULL,   -- YYYY-MM-DD
    breakfast  TEXT,
    lunch      TEXT,
    dinner     TEXT,
    colors     TEXT,   -- JSON array: ["xanh","đỏ",...]
    tastes     TEXT,   -- JSON array: ["chua","cay",...]
    note       TEXT,
    created_at TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, log_date)
  );
  CREATE TABLE IF NOT EXISTS meal_log_reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    reminder_date TEXT    NOT NULL,   -- YYYY-MM-DD
    sent_count    INTEGER DEFAULT 1,
    last_sent_at  TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, reminder_date)
  );
  CREATE TABLE IF NOT EXISTS assistant_usage (
    user_id    INTEGER NOT NULL REFERENCES users(id),
    usage_date TEXT    NOT NULL,   -- YYYY-MM-DD (localtime)
    count      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, usage_date)
  );
  CREATE TABLE IF NOT EXISTS assistant_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    question   TEXT    NOT NULL,
    answer     TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ttm_intake_responses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    answers_json TEXT    NOT NULL,
    summary_text TEXT    NOT NULL,
    submitted_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ttm_roadmaps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    intake_id     INTEGER NOT NULL REFERENCES ttm_intake_responses(id),
    draft_content TEXT    NOT NULL,
    status        TEXT    DEFAULT 'pending_approval',
    admin_note    TEXT,
    final_content TEXT,
    reviewed_at   TEXT,
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ttm_body_photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id),
    front_url    TEXT,
    back_url     TEXT,
    side_url     TEXT,
    video_url    TEXT,
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
  );

  -- ── Chương trình 377 ngày ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS program377_enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id),
    status       TEXT    DEFAULT 'pending',
    enrolled_at  TEXT    DEFAULT (datetime('now','localtime')),
    approved_at  TEXT,
    approved_by  INTEGER REFERENCES users(id),
    start_date   TEXT,
    admin_note   TEXT
  );
  CREATE TABLE IF NOT EXISTS program377_days (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number      INTEGER UNIQUE NOT NULL,
    topic_key       TEXT,
    title           TEXT    NOT NULL,
    body_html       TEXT,
    video_url       TEXT,
    exercise_title  TEXT,
    exercise_body   TEXT,
    xp_reward       INTEGER DEFAULT 0,
    created_at      TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS program377_reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    report_date      TEXT    NOT NULL,
    day_number       INTEGER,
    meal_breakfast   TEXT,
    meal_lunch       TEXT,
    meal_dinner      TEXT,
    meal_colors      TEXT,
    meal_tastes      TEXT,
    urine_amount     TEXT,
    urine_color      TEXT,
    stool_shape      TEXT,
    stool_color      TEXT,
    exercise_type    TEXT,
    exercise_minutes INTEGER,
    sweat_amount     TEXT,
    sweat_taste      TEXT,
    feeling_note     TEXT,
    is_late          INTEGER DEFAULT 0,
    created_at       TEXT    DEFAULT (datetime('now','localtime')),
    updated_at       TEXT,
    UNIQUE(user_id, report_date)
  );
  CREATE TABLE IF NOT EXISTS program377_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date  TEXT    NOT NULL,
    title         TEXT    NOT NULL,
    session_type  TEXT    DEFAULT 'zoom',
    link_url      TEXT,
    description   TEXT,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
`;

// [day_number, title, description, instructions, xp_reward] — 28 ngày Dưỡng Hóa theo Ngũ Hành
const PROTOCOL_SOP = `<h3>🕒 Quy trình 1 ngày 3 buổi (làm mỗi ngày)</h3>
<table><thead><tr><th>Giờ</th><th>Việc</th><th>Hướng dẫn</th></tr></thead><tbody>
<tr><td>05:30</td><td>Uống sữa kháng thể</td><td>Pha với nước nguội, lắc dọc ~30 giây; uống trước ăn 30 phút (trước thuốc 60 phút nếu có).</td></tr>
<tr><td>06:00</td><td>Mật mía chanh + vận động 30 phút</td><td>~5 thìa mật mía + 250ml nước ấm + 1 lát chanh (dùng chanh có hạt). Trời lạnh thêm 1 lát gừng. Sau đó vỗ tay 4 nhịp / yoga / chạy bộ — nơi nhiều oxy, chân tiếp đất, tắm nắng.</td></tr>
<tr><td>06:30–07:30</td><td>Ăn sáng theo Ngũ Hành</td><td>Ưu tiên vị CHUA (Hành Mộc): vắt chanh vào nước chấm, ăn kèm lá diếp cá, uống nước cam. Trời lạnh thêm vị CAY: tỏi, ớt, tiêu, lá bạc hà.</td></tr>
<tr><td>08:00–09:00</td><td>Café / cacao / trà tim sen</td><td>Huyết áp thấp hoặc bình thường → vị đắng màu đỏ (café / cacao / socola). Huyết áp cao → vị đắng màu xanh (trà tim sen).</td></tr>
<tr><td>11:30–12:00</td><td>Ăn trưa theo Ngũ Hành</td><td>Kết hợp vị + màu: Xanh+Chua, Đỏ+Đắng, thêm Chát. VD canh chua lá giang, canh sườn nấu sấu, canh khổ qua, chuối xanh nấu tía tô.</td></tr>
<tr><td>18:30–19:00</td><td>Ăn tối theo Ngũ Hành + 1 ly rượu vang (20–50ml)</td><td>Ưu tiên vị CAY màu trắng (Hành Kim) + vị MẶN màu đen (Hành Thủy). VD lẩu Thái, rau muống xào tỏi, mè đen rang muối, canh gà ác, tỏi đen ngâm tương.</td></tr>
<tr><td>19:30</td><td>Uống trà thải độc</td><td>1 gói + 200ml nước sôi (trời lạnh 100ml). Nếu hôm sau không đi vệ sinh được → tăng 2 gói với 300ml.</td></tr>
</tbody></table>
<blockquote>Lưu ý chung: dùng chanh có hạt · nhai kỹ (ăn như uống) · cố ăn đủ 5 màu + 5 vị · nếu không đủ cả màu cả vị thì ưu tiên VỊ.</blockquote>`;

const SUBMIT_BLOCK = `Nộp bài:
<ul>
<li>Ảnh ít nhất 1 bữa ăn hôm nay (nêu rõ có những màu gì / vị gì)</li>
<li>Tự đánh giá: hôm nay bạn ăn đủ mấy màu (xanh/đỏ/vàng/trắng/đen) và mấy vị (chua/cay/đắng/mặn/ngọt)?</li>
<li>Cảm nhận cơ thể trong ngày (tiêu hóa, năng lượng, giấc ngủ, tâm trạng)</li>
</ul>
✅ Được duyệt khi: Có ảnh bữa ăn thật + phần tự đánh giá màu/vị + 1–2 câu cảm nhận cơ thể.`;

const NGU_HANH_DAYS = [
  [1, 'Khởi động — Hiểu quy trình & chuẩn bị', 'Chào mừng bạn đến với 28 ngày Dưỡng Hóa. Mục tiêu tuần 1: <strong>Bổ sung dinh dưỡng – kích hoạt phục hồi</strong>. Cơ thể được nạp lại dưỡng chất thiếu hụt, tăng lượng máu và kháng thể. 3–7 ngày đầu có thể thấy lừ đừ, mệt nhẹ, đi ngoài nặng mùi — đó là dấu hiệu tốt.', 'Chuẩn bị nguyên liệu: sữa kháng thể, mật mía, chanh có hạt, gừng, trà thải độc, café/cacao hoặc tim sen, rau xanh, mè đen. Đọc kỹ quy trình dưới đây và làm theo ngay hôm nay.'],
  [2, 'Ngũ Sắc – Ngũ Vị: ăn đủ 5 màu, 5 vị', 'Theo Ngũ Hành, thực phẩm nên đủ 5 màu (Xanh–Đỏ–Vàng–Trắng–Đen) và 5 vị (Chua–Đắng–Ngọt–Cay–Mặn). Mỗi màu/vị đi vào một tạng phủ. Ăn đủ ngũ sắc ngũ vị giúp dưỡng chất phát huy tối ưu.', 'Trọng tâm hôm nay: cố tình sắp một bữa có <strong>đủ 5 màu</strong>. Gợi ý: rau xanh + cà chua/gấc (đỏ) + bắp/nghệ (vàng) + nấm/củ sen (trắng) + mè đen/nấm mèo (đen).'],
  [3, 'Hành Mộc — bữa sáng vị Chua nuôi Gan', 'Hành Mộc: màu Xanh, vị Chua, ứng Gan/Mật, mùa Xuân. Vị chua thanh lọc Gan (Gan tàng huyết). Uống nước chanh gừng mật mía buổi sáng giúp thải độc Gan và rửa hệ tiêu hóa.', 'Trọng tâm: bữa sáng ưu tiên <strong>vị chua + màu xanh</strong>. Vắt chanh vào nước chấm, ăn kèm lá diếp cá, uống nước cam hoặc nước chanh gừng mật mía.'],
  [4, 'Hành Hỏa — vị Đắng & màu Đỏ cho Tim', 'Hành Hỏa: màu Đỏ, vị Đắng, ứng Tim/Ruột non, mùa Hạ. Đắng nhiệt (café, cacao) tăng nhịp tim; đắng hàn (tim sen, khổ qua, rau má) hạ nhịp tim và huyết áp. Chọn theo huyết áp của bạn.', 'Trọng tâm: 08:00–09:00 chọn đúng vị đắng theo huyết áp. Bữa trưa thêm màu đỏ: củ dền, cà chua, gấc, rau dền.'],
  [5, 'Hành Thổ — vị Ngọt tốt nuôi Tỳ Vị & miễn dịch', 'Hành Thổ: màu Vàng, vị Ngọt, ứng Tỳ/Vị (Lá Lách/Bao Tử), giao mùa. Đường tốt (mật mía, mật ong, nước mía, đường thô) làm mát Lá Lách, tăng miễn dịch — khác hẳn đường tinh luyện.', 'Trọng tâm: dùng <strong>đường tốt</strong> thay đường trắng. Thêm món màu vàng: bí đỏ, bắp, khoai, xoài, dứa.'],
  [6, 'Hành Kim — vị Cay & màu Trắng cho Phổi/Đại tràng', 'Hành Kim: màu Trắng, vị Cay, ứng Phổi/Đại tràng, mùa Thu. Vị cay giúp thông mũi, hỗ trợ hô hấp. Cay nhiệt: tỏi, sả, gừng, tiêu, quế. Cay hàn: bạc hà, húng chanh.', 'Trọng tâm: bữa tối ưu tiên <strong>vị cay + màu trắng</strong>: nấm, củ sen, bông cải, đậu hũ, tỏi, sả. Rau muống xào tỏi là món điển hình.'],
  [7, 'Hành Thủy — vị Mặn & màu Đen + Tổng kết tuần 1', 'Hành Thủy: màu Đen, vị Mặn, ứng Thận/Bàng quang, mùa Đông. Vị mặn vừa đủ đi vào Thận; mặn quá hại Tim và gây tích nước — nên dùng vị mặn buổi trưa, hạn chế buổi tối.', 'Trọng tâm tối nay: <strong>màu đen + mặn nhẹ</strong>: mè đen rang muối, đậu đen, nấm mèo, gà ác tiềm. Tổng kết tuần 1: viết 3 thay đổi bạn thấy rõ nhất ở cơ thể.'],
  [8, 'Giai đoạn Đào thải — dấu hiệu là bình thường', 'Tuần 2: cơ thể tự làm sạch — thải độc Gan, Thận, Ruột, máu qua da, hơi thở, nước tiểu, phân. Có thể nổi mụn, ngứa, tiêu chảy nhẹ, ho, xổ mũi, cảm giả — kéo dài 1–2 tuần tùy cơ địa. Uống đủ nước, nghỉ ngơi.', 'Giữ nguyên quy trình. Trọng tâm: ghi lại các dấu hiệu thải độc bạn gặp (nếu có) để theo dõi.'],
  [9, 'Thải độc Gan — nước chanh gừng mật mía', 'Gan sạch sẽ sinh máu tốt, máu tốt giúp Tim khỏe. Uống nước chanh + vài lát gừng + mật mía (hoặc mật ong) lúc bụng đói buổi sáng giúp thải độc Gan. Chất béo tốt (các loại hạt, dầu ô liu, dầu dừa) tốt cho Mật.', 'Trọng tâm sáng nay: <strong>nước chanh gừng mật mía</strong> khi bụng đói. Thêm chất béo tốt vào bữa trong ngày.'],
  [10, 'Thải độc Đại tràng — chất xơ & trà đúng cách', 'Đại tràng bẩn dễ gây viêm xoang, đau đầu, da khô, mẩn ngứa. Ăn nhiều rau xanh, chất xơ; uống trà thải độc buổi tối đúng liều. Trà nhuận tràng nhẹ, làm sạch tiêu hóa sau 6–8 giờ.', 'Trọng tâm: rau xanh trong cả 3 bữa. Trà thải độc 19:30 — nếu sáng hôm sau không đi được, tăng liều theo hướng dẫn.'],
  [11, 'Cân bằng Chua – Ngọt để không xót Bao Tử', 'Vị chua đi vào Gan nhưng chua quá làm hỏng Tỳ Vị (Mộc khắc Thổ) — gây đau bao tử, xót ruột. Luôn cân bằng chua với vị ngọt: canh chua, nước chanh đường, lẩu riêu.', 'Trọng tâm: mỗi khi dùng vị chua, thêm chút vị ngọt tốt để cân bằng.'],
  [12, 'Tính Hàn – Nhiệt: nhìn màu đoán tính', 'Rau quả màu nhạt phần nhiều hàn/mát; màu thẫm thường ấm/nóng. Củ cải, lê, chuối tiêu tính mát; táo, đậu đen, đậu đỏ tính ấm. Thủy sản vỏ cứng (cua, ốc) tính lạnh; lươn, tôm tính ấm.', 'Trọng tâm: với mỗi món hôm nay, thử đoán tính hàn/nhiệt và ghi lại.'],
  [13, 'Ăn theo thể trạng: người hàn / người nhiệt', 'Không có công thức chung cho tất cả. Cơ thể hàn → ăn món tính ấm, vị cay. Cơ thể nhiệt → ăn món tính mát. Dùng máy đo huyết áp để biết hàn hay nhiệt (nhịp tim cao = nhiệt, thấp = hàn).', 'Trọng tâm: xác định bạn thiên hàn hay nhiệt, điều chỉnh vị/tính món ăn cho phù hợp.'],
  [14, 'Tổng kết tuần 2 — đo huyết áp, quan sát nước tiểu', 'Huyết áp là "Khí" trong cơ thể: số 1 = Khí, số 2 = Huyết, số 3 = nhịp tim. Nước tiểu vàng nhạt là tốt; vàng cam = thiếu nước / vấn đề Gan Mật; trong suốt = uống quá nhiều nước.', 'Trọng tâm: đo huyết áp buổi sáng + sau ăn 30 phút; quan sát màu nước tiểu. Ghi lại kết quả.'],
  [15, 'Lưu thông Khí Huyết — vận động buổi sáng', 'Tuần 3: máu huyết lưu thông là nền tảng để cơ thể tự chữa lành. Chỗ nào tắc sẽ mỏi; khi khai thông, cảm giác mỏi tan biến. Vỗ tay 4 nhịp, tắm nắng sáng, đi chân trần trên đất.', 'Trọng tâm: 06:00 vận động đủ 30 phút, ưu tiên nơi nhiều oxy, chân tiếp đất.'],
  [16, 'Nhai kỹ — "ăn như uống, uống như ăn"', 'Khi nhai kỹ, dưỡng chất cùng nước bọt (ngọc dịch) thẩm thấu vào ruột non tốt nhất, giúp tạo máu. Ăn trong tâm trạng thư giãn, tạm gác lo âu để cảm nhận trọn hương vị.', 'Trọng tâm: mỗi miếng nhai ~30 lần; không xem điện thoại khi ăn.'],
  [17, 'Tương sinh – Tương khắc trong bữa ăn', 'Kim sinh Thủy, Thủy sinh Mộc, Mộc sinh Hỏa, Hỏa sinh Thổ, Thổ sinh Kim. Vị nào quá nhiều sẽ hại tạng bị khắc: cay quá hại Gan, mặn quá hại Tim, chua quá hại Tỳ, đắng quá hại Phổi, ngọt quá hại Thận.', 'Trọng tâm: rà lại 1 ngày ăn của bạn — có vị nào đang quá nhiều không?'],
  [18, 'Hormone hạnh phúc & tâm trạng khi ăn', 'Dopamine (đạt mục tiêu), Serotonin (ánh nắng), Oxytocin (ôm người thương), Endorphin (vận động). Mùa Thu dễ buồn → ảnh hưởng Phổi; hãy ra ngoài hít thở, hòa mình thiên nhiên.', 'Trọng tâm: kết hợp 1 việc tạo hormone hạnh phúc hôm nay (tắm nắng / vận động / ôm người thân).'],
  [19, 'Cháo bổ âm — khi nào dùng, cách nấu', 'Cháo bổ âm nấu loãng, dùng khi cơ thể nhiệt, khô, mất ngủ, người mệt. Nấu nhừ, nhai kỹ để ngọc dịch tạo máu và làm dịu cơ thể. Có thể thêm hạt sen, đậu, gạo lứt.', 'Trọng tâm: nấu một nồi cháo bổ âm cho bữa tối hoặc bữa phụ; ghi lại cảm nhận.'],
  [20, 'Cách dùng gừng — cay nhiệt vs cay hàn', 'Gừng thuộc vị cay nhiệt: làm ấm cơ thể, tốt khi trời lạnh hoặc thể hàn. Thêm gừng vào mật mía chanh buổi sáng khi lạnh; trà gừng mật ong khi cảm lạnh. Người thể nhiệt, huyết áp cao nên hạn chế.', 'Trọng tâm: dùng gừng đúng lúc (trời lạnh / thể hàn); nếu thể nhiệt thì dùng bạc hà, húng chanh thay thế.'],
  [21, 'Tổng kết tuần 3 — quan sát phân & mồ hôi', 'Phân hình trụ, màu vàng là chế độ ăn lành mạnh. Phân trắng xám = vấn đề Gan; phân đen = cảnh báo xuất huyết tiêu hóa. Mồ hôi nặng mùi = stress; mồ hôi mặn = thiếu muối/điện giải.', 'Trọng tâm: quan sát phân (tham khảo bảng Bristol) và mồ hôi; ghi lại. Viết 3 tiến bộ của tuần 3.'],
  [22, 'Vị Chát & thực phẩm chống oxy hóa', 'Vị chát giúp chống oxy hóa, giữ tươi trẻ: quả sung, chuối xanh, lựu, quả vả, trà, rượu vang chát. Trà chia theo màu Ngũ Hành: bạch trà, hồng trà, trà đen, trà xanh, trà hoa vàng.', 'Trọng tâm: thêm 1 món vị chát vào bữa trưa (chuối xanh nấu, canh sung...).'],
  [23, 'Ăn theo mùa — Hành ứng với mùa hiện tại', 'Mỗi mùa ứng một Hành: Xuân–Mộc, Hạ–Hỏa, giao mùa Hè–Thu là Thổ, Thu–Kim, Đông–Thủy. Ăn tăng cường Hành của mùa để phòng bệnh giao mùa.', 'Trọng tâm: xác định mùa hiện tại → tăng cường vị/màu của Hành tương ứng trong ngày.'],
  [24, 'Bữa ăn gia đình đủ ngũ sắc ngũ vị', 'Áp dụng cho cả nhà: một mâm cơm đủ 5 màu 5 vị vừa ngon vừa cân bằng âm dương. Kết hợp món tính hàn với gia vị tính nhiệt (đậu hũ + sả ớt) để hài hòa.', 'Trọng tâm: nấu một mâm cơm gia đình đủ ngũ sắc; chụp lại.'],
  [25, 'Trà dưỡng sinh theo Ngũ Hành', 'Bạch trà (Kim), trà đen (Thủy), trà xanh (Mộc), hồng trà (Hỏa), trà hoa vàng (Thổ). Vị chát trong trà chống oxy hóa mạnh. Uống trà buổi sáng cho tỉnh táo, tránh trà đậm buổi tối.', 'Trọng tâm: chọn loại trà hợp Hành bạn cần bổ; uống đúng thời điểm.'],
  [26, 'Xây thực đơn 3 ngày cho riêng bạn', 'Dựa trên thể trạng (hàn/nhiệt), huyết áp và mùa, lên thực đơn 3 ngày theo quy trình 3 buổi. Sáng vị chua, trưa chua–đắng–chát, tối cay–mặn, cả ngày ngọt tốt.', 'Trọng tâm: viết ra thực đơn 3 ngày (9 bữa) của riêng bạn và bắt đầu áp dụng.'],
  [27, 'Thói quen giữ lại sau 28 ngày', 'Chọn 3–5 thói quen dễ duy trì: nước chanh gừng mật mía buổi sáng, vận động 30 phút, ăn đủ 5 màu, nhai kỹ, trà thải độc khi cần. Duy trì đều quan trọng hơn làm nhiều một hôm.', 'Trọng tâm: viết cam kết 3–5 thói quen bạn sẽ giữ lại và cách nhắc bản thân.'],
  [28, 'Tổng kết & cảm nhận toàn hành trình', 'Không có công thức phù hợp cho tất cả — tùy thể trạng, mùa và vùng miền. Điều quan trọng nhất bạn mang theo: hiểu cơ thể mình qua màu – vị – tạng phủ, và ăn trong tâm trạng an vui.', 'Trọng tâm: so sánh cơ thể ngày 1 và ngày 28 (cân nặng, tiêu hóa, giấc ngủ, năng lượng, huyết áp, da).'],
];

const CHALLENGE_DAYS = NGU_HANH_DAYS.map(([num, title, lesson, focus]) => {
  const milestone = (num % 7 === 0) || num === 1;
  const description = `<h3>📖 Bài học ngày ${num}</h3>\n<p>${lesson}</p>`;
  const instructions = `<h3>🎯 Trọng tâm hôm nay</h3>\n<p>${focus}</p>\n${PROTOCOL_SOP}\n${SUBMIT_BLOCK}`;
  return [num, title, description, instructions, milestone ? 10 : 5];
});

const CHALLENGE_DAYS_TEACHER = [];

// ── Seed courses (Ngũ Hành) ──────────────────────────────────
// [title, description, cover_color, [ [lessonTitle, contentHTML, durationMin], ... ] ]
// ── Seed dữ liệu Ngũ Hành: thực phẩm + công thức ─────────────
// food: [name, element, color, taste, nature, organ, note]
const FOOD_SEED = [
  // KIM — Phổi/Đại tràng — trắng — cay
  ['Nấm (bào ngư, rơm)', 'kim', 'trắng', 'ngọt', 'lương', 'Phổi/Đại tràng', 'Màu trắng bổ Phổi; hấp sả thái rất hợp Hành Kim.'],
  ['Củ sen', 'kim', 'trắng', 'ngọt', 'bình', 'Phổi/Đại tràng', 'Hầm canh; mát Phổi, nhuận tràng.'],
  ['Bột sắn dây', 'kim', 'trắng', 'ngọt', 'hàn', 'Phổi/Đại tràng', 'Pha trà Bình Minh; thanh nhiệt, giải khát.'],
  ['Bông cải trắng', 'kim', 'trắng', 'ngọt', 'lương', 'Phổi/Đại tràng', 'Nhiều chất xơ, tốt cho Đại tràng.'],
  ['Tỏi', 'kim', 'trắng', 'cay', 'nhiệt', 'Phổi/Đại tràng', 'Cay nhiệt — làm ấm, thông mũi; hạn chế khi thể nhiệt.'],
  ['Sả', 'kim', 'trắng', 'cay', 'ôn', 'Phổi/Đại tràng', 'Màu trắng vị cay, tốt cho Phổi; hấp/nấu canh.'],
  ['Gừng', 'kim', 'vàng', 'cay', 'nhiệt', 'Phổi/Đại tràng', 'Cay nhiệt — dùng khi trời lạnh / thể hàn; tránh khi huyết áp cao, thể nhiệt.'],
  ['Tiêu', 'kim', 'đen', 'cay', 'nhiệt', 'Phổi/Đại tràng', 'Cay nhiệt, làm ấm bụng.'],
  ['Quế', 'kim', 'nâu', 'cay', 'nhiệt', 'Phổi/Đại tràng', 'Cay nhiệt, ấm; có trong nước phở.'],
  ['Bạc hà', 'kim', 'xanh', 'cay', 'hàn', 'Phổi/Đại tràng', 'Cay hàn — dùng khi thể nhiệt thay cho gừng/tỏi.'],
  ['Húng chanh', 'kim', 'xanh', 'cay', 'lương', 'Phổi/Đại tràng', 'Cay mát, trị ho.'],
  ['Đậu nành / đậu hũ trắng', 'kim', 'trắng', 'ngọt', 'lương', 'Phổi/Đại tràng', 'Tính hàn — kết hợp sả ớt để cân bằng.'],
  ['Cùi dừa / nước cốt dừa', 'kim', 'trắng', 'ngọt', 'bình', 'Phổi/Đại tràng', 'Béo tốt; màu trắng bổ Phổi.'],
  ['Hạt điều', 'kim', 'trắng', 'ngọt', 'ôn', 'Phổi/Đại tràng', 'Chất béo tốt; làm sữa hạt.'],
  ['Kim chi cải thảo', 'kim', 'trắng', 'cay', 'lương', 'Phổi/Đại tràng', 'Món muối lên men, vị cay — hợp Hành Kim.'],

  // THỦY — Thận/Bàng quang — đen — mặn
  ['Đậu đen', 'thuy', 'đen', 'ngọt', 'bình', 'Thận/Bàng quang', 'Bổ Thận; nấu chè, nấu với gạo lứt.'],
  ['Mè đen (vừng đen)', 'thuy', 'đen', 'ngọt', 'bình', 'Thận/Bàng quang', 'Rang muối ăn cùng cơm; bổ Thận, đen tóc.'],
  ['Mộc nhĩ đen (nấm mèo)', 'thuy', 'đen', 'ngọt', 'bình', 'Thận/Bàng quang', 'Bổ huyết, làm sạch mạch máu.'],
  ['Gạo lứt đen', 'thuy', 'đen', 'ngọt', 'ôn', 'Thận/Bàng quang', 'Nấu cơm/cháo; nhiều khoáng.'],
  ['Gà ác', 'thuy', 'đen', 'ngọt', 'ôn', 'Thận/Bàng quang', 'Tiềm thuốc bắc — bổ Thận, dùng mùa Đông.'],
  ['Hải sâm', 'thuy', 'đen', 'mặn', 'ôn', 'Thận/Bàng quang', 'Tiềm — bổ Thận, dưỡng âm.'],
  ['Tỏi đen', 'thuy', 'đen', 'ngọt', 'ôn', 'Thận/Bàng quang', 'Ngâm tương tamari; chống oxy hóa.'],
  ['Rong biển', 'thuy', 'đen', 'mặn', 'hàn', 'Thận/Bàng quang', 'Vị mặn tự nhiên; sấy mè ăn vặt.'],
  ['Nho đen / dâu tằm', 'thuy', 'đen', 'ngọt', 'lương', 'Thận/Bàng quang', 'Làm nước; bổ huyết.'],
  ['Trà đen', 'thuy', 'đen', 'chát', 'ôn', 'Thận/Bàng quang', 'Đậm, bổ Thận; tránh uống tối muộn.'],
  ['Mơ muối / chanh muối', 'thuy', 'đen', 'mặn', 'bình', 'Thận/Bàng quang', 'Thức uống vị mặn — dùng buổi trưa.'],
  ['Dưa muối, cà muối', 'thuy', 'đen', 'mặn', 'lương', 'Thận/Bàng quang', 'Món mặn lên men; dùng buổi trưa.'],

  // MỘC — Gan/Mật — xanh — chua
  ['Rau xanh các loại', 'moc', 'xanh', 'chua', 'lương', 'Gan/Mật', 'Cải bó xôi, mồng tơi, rau muống... nền tảng bữa ăn.'],
  ['Lá diếp cá', 'moc', 'xanh', 'chua', 'hàn', 'Gan/Mật', 'Ăn kèm bữa sáng — mát Gan, thải độc.'],
  ['Chanh', 'moc', 'xanh', 'chua', 'lương', 'Gan/Mật', 'Dùng chanh có hạt; vắt vào nước chấm buổi sáng.'],
  ['Sấu', 'moc', 'xanh', 'chua', 'lương', 'Gan/Mật', 'Nấu canh sườn, ngâm nước.'],
  ['Khế chua', 'moc', 'vàng', 'chua', 'lương', 'Gan/Mật', 'Nấu canh chua, ăn sống.'],
  ['Lá giang', 'moc', 'xanh', 'chua', 'lương', 'Gan/Mật', 'Nấu canh chua lá giang.'],
  ['Chùm ruột', 'moc', 'xanh', 'chua', 'lương', 'Gan/Mật', 'Ăn vặt, ngâm; nhiều vitamin C.'],
  ['Đậu xanh', 'moc', 'xanh', 'ngọt', 'hàn', 'Gan/Mật', 'Nấu chè, cháo — thanh nhiệt, giải độc.'],
  ['Tảo Spirulina', 'moc', 'xanh', 'chát', 'lương', 'Gan/Mật', 'Bổ sung diệp lục, giải độc.'],
  ['Dấm kombucha / kefir', 'moc', 'vàng', 'chua', 'lương', 'Gan/Mật', 'Lên men — bổ men vi sinh, hỗ trợ tiêu hóa.'],
  ['Sữa chua', 'moc', 'trắng', 'chua', 'lương', 'Gan/Mật', 'Men sống, tốt đường ruột.'],
  ['Trà xanh', 'moc', 'xanh', 'chát', 'lương', 'Gan/Mật', 'Thanh Gan, tỉnh táo — uống buổi sáng.'],

  // HỎA — Tim/Ruột non — đỏ — đắng
  ['Củ dền', 'hoa', 'đỏ', 'ngọt', 'bình', 'Tim/Ruột non', 'Bổ máu; luộc, ép nước, nấu canh.'],
  ['Cà chua', 'hoa', 'đỏ', 'chua', 'lương', 'Tim/Ruột non', 'Nhiều lycopene; nấu canh, sốt.'],
  ['Gấc', 'hoa', 'đỏ', 'ngọt', 'bình', 'Tim/Ruột non', 'Xôi gấc; giàu beta-caroten.'],
  ['Rau dền đỏ', 'hoa', 'đỏ', 'ngọt', 'lương', 'Tim/Ruột non', 'Bổ máu, mát.'],
  ['Lựu', 'hoa', 'đỏ', 'chát', 'lương', 'Tim/Ruột non', 'Chống oxy hóa, bảo vệ tim mạch.'],
  ['Kỷ tử', 'hoa', 'đỏ', 'ngọt', 'bình', 'Tim/Ruột non', 'Cho vào trà, cháo, canh tiềm.'],
  ['Ớt chuông đỏ', 'hoa', 'đỏ', 'ngọt', 'ôn', 'Tim/Ruột non', 'Xào, ăn sống; nhiều vitamin C.'],
  ['Cà phê', 'hoa', 'nâu', 'đắng', 'nhiệt', 'Tim/Ruột non', 'Đắng nhiệt — hợp người huyết áp thấp / nhịp tim thấp; dùng trước 14:00.'],
  ['Ca cao', 'hoa', 'nâu', 'đắng', 'ôn', 'Tim/Ruột non', 'Đắng nhiệt; kèm mật mía.'],
  ['Tim sen', 'hoa', 'xanh', 'đắng', 'hàn', 'Tim/Ruột non', 'Đắng hàn — hạ nhịp tim, hạ huyết áp, an thần; hợp người thể nhiệt.'],
  ['Khổ qua (mướp đắng)', 'hoa', 'xanh', 'đắng', 'hàn', 'Tim/Ruột non', 'Đắng hàn — thanh nhiệt; xào trứng, nấu canh.'],
  ['Rau má', 'hoa', 'xanh', 'đắng', 'hàn', 'Tim/Ruột non', 'Đắng hàn — mát gan, hạ nhiệt.'],
  ['Ngải cứu', 'hoa', 'xanh', 'đắng', 'ôn', 'Tim/Ruột non', 'Trứng chiên ngải cứu; điều huyết.'],

  // THỔ — Tỳ/Vị — vàng — ngọt
  ['Bí đỏ', 'tho', 'vàng', 'ngọt', 'ôn', 'Tỳ/Vị', 'Nấu cháo, canh — bổ Tỳ, dễ tiêu.'],
  ['Bắp (ngô) vàng', 'tho', 'vàng', 'ngọt', 'bình', 'Tỳ/Vị', 'Luộc, nấu chè; lợi tiểu nhẹ.'],
  ['Khoai lang / khoai tây', 'tho', 'vàng', 'ngọt', 'bình', 'Tỳ/Vị', 'Tinh bột tốt, no lâu, nhuận tràng.'],
  ['Chuối chín', 'tho', 'vàng', 'ngọt', 'lương', 'Tỳ/Vị', 'Bổ sung kali; ăn khi tập luyện.'],
  ['Dứa (thơm)', 'tho', 'vàng', 'chua', 'bình', 'Tỳ/Vị', 'Enzyme bromelain hỗ trợ tiêu hóa đạm.'],
  ['Xoài chín', 'tho', 'vàng', 'ngọt', 'ôn', 'Tỳ/Vị', 'Ngọt mát; ăn lượng vừa.'],
  ['Mật mía', 'tho', 'nâu', 'ngọt', 'ôn', 'Tỳ/Vị', 'Đường tốt — làm mát Lá Lách, tăng miễn dịch; pha nước sáng.'],
  ['Mật ong', 'tho', 'vàng', 'ngọt', 'bình', 'Tỳ/Vị', 'Đường tốt; pha trà gừng khi cảm lạnh.'],
  ['Nước mía', 'tho', 'vàng', 'ngọt', 'lương', 'Tỳ/Vị', 'Làm mát Lá Lách, giải độc máu; uống trước vận động.'],
  ['Đường thốt nốt', 'tho', 'nâu', 'ngọt', 'bình', 'Tỳ/Vị', 'Đường thô — thay đường tinh luyện.'],
  ['Trà hoa vàng', 'tho', 'vàng', 'ngọt', 'lương', 'Tỳ/Vị', 'Dịu, hỗ trợ Tỳ Vị, thư giãn.'],

  // CHÁT — chống oxy hóa
  ['Quả sung', 'moc', 'xanh', 'chát', 'bình', 'Chống oxy hóa', 'Nấu canh, kho; chống oxy hóa.'],
  ['Chuối xanh', 'moc', 'xanh', 'chát', 'lương', 'Chống oxy hóa', 'Nấu với tía tô; nhiều tinh bột kháng.'],
  ['Quả vả', 'moc', 'xanh', 'chát', 'bình', 'Chống oxy hóa', 'Trộn gỏi, kho.'],
  ['Bạch trà (trà trắng)', 'kim', 'trắng', 'chát', 'lương', 'Chống oxy hóa', 'Nhẹ nhất trong các loại trà; chống oxy hóa.'],
];

// recipe: [title, element_tags, buoi, summary, ingredients, steps, dung_khi, note]
const RECIPE_SEED = [
  ['Cháo bổ âm', 'thuy,tho', 'tối', 'Cháo loãng nấu nhừ, làm dịu cơ thể khi nhiệt, khô, mất ngủ.',
   'Gạo lứt 1/2 chén · hạt sen 2 thìa · đậu xanh hoặc đậu đen 2 thìa · bí đỏ 1 miếng nhỏ · nước 1.5 lít · chút muối.',
   '1. Vo gạo, ngâm 1 giờ.\n2. Nấu gạo + hạt sen + đậu với nước, lửa nhỏ 40–50 phút cho thật nhừ.\n3. Thêm bí đỏ nấu thêm 10 phút.\n4. Nêm nhạt. Ăn ấm, nhai kỹ.',
   'Khi cơ thể nhiệt, khô, mất ngủ, người mệt, sau khi ăn nhiều đồ cay nóng.',
   'Nấu càng nhừ càng tốt để "ngọc dịch" (nước bọt khi nhai) thấm vào ruột non tạo máu.'],

  ['Nước chanh gừng mật mía (buổi sáng)', 'moc,tho', 'sáng', 'Thức uống bụng đói buổi sáng — thải độc Gan, rửa hệ tiêu hóa.',
   '1 lát chanh có hạt · 2–3 lát gừng tươi · 1 thìa mật mía · 250ml nước ấm.',
   '1. Cho gừng vào cốc, chế nước ấm (không sôi).\n2. Thêm mật mía, khuấy tan.\n3. Vắt chanh, thả cả lát vào.\n4. Uống lúc bụng đói, trước ăn sáng 20–30 phút.',
   'Mỗi sáng. Trời lạnh / thể hàn: tăng gừng. Thể nhiệt, huyết áp cao: giảm hoặc bỏ gừng.',
   'Gan tàng huyết — Gan sạch sinh máu tốt, máu tốt giúp Tim khỏe.'],

  ['Mật mía chanh + vận động (06:00)', 'tho', 'sáng', 'Uống trước khi vận động 30 phút để nạp năng lượng, chống mỏi cơ.',
   '~5 thìa canh mật mía · 250ml nước ấm · 1 lát chanh · (trời lạnh: thêm 1 lát gừng).',
   '1. Pha mật mía với nước ấm.\n2. Vắt chanh.\n3. Uống, rồi vỗ tay 4 nhịp / yoga / chạy bộ 30 phút — nơi nhiều oxy, chân tiếp đất, tắm nắng.',
   'Mỗi sáng trong 28 ngày, trước khi vận động.',
   'Đường tốt trong mật mía làm mát Lá Lách, tăng miễn dịch.'],

  ['Trà Bình Minh', 'kim,moc', 'sáng', 'Trà ấm buổi sáng — tốt cho Phổi, hỗ trợ tiêu hóa.',
   'Bột sắn dây 1 thìa · trà Bancha hoặc Shan Tuyết 1 túi · chanh muối 1 lát · cốt gừng hoặc 2 lát gừng tươi · mật mía 1 thìa · nước sôi 250ml.',
   '1. Hòa bột sắn dây với chút nước lạnh.\n2. Hãm trà với nước sôi 3 phút.\n3. Thêm bột sắn dây đã hòa, gừng, chanh muối, mật mía.\n4. Khuấy đều, uống ấm.',
   'Buổi sáng, đặc biệt mùa Thu khi hanh khô, dễ ho.',
   'Bột sắn dây và gừng đều tốt cho Phổi (Hành Kim).'],

  ['Trà gừng mật ong', 'kim', 'sáng', 'Dùng khi mới chớm cảm lạnh, người ớn lạnh.',
   '3–4 lát gừng tươi · 1–2 thìa mật ong · 200ml nước sôi.',
   '1. Cho gừng vào cốc, chế nước sôi, đậy 5 phút.\n2. Chờ nguội bớt còn ấm, thêm mật ong (không cho mật ong vào nước quá nóng).\n3. Uống khi còn ấm.',
   'Khi trời lạnh, chớm cảm, tay chân lạnh. KHÔNG dùng khi sốt cao, thể nhiệt, huyết áp cao.',
   'Gừng là vị cay nhiệt — làm ấm, phát tán phong hàn.'],

  ['Trà tim sen', 'hoa', 'sáng', 'Đắng hàn — hạ nhịp tim, hạ huyết áp, an thần dễ ngủ.',
   'Tim sen khô 1–2g (khoảng 1 nhúm nhỏ) · nước sôi 200ml.',
   '1. Tráng tim sen qua nước sôi, bỏ nước đầu.\n2. Hãm với nước sôi 5–7 phút.\n3. Uống ấm, buổi sáng đến đầu giờ chiều.',
   'Người thể nhiệt, huyết áp cao, nhịp tim nhanh, hay hồi hộp, khó ngủ. Không dùng cho người huyết áp thấp.',
   'Rất đắng — bắt đầu với lượng ít. Không uống quá muộn dù có tác dụng an thần.'],

  ['Mè đen rang muối', 'thuy', 'tối', 'Món ăn kèm cơm — bổ Thận, màu đen vị mặn nhẹ.',
   'Mè đen 100g · muối hạt 1 thìa cà phê.',
   '1. Rang mè đen lửa nhỏ, đảo đều đến khi nghe tiếng nổ lách tách và dậy mùi.\n2. Rang muối riêng cho khô.\n3. Giã sơ mè với muối (không quá nhuyễn).\n4. Rắc lên cơm gạo lứt.',
   'Bữa tối, đặc biệt mùa Đông. Người đau lưng, tiểu đêm, tóc bạc sớm.',
   'Bảo quản lọ kín, dùng trong 1 tuần.'],

  ['Canh chua lá giang', 'moc,tho', 'trưa', 'Canh vị chua cân bằng với ngọt — kích thích tiêu hóa bữa trưa.',
   'Lá giang 1 nắm · cá hoặc đậu hũ · cà chua 1 quả · thơm (dứa) vài miếng · giá, bạc hà · gia vị.',
   '1. Nấu nước dùng, cho cà chua và thơm.\n2. Cho cá/đậu hũ, nấu chín.\n3. Vò lá giang cho ra vị chua, thả vào.\n4. Nêm nếm cân bằng chua – ngọt, thêm giá và rau thơm.',
   'Bữa trưa, khi cần kích thích ăn ngon. Trời nóng.',
   'Vị chua vào Gan nhưng phải cân bằng với ngọt (thơm) để không hại Tỳ Vị.'],

  ['Rau muống xào tỏi', 'kim', 'tối', 'Món tối điển hình của Hành Kim — vị cay (tỏi) + màu trắng (thân rau).',
   'Rau muống 1 bó · tỏi 4–5 tép · dầu ăn · chút muối.',
   '1. Nhặt rau, chần sơ nước sôi có chút muối rồi vớt ra ngâm nước đá (giữ xanh giòn).\n2. Phi thơm tỏi băm.\n3. Cho rau vào xào lửa lớn nhanh tay, nêm vừa ăn.\n4. Rắc thêm tỏi phi.',
   'Bữa tối. Trời lạnh có thể thêm ớt.',
   'Tỏi là vị cay màu trắng — dẫn vào Phổi/Đại tràng.'],

  ['Nước mía (trước vận động)', 'tho', 'cả ngày', 'Làm mát Lá Lách, tăng miễn dịch, bù năng lượng nhanh.',
   'Nước mía tươi 1 ly (200–250ml) · vài lát tắc/quất (tùy chọn).',
   '1. Ép mía tươi, lọc bã.\n2. Uống ngay khi còn tươi, có thể thêm tắc cho đỡ ngọt gắt.',
   'Trước khi luyện tập / vận động để chống mỏi cơ do thiếu đường. Người cần tăng đề kháng.',
   'Uống ngay sau khi ép; để lâu dễ lên men, mất chất.'],
];

const COURSE_SEED = [
  ['Nền tảng Âm Dương Ngũ Hành',
   'Bắt đầu từ đây: Ngũ Hành – Ngũ Sắc – Ngũ Vị – Tạng Phủ và 3 nguyên tắc cân bằng Âm Dương trong bữa ăn.',
   '#10b981',
   [
     ['Ngũ Hành là gì — Kim, Mộc, Thủy, Hỏa, Thổ',
      '<p>Triết lý Âm Dương Ngũ Hành trong ẩm thực Việt đã có từ rất xa xưa — bánh phu thê ngũ sắc, bát phở đủ mùi vị màu sắc… đều là ứng dụng của nó.</p><h3>Năm Hành tương ứng năm tạng, năm màu</h3><ul><li><strong>Hành Mộc</strong> — Gan — màu Xanh</li><li><strong>Hành Hỏa</strong> — Tim — màu Đỏ</li><li><strong>Hành Thổ</strong> — Lá Lách / Dạ Dày — màu Vàng</li><li><strong>Hành Kim</strong> — Phổi — màu Trắng</li><li><strong>Hành Thủy</strong> — Thận — màu Đen</li></ul><p>Nguyên tắc Ngũ Sắc: mỗi bữa nên có đủ 5 màu Xanh – Đỏ – Vàng – Trắng – Đen. Thực phẩm khác màu có tác dụng khác nhau khi vào cơ thể.</p><blockquote>Đây là hướng dẫn ăn uống dưỡng sinh, không thay thế việc khám chữa bệnh.</blockquote>', 8],
     ['Ngũ Vị tương ứng Ngũ Hành và tạng phủ',
      '<p>Theo Đông Y, mỗi vị đi vào một tạng. Chuộng vị nào sẽ bổ cho tạng đó — nhưng quá nhiều sẽ hại tạng bị khắc.</p><table><thead><tr><th>Vị</th><th>Hành</th><th>Tạng</th></tr></thead><tbody><tr><td>Chua</td><td>Mộc</td><td>Can (Gan)</td></tr><tr><td>Đắng</td><td>Hỏa</td><td>Tâm (Tim)</td></tr><tr><td>Ngọt</td><td>Thổ</td><td>Tỳ (Lá Lách)</td></tr><tr><td>Cay</td><td>Kim</td><td>Phế (Phổi)</td></tr><tr><td>Mặn</td><td>Thủy</td><td>Thận</td></tr></tbody></table><p>Nhìn màu sắc rau quả có thể đoán tính: màu nhạt thường hàn/mát, màu thẫm thường ấm/nóng. Củ cải, lê, chuối tiêu tính mát; táo, đậu đen, đậu đỏ tính ấm.</p>', 8],
     ['3 nguyên tắc cân bằng Âm Dương trong ăn uống',
      '<p>Mối tương quan Âm Dương trong ẩm thực gồm 3 yếu tố:</p><ol><li><strong>Hài hòa âm dương của thức ăn:</strong> đa dạng màu sắc và vị trong một món / một bữa.</li><li><strong>Cân bằng âm dương trong cơ thể:</strong> cơ thể hàn thì ăn món tính ấm, vị cay; cơ thể nhiệt thì ăn món tính mát.</li><li><strong>Cân bằng với môi trường:</strong> tùy thời tiết, mùa, vùng miền mà chọn món. Trời lạnh → vị cay, trà gừng, mật mía gừng. Trời nóng → vị mát, nước dừa, rau má.</li></ol><p>Ví dụ khéo kết hợp: đậu hũ (hàn) xào sả ớt (nhiệt); củ hũ dừa (ngọt mát) trộn gỏi chua cay + đậu phộng rang (béo).</p>', 7],
     ['Tương sinh – Tương khắc – Tương thừa – Tương vũ',
      '<h3>Tương sinh</h3><p>Mộc sinh Hỏa → Hỏa sinh Thổ → Thổ sinh Kim → Kim sinh Thủy → Thủy sinh Mộc.</p><h3>Tương khắc</h3><p>Mộc khắc Thổ, Thổ khắc Thủy, Thủy khắc Hỏa, Hỏa khắc Kim, Kim khắc Mộc.</p><h3>Ứng dụng vào vị</h3><ul><li>Vị chua vào Gan, nhưng chua quá hại Tỳ Vị → luôn cân bằng chua với ngọt (canh chua, nước chanh đường).</li><li>Vị mặn vào Thận, mặn quá hại Tim và gây tích nước → dùng mặn buổi trưa, hạn chế buổi tối.</li><li>Vị cay vào Phổi, cay quá hại Gan (ra mồ hôi, hao huyết).</li><li>Vị đắng vào Tim, đắng quá hại Phổi/Ruột già.</li><li>Vị ngọt vào Tỳ, ngọt quá hại Thận.</li></ul>', 8],
   ]],

  ['Ăn theo từng Hành',
   'Mỗi Hành một bài: màu, vị dẫn, tạng phủ, mùa trong năm, thực phẩm nên dùng và những lưu ý tương sinh – tương khắc.',
   '#8b5cf6',
   [
     ['Hành Kim — Phổi / Đại tràng — màu Trắng, vị Cay',
      '<p>Hành Kim ứng Phổi và Đại tràng, quan hệ với da lông, biểu hiện ra mũi họng. Ưu tiên <strong>màu Trắng</strong> và <strong>vị Cay</strong>.</p><p><strong>Thực phẩm màu trắng:</strong> nấm, bông cải, bột sắn dây, hành tây, củ sắn, củ sen, đậu nành, cùi dừa, hạt điều, tỏi, sả, đậu trắng.</p><p><strong>Vị cay 2 thể:</strong> cay nhiệt (ớt, tiêu, quế, gừng, sả) và cay hàn (bạc hà, húng chanh).</p><p><strong>Mùa Thu</strong> là mùa của Kim — hanh khô, dễ ho khan, viêm mũi, viêm họng, táo bón. Nên dùng đường phèn trắng chưng chanh/tắc trị ho; trà có bột sắn dây + chanh muối + gừng + mật mía.</p><p>Người viêm xoang, đau đầu, da khô, mẩn ngứa nên thanh lọc Đại tràng (ăn nhiều rau, chất xơ).</p>', 9],
     ['Hành Thủy — Thận / Bàng quang — màu Đen, vị Mặn',
      '<p>Hành Thủy ứng Thận và Bàng quang, quan hệ với Xương, biểu hiện ra Tai. Ưu tiên <strong>màu Đen</strong> và <strong>vị Mặn</strong> (vừa phải).</p><p><strong>Thực phẩm màu đen:</strong> đậu đen, nho đen, tỏi đen, hải sâm, gạo lứt đen, mè đen, mộc nhĩ đen (nấm mèo), táo đen, gà ác, dâu tằm, trà đen.</p><p><strong>Món mặn:</strong> các loại dưa muối, cà muối, mè đen rang muối. Thức uống: mơ muối, chanh muối.</p><p>Vị mặn nhiều <strong>chỉ nên dùng buổi trưa</strong> — muối hút nước, tăng thể tích máu, ảnh hưởng giấc ngủ nếu dùng tối.</p><p><strong>Mùa Đông</strong> là mùa của Thủy — hàn, dễ nhức xương, đau lưng, mất ngủ, ù tai, tiểu đêm. Món tốt: gà ác tiềm, mì tiềm chay, hải sâm tiềm, muối mè đen.</p>', 9],
     ['Hành Mộc — Gan / Mật — màu Xanh, vị Chua',
      '<p>Hành Mộc ứng Gan và Mật, làm chủ Gân, biểu hiện ra Mắt. Ưu tiên <strong>màu Xanh</strong> và <strong>vị Chua</strong>.</p><p>Uống nước chanh gừng mật mía (hoặc mật ong) buổi sáng giúp thải độc Gan và rửa sạch hệ tiêu hóa. Để tốt cho Mật nên dùng chất béo tốt: các loại hạt, dầu ô liu, dầu dừa, mỡ cá.</p><p><strong>Thực phẩm màu xanh:</strong> các loại rau xanh, tảo spirulina, rong biển, đậu xanh.</p><p><strong>Vị chua:</strong> sấu, chanh, khế, lá me, lá giang, chùm ruột; dấm kefir, dấm kombucha, sữa chua.</p><p><strong>Mùa Xuân</strong> là mùa của Mộc — ẩm, gió lạnh. Buổi sáng ngủ dậy nên nghiêng sang phải rồi từ từ chống tay ngồi lên (Gan tàng huyết, tránh chóng mặt). Nóng Gan → lòng trắng mắt có tia máu đỏ.</p>', 9],
     ['Hành Hỏa — Tim / Ruột non — màu Đỏ, vị Đắng',
      '<p>Hành Hỏa ứng Tim và Ruột non, quan hệ Huyết Mạch, biểu hiện ra Lưỡi. Ưu tiên <strong>màu Đỏ</strong> và <strong>vị Đắng</strong>.</p><p>Lưỡi hồng = đủ máu; lưỡi nhạt = thiếu máu; lưỡi đóng cặn trắng = có thể nhiễm nấm Candida.</p><p><strong>Thực phẩm màu đỏ:</strong> rau dền, củ dền, lựu, gấc, ớt chuông, cà chua, kỷ tử.</p><p><strong>Vị đắng nhiệt:</strong> cà phê, ca cao. <strong>Vị đắng hàn:</strong> khổ qua, tim sen, ngải cứu, rau đắng, rau má.</p><p><strong>Chọn theo huyết áp:</strong> huyết áp thấp / nhịp tim thấp (thể hàn) → cà phê. Huyết áp cao / nhịp tim cao (thể nhiệt) → trà tim sen, trà khổ qua, rau má để hạ nhịp tim. Nên dùng trước 14:00; vị chua và đắng chỉ nên uống buổi sáng.</p><p><strong>Mùa Hè</strong> là mùa của Hỏa — nắng nóng, đổ mồ hôi nhiều, máu cô đặc. Uống nhiều nước, ăn nhiều trái cây, hạn chế đồ cay nóng.</p>', 10],
     ['Hành Thổ — Tỳ / Vị — màu Vàng, vị Ngọt',
      '<p>Hành Thổ ứng Tỳ (Lá Lách) và Vị (Bao Tử), quan hệ với Cơ, biểu hiện ra Môi. Ưu tiên <strong>màu Vàng</strong> và <strong>vị Ngọt</strong> (đường tốt).</p><p><strong>Thực phẩm màu vàng:</strong> khoai tây, bắp vàng, khế, ớt chuông vàng, bông bí, chuối, thơm (dứa), xoài, lê, trà hoa vàng.</p><p><strong>Đường tốt:</strong> đường vàng, mạch nha, mật ong, mật mía, đường thốt nốt, nước mía. Khác hẳn đường tinh luyện — đường tốt làm mát Lá Lách, tăng miễn dịch, giải độc máu.</p><p>Lá Lách tham gia chống nhiễm trùng, lọc vi khuẩn ở máu. Tỳ hư → sút cân, kém ăn, chậm tiêu, đầy hơi, tiêu chảy kéo dài, cơ nhão.</p><p><strong>Giao mùa Hè – Thu</strong> là thời của Thổ — nắng mưa thất thường, dễ bệnh hô hấp, dị ứng, cảm cúm. Tách trà hoa vàng, nước mía giúp Tuyến Tụy hoạt động tốt.</p>', 10],
     ['Vị Chát & thực phẩm chống oxy hóa',
      '<p>Ngoài ngũ vị, vị <strong>Chát</strong> giúp chống oxy hóa rất tốt, giữ sự tươi trẻ, hỗ trợ tim mạch.</p><p><strong>Thực phẩm vị chát:</strong> quả sung, chuối xanh, lựu, quả vả, trà, rượu vang chát.</p><p>Trà chia theo màu Ngũ Hành: bạch trà (Kim), hồng trà (Hỏa), trà đen (Thủy), trà xanh (Mộc), trà hoa vàng (Thổ). Vị chát trong trà giúp cơ thể chống oxy hóa cực tốt — văn hóa uống trà là một cách "trẻ hóa tự nhiên".</p><p>Món tham khảo: canh chuối xanh, canh sung, chuối xanh nấu tía tô.</p>', 6],
   ]],

  ['Hormone hạnh phúc theo mùa',
   'Tâm trạng khi ăn cũng quan trọng như món ăn. 4 hormone hạnh phúc và cách nương theo từng mùa để giữ cân bằng cảm xúc.',
   '#ec4899',
   [
     ['4 hormone hạnh phúc',
      '<ul><li><strong>Dopamine</strong> — hormone của động lực, kích hoạt khi bạn đạt được mục tiêu.</li><li><strong>Serotonin</strong> — điều hòa tâm trạng, tăng khi tiếp xúc ánh sáng mặt trời.</li><li><strong>Oxytocin</strong> — hormone tình yêu, tạo ra khi ôm người mình thương.</li><li><strong>Endorphin</strong> — thuốc giảm đau tự nhiên, đến từ vận động thể chất.</li></ul><p>Khi ăn, hãy tạm gác lo âu để cảm nhận trọn hương vị — đó cũng là một cách trải nghiệm điều thú vị của cuộc sống.</p>', 5],
     ['Mùa Thu (Kim) & mùa Đông (Thủy)',
      '<p><strong>Mùa Thu</strong>: ngày ngắn, nắng ít → não sản xuất ít Serotonin, nhiều Melatonin → dễ buồn, mệt mỏi, chán nản. Buồn làm hơi thở ngắn, Phổi thu hẹp. Nên ra ngoài hít thở không khí trong lành, hòa mình vào thiên nhiên, ra biển. Uống trà Bạc Kim buổi chiều tối kèm các loại hạt.</p><p><strong>Mùa Đông</strong>: lạnh, máu co cụm, tứ chi thiếu máu. Tuyến thượng thận tiết Adrenaline/Cortisol để giữ thăng bằng. Cách hỗ trợ: chơi thể thao, tập thở, bơi lội; tắt thiết bị điện tử, khép cửa và thở sâu trong yên lặng; chuyển suy nghĩ từ thụ động sang tích cực.</p>', 7],
     ['Mùa Xuân (Mộc), mùa Hè (Hỏa) & giao mùa (Thổ)',
      '<p><strong>Mùa Xuân</strong>: ngày dài, mắt tiếp xúc nhiều ánh sáng (kể cả ánh sáng xanh từ màn hình) → thay đổi nội tiết, dễ nóng giận. Uống trà xanh, trà mạn buổi sáng; tìm nơi thanh tịnh, thiền để cân bằng cảm xúc.</p><p><strong>Mùa Hè</strong>: nắng giúp cơ thể tiết beta-endorphin → vui vẻ hơn. Thời điểm tốt để vận động, tiếp xúc ánh nắng. Khóc cũng giúp thải Oxytocin và Endorphin, giảm đau và giải tỏa nỗi buồn. Dùng trà nóng vị đắng chát: trà tim sen, hồng trà.</p><p><strong>Giao mùa Hè – Thu (Thổ)</strong>: nhiệt độ thất thường, dễ mất ngủ, stress, đau bao tử. Tách trà hoa vàng, nước mía giúp thả lỏng và hỗ trợ Tuyến Tụy điều tiết Insulin.</p>', 7],
   ]],

  ['Tự kiểm tra cơ thể',
   'Đọc tín hiệu cơ thể mỗi ngày qua huyết áp, nước tiểu, phân và mồ hôi — để biết mình hàn hay nhiệt, đủ nước hay thiếu.',
   '#0ea5e9',
   [
     ['Đo & đọc huyết áp theo Đông Y',
      '<p>Huyết áp là "Khí" chứa trong cơ thể. Nên đo nhiều lần trong ngày: sáng khi ngủ dậy, trước ăn, sau ăn 30 phút, sau ăn 2 tiếng, trước khi ngủ.</p><p><strong>Đọc 3 số theo Đông Y:</strong></p><ul><li>Số 1 — Khí: cao hơn chuẩn = khí Thực, thấp hơn = khí Hư.</li><li>Số 2 — Huyết: cao hơn chuẩn = hở van tim, thấp hơn = hẹp van tim.</li><li>Số 3 — Nhịp tim: cao hơn chuẩn = Nhiệt, thấp hơn = Hàn.</li></ul><p>Cơ thể lạnh (hàn) → máu lưu thông kém → nhiều nơi bị tắc gây đau nhức. Nhịp tim quá cao có thể là sốt/viêm nhiễm.</p><blockquote>Chỉ số bất thường kéo dài → nên đi khám bác sĩ. Đây là công cụ theo dõi, không thay chẩn đoán y khoa.</blockquote>', 8],
     ['Màu nước tiểu',
      '<ul><li><strong>Vàng nhạt</strong> — bình thường, đủ nước.</li><li><strong>Trong suốt như nước lọc</strong> — uống quá nhiều nước, có thể mất chất điện giải (Thủy dập Hỏa, ảnh hưởng Tim).</li><li><strong>Vàng cam</strong> — uống quá ít nước, hoặc vấn đề túi Mật / Gan.</li><li><strong>Nâu sẫm như nước trà</strong> — mất nước ngoài da, hoặc tác dụng phụ của thuốc; kéo dài → lưu ý bệnh Gan.</li><li><strong>Trắng đục</strong> — có thể nhiễm trùng đường tiết niệu, bệnh thận.</li><li><strong>Hồng đỏ</strong> — đôi khi do ăn củ dền, nếp cẩm; nếu kéo dài → đi khám (tiểu máu, sỏi thận…).</li></ul>', 6],
     ['Phân (bảng Bristol) & mồ hôi',
      '<p><strong>Phân</strong> tốt: hình trụ dài, màu vàng — chế độ ăn lành mạnh. Đi ngoài nhiều nước → có thể viêm dạ dày ruột cấp, khó tiêu.</p><ul><li>Màu đất trắng xám — dấu hiệu bệnh Gan.</li><li>Màu đen — khả năng xuất huyết tiêu hóa.</li><li>Mùi tanh khó chịu đột ngột kèm phân đen — cần đi khám.</li></ul><p><strong>Mồ hôi</strong>: nặng mùi = đang stress nặng; vị mặn nhiều = cơ thể thiếu muối/điện giải. Sau khi tập thể thao nên bổ sung chất điện giải.</p>', 6],
   ]],

  ['Công thức nền tảng',
   'Những món nên biết trong 28 ngày: cháo bổ âm, trà Bình Minh, nước chanh gừng mật mía, cách dùng gừng và trà dưỡng sinh theo Ngũ Hành.',
   '#ef4444',
   [
     ['Cháo bổ âm — khi nào dùng, cách nấu',
      '<p><strong>Dùng khi:</strong> cơ thể nhiệt, khô, mất ngủ, người mệt, sau khi ăn nhiều đồ cay nóng.</p><p><strong>Cách nấu:</strong> nấu gạo (ưu tiên gạo lứt) thật nhừ, loãng. Có thể thêm hạt sen, đậu xanh/đậu đen, bí đỏ. Nêm nhạt.</p><p><strong>Cách ăn:</strong> ăn ấm, <strong>nhai kỹ</strong> để nước bọt (ngọc dịch) thấm vào ruột non — giúp tạo máu và làm dịu cơ thể. Ăn trong tâm trạng thư giãn.</p>', 6],
     ['Trà Bình Minh & nước chanh gừng mật mía',
      '<p><strong>Trà Bình Minh:</strong> bột sắn dây + trà Bancha hoặc Shan Tuyết + chanh muối + cốt gừng (hoặc 2 lát gừng tươi) + mật mía. Tốt cho Phổi, ấm người buổi sáng.</p><p><strong>Nước chanh gừng mật mía (buổi sáng, bụng đói):</strong> 1 lát chanh có hạt + vài lát gừng + 1 thìa mật mía + nước ấm. Giúp thải độc Gan, rửa hệ tiêu hóa. Trời lạnh tăng gừng; thể nhiệt / huyết áp cao thì giảm gừng.</p><p><strong>Mật mía chanh (06:00):</strong> ~5 thìa mật mía + 250ml nước ấm + 1 lát chanh, uống trước khi vận động 30 phút.</p>', 6],
     ['Cách dùng gừng — cay nhiệt vs cay hàn',
      '<p>Gừng thuộc <strong>vị cay nhiệt</strong>: làm ấm cơ thể, tốt khi trời lạnh hoặc người thể hàn (tay chân lạnh, sợ lạnh, nhịp tim thấp).</p><ul><li>Thêm 1 lát gừng vào mật mía chanh buổi sáng khi trời lạnh.</li><li>Trà gừng mật ong khi mới chớm cảm lạnh.</li><li>Vài lát gừng khi ăn sáng nếu thời tiết lạnh.</li></ul><p><strong>Hạn chế gừng</strong> nếu: thể nhiệt (hay nóng, khát, táo bón), huyết áp cao, đang có mụn nhọt, ra mồ hôi nhiều. Khi đó dùng vị cay hàn thay thế: bạc hà, húng chanh.</p>', 6],
     ['Trà tim sen & trà dưỡng sinh theo Ngũ Hành',
      '<p><strong>Trà tim sen:</strong> vị đắng hàn — hạ nhịp tim, hạ huyết áp, an thần dễ ngủ. Dùng cho người thể nhiệt, huyết áp cao, hay hồi hộp. Uống buổi sáng đến đầu giờ chiều, không uống quá muộn.</p><p><strong>Trà theo màu Ngũ Hành:</strong></p><ul><li>Bạch trà (Kim) — nhẹ, tốt cho Phổi</li><li>Trà xanh (Mộc) — thanh Gan, tỉnh táo, dùng buổi sáng</li><li>Hồng trà (Hỏa) — ấm, vị đắng chát nhẹ</li><li>Trà đen (Thủy) — đậm, bổ Thận</li><li>Trà hoa vàng (Thổ) — dịu, hỗ trợ Tỳ Vị</li></ul><p>Tránh trà đậm buổi tối để không ảnh hưởng giấc ngủ.</p>', 6],
   ]],
];

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  const SQL = await initSqlJs();
  const db  = new DB(SQL);

  db.exec(SCHEMA);

  // Legacy single-key storage (admin_secrets, from before multi-provider support) — only
  // read once below to seed ai_providers on first boot, not used at runtime after that.
  function getOpenRouterKey() {
    const row = db.get("SELECT value FROM admin_secrets WHERE key = 'openrouter_api_key'");
    return (row && row.value) || OPENROUTER_KEY;
  }

  // One-time migration: turn whatever OpenRouter key was already configured (admin_secrets
  // or .env) into the first ai_providers row, so switching to the multi-provider model doesn't
  // interrupt the 3 AI features on an already-running deployment.
  if (db.get('SELECT COUNT(*) AS n FROM ai_providers').n === 0) {
    const legacyKey = getOpenRouterKey();
    if (legacyKey) {
      db.run(
        'INSERT INTO ai_providers (name, provider_type, api_key, model, is_active) VALUES (?,?,?,?,1)',
        ['OpenRouter (mặc định)', 'openrouter', legacyKey, 'google/gemini-2.5-flash']
      );
      console.log('  Migrated legacy OpenRouter key into ai_providers.');
    }
  }

  function getActiveAiProvider() {
    return db.get('SELECT * FROM ai_providers WHERE is_active = 1 LIMIT 1') || null;
  }

  function maskKey(key) {
    if (!key || key.length <= 8) return '****';
    return `${key.slice(0, 5)}...${key.slice(-4)}`;
  }

  // ── GoClaw Agent 1 ("An Lộ") webhook ────────────────────────
  // Calls the LLM webhook (mode=sync) created on the GoClaw dashboard for the
  // Thân-Tâm-Mệnh roadmap-drafting agent. Bearer auth (webhook has
  // require_hmac=false) — simplest, no signing needed. Returns { ok, text, error }.
  const GOCLAW_BASE_URL = process.env.GOCLAW_BASE_URL || 'https://agent.dienvienduong.com';
  const GOCLAW_WEBHOOK_SECRET = process.env.GOCLAW_WEBHOOK_SECRET || '';

  const THE_TRANG_VALUES = ['Nhiệt', 'Hàn', 'Hàn giả nhiệt', 'Nhiệt giả hàn'];

  async function callGoclawAgent1(summaryText) {
    if (!GOCLAW_WEBHOOK_SECRET) {
      return { ok: false, error: 'Chưa cấu hình GOCLAW_WEBHOOK_SECRET trong .env' };
    }
    try {
      const wrappedInput = `[YÊU CẦU BỔ SUNG] Trước khi viết lộ trình, hãy xác định thể trạng của khách hàng dựa trên các dấu hiệu Hàn/Nhiệt trong bảng trả lời dưới đây (tay chân lạnh/ấm, sợ lạnh/sợ nóng, ra mồ hôi, màu nước tiểu, rêu lưỡi, nhiệt miệng, v.v.). Xác định là MỘT trong 4 loại: Nhiệt, Hàn, Hàn giả nhiệt, hoặc Nhiệt giả hàn.
Dòng ĐẦU TIÊN của câu trả lời PHẢI là: THE_TRANG: <một trong 4 loại trên>
Sau đó xuống dòng và viết lộ trình như bình thường, có điều chỉnh dinh dưỡng/sinh hoạt phù hợp với thể trạng đã xác định.

[BẢN TỔNG KẾT KHẢO SÁT]
${summaryText}`;
      const body = JSON.stringify({ input: wrappedInput, mode: 'sync' });

      const resp = await fetch(`${GOCLAW_BASE_URL}/v1/webhooks/llm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GOCLAW_WEBHOOK_SECRET}`,
        },
        body,
        signal: AbortSignal.timeout(35000), // webhook sync mode itself times out at 30s
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data) {
        return { ok: false, error: (data && data.error) || `GoClaw webhook lỗi (HTTP ${resp.status})` };
      }
      return { ok: true, text: data.output || '' };
    } catch (err) {
      return { ok: false, error: `Không gọi được GoClaw: ${err.message}` };
    }
  }

  // ── GoClaw Agent 2 ("Đồng hành & Thúc đẩy lối sống") webhook ─
  // Same shape as callGoclawAgent1 but talks to a separate GoClaw agent/webhook
  // configured for daily meal-log coaching. Kept as its own const/secret so the
  // two agents can be rotated/disabled independently.
  const GOCLAW_AGENT2_WEBHOOK_SECRET = process.env.GOCLAW_AGENT2_WEBHOOK_SECRET || '';

  async function callGoclawAgent2(summaryText) {
    if (!GOCLAW_AGENT2_WEBHOOK_SECRET) {
      return { ok: false, error: 'Chưa cấu hình GOCLAW_AGENT2_WEBHOOK_SECRET trong .env' };
    }
    try {
      const body = JSON.stringify({ input: summaryText, mode: 'sync' });

      const resp = await fetch(`${GOCLAW_BASE_URL}/v1/webhooks/llm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GOCLAW_AGENT2_WEBHOOK_SECRET}`,
        },
        body,
        signal: AbortSignal.timeout(35000),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data) {
        return { ok: false, error: (data && data.error) || `GoClaw webhook lỗi (HTTP ${resp.status})` };
      }
      return { ok: true, text: data.output || '' };
    } catch (err) {
      return { ok: false, error: `Không gọi được GoClaw: ${err.message}` };
    }
  }

  // Agent 2 is instructed (see its AGENTS.md) to always answer in the form:
  //   FLAG: none|warning|urgent
  //   REASON: <short reason, blank if none>
  //   ---
  //   <customer-facing comment>
  // Parsed defensively — if the model drifts from the format, we fall back to
  // flag_level='none' and use the raw text as the feedback rather than losing it.
  // Robust on purpose: in practice the model doesn't reliably put FLAG/REASON
  // at the very start, or use "---" as the separator (seen: feedback text
  // first, then "FLAG:.../REASON:..." at the end after a "***" line). Rather
  // than requiring an exact anchored shape, find FLAG/REASON anywhere in the
  // text and strip them out (plus any --- / *** / ___ separator lines) so
  // the customer never sees the raw metadata.
  // Agent 1 ("An Lộ") được yêu cầu (trong wrappedInput ở callGoclawAgent1, và lý tưởng là cả trong
  // prompt cấu hình bên GoClaw) trả về dòng đầu THE_TRANG: <loại>. Parse robust như Agent 2: tìm marker
  // ở bất kỳ đâu trong text, không yêu cầu đúng vị trí — nếu agent không tuân thủ format thì trả về
  // theTrang=null thay vì làm hỏng nội dung lộ trình.
  function parseAgent1Response(raw) {
    const text = (raw || '').trim();
    const match = text.match(/THE_TRANG:\s*([^\n]+)/i);
    let theTrang = null;
    if (match) {
      const val = match[1].trim();
      theTrang = THE_TRANG_VALUES.find(v => v.toLowerCase() === val.toLowerCase()) || null;
    }
    const content = text
      .replace(/^\s*THE_TRANG:.*$/im, '')
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { theTrang, content };
  }

  function parseAgent2Response(raw) {
    const text = (raw || '').trim();
    const flagMatch = text.match(/FLAG:\s*(none|warning|urgent)/i);
    const reasonMatch = text.match(/REASON:\s*([^\n]*)/i);
    const feedback = text
      .replace(/^\s*FLAG:.*$/im, '')
      .replace(/^\s*REASON:.*$/im, '')
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      flagLevel: flagMatch ? flagMatch[1].toLowerCase() : 'none',
      flaggedReason: reasonMatch ? reasonMatch[1].trim() : '',
      feedback,
    };
  }

  // ── Telegram Bot API ──────────────────────────────────────────
  // Outbound push only (reminders + Agent 2 feedback + admin alerts). The only
  // inbound handling is the /start <code> account-link command (see the
  // /api/telegram/webhook route below) — customers don't free-chat with the bot.
  const TELEGRAM_BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN    || '';
  const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';

  async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false };
    try {
      const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(15000),
      });
      return await resp.json().catch(() => ({ ok: false }));
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // Unified chat call across providers. `messages` is OpenAI-style [{role, content}] (role:
  // system/user/assistant) — the shape every caller already builds. Returns a normalized
  // { ok, text, truncated, error } regardless of which provider actually served the request.
  async function callAiChat({ messages, maxTokens, disableReasoning = false }) {
    const provider = getActiveAiProvider();
    if (!provider) return { ok: false, error: 'Chưa cấu hình API AI. Vào Cài đặt > AI để thêm.' };

    if (provider.provider_type === 'google_ai_studio') {
      return callGoogleAiStudio({ provider, messages, maxTokens, disableReasoning });
    }
    return callOpenRouterChat({ provider, messages, maxTokens, disableReasoning });
  }

  async function callOpenRouterChat({ provider, messages, maxTokens, disableReasoning }) {
    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
          'HTTP-Referer': SITE_URL,
          'X-Title': COMMUNITY_NAME_ASCII,
        },
        body: JSON.stringify({
          model: provider.model || 'google/gemini-2.5-flash',
          max_tokens: maxTokens,
          ...(disableReasoning ? { reasoning: { enabled: false } } : {}),
          messages,
        }),
      });
      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error('[AI/OpenRouter] error:', apiRes.status, errText);
        return { ok: false, error: 'AI service error' };
      }
      const data = await apiRes.json();
      const choice = data.choices?.[0];
      return { ok: true, text: choice?.message?.content || '', truncated: choice?.finish_reason === 'length' };
    } catch (err) {
      console.error('[AI/OpenRouter] Error:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async function callGoogleAiStudio({ provider, messages, maxTokens, disableReasoning }) {
    // 'gemini-2.5-flash' (dated model) has been restricted for new API keys/projects by
    // Google ("no longer available to new users") — the -latest alias always points to
    // whatever flash model Google currently supports, avoiding this going stale again.
    const model = provider.model || 'gemini-flash-latest';
    const systemMsg = messages.find(m => m.role === 'system');
    const turns = messages.filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body = {
      contents: turns,
      generationConfig: {
        maxOutputTokens: maxTokens,
        // thinkingConfig.thinkingBudget:0 (the Gemini 2.5-era way to disable thinking) is
        // rejected as INVALID_ARGUMENT on newer models — confirmed against the real key/model
        // in production that thinkingLevel:"LOW" is what actually drives thinking tokens to 0
        // now ("NONE" is rejected too).
        ...(disableReasoning ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}),
      },
    };
    if (systemMsg) body.system_instruction = { parts: [{ text: systemMsg.content }] };

    try {
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.api_key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error('[AI/GoogleAIStudio] error:', apiRes.status, errText);
        return { ok: false, error: 'AI service error' };
      }
      const data = await apiRes.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
      return { ok: true, text, truncated: candidate?.finishReason === 'MAX_TOKENS' };
    } catch (err) {
      console.error('[AI/GoogleAIStudio] Error:', err.message);
      return { ok: false, error: err.message };
    }
  }

  // Migrate challenge_days: add challenge_id + instructions if missing
  const cdCols = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols.includes('challenge_id')) {
    db.exec(`CREATE TABLE challenge_days_v2 (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id   INTEGER NOT NULL DEFAULT 1,
      day_number     INTEGER NOT NULL,
      title          TEXT    NOT NULL,
      description    TEXT,
      instructions   TEXT,
      xp_reward      INTEGER DEFAULT 5,
      duration_hours INTEGER DEFAULT 24,
      UNIQUE(challenge_id, day_number)
    )`);
    const oldDays = db.all('SELECT * FROM challenge_days');
    oldDays.forEach(r => db.run(
      'INSERT INTO challenge_days_v2 (id, challenge_id, day_number, title, description, xp_reward) VALUES (?,1,?,?,?,?)',
      [r.id, r.day_number, r.title, r.description, r.xp_reward]
    ));
    db.exec('DROP TABLE challenge_days');
    db.exec('ALTER TABLE challenge_days_v2 RENAME TO challenge_days');
    console.log('  Migrated challenge_days (added challenge_id + instructions).');
  } else if (!cdCols.includes('instructions')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN instructions TEXT');
  }
  // Migrate duration_hours regardless of which branch above ran
  const cdCols2 = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols2.includes('duration_hours')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN duration_hours INTEGER DEFAULT 24');
    console.log('  Migrated challenge_days: added duration_hours.');
  }
  const cdCols3 = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols3.includes('submission_deadline')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN submission_deadline TEXT');
    console.log('  Migrated challenge_days: added submission_deadline.');
  }
  const cdCols4 = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols4.includes('intro')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN intro TEXT');
    console.log('  Migrated challenge_days: added intro.');
  }

  // Migrate comments: add parent_id for nested replies
  const cmtCols = db.all('PRAGMA table_info(comments)').map(c => c.name);
  if (!cmtCols.includes('parent_id')) {
    db.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id)');
    console.log('  Migrated comments: added parent_id.');
  }

  // Migrate orders: add email-sent flags for drip campaigns
  const ordCols = db.all('PRAGMA table_info(orders)').map(c => c.name);
  if (!ordCols.includes('mail_15m')) {
    db.exec('ALTER TABLE orders ADD COLUMN mail_15m INTEGER DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN mail_1d  INTEGER DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN mail_2d  INTEGER DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN mail_4d  INTEGER DEFAULT 0');
    console.log('  Migrated orders: added email drip flag columns.');
  }

  // Migrate challenge_submissions: add is_late flag
  const subCols = db.all('PRAGMA table_info(challenge_submissions)').map(c => c.name);
  if (!subCols.includes('is_late')) {
    db.exec('ALTER TABLE challenge_submissions ADD COLUMN is_late INTEGER DEFAULT 0');
    console.log('  Migrated challenge_submissions: added is_late.');
  }

  // Migrate notifications: add title, link, sent_by_admin
  const notifCols = db.all('PRAGMA table_info(notifications)').map(c => c.name);
  if (!notifCols.includes('title')) {
    db.exec('ALTER TABLE notifications ADD COLUMN title TEXT');
    console.log('  Migrated notifications: added title.');
  }
  if (!notifCols.includes('link')) {
    db.exec('ALTER TABLE notifications ADD COLUMN link TEXT');
    console.log('  Migrated notifications: added link.');
  }
  if (!notifCols.includes('sent_by_admin')) {
    db.exec('ALTER TABLE notifications ADD COLUMN sent_by_admin INTEGER DEFAULT 0');
    console.log('  Migrated notifications: added sent_by_admin.');
  }

  // Migrate users: add intake_profile
  const userCols = db.all('PRAGMA table_info(users)').map(c => c.name);
  if (!userCols.includes('intake_profile')) {
    db.exec('ALTER TABLE users ADD COLUMN intake_profile TEXT');
    db.exec('ALTER TABLE users ADD COLUMN intake_done_at TEXT');
    console.log('  Migrated users: added intake_profile.');
  }
  // Migrate users: add ttm_intake_done_at (Thân-Tâm-Mệnh intake — dùng để
  // bắt buộc redirect khách mới chưa làm khảo sát 29 câu trước khi dùng site)
  if (!userCols.includes('ttm_intake_done_at')) {
    db.exec('ALTER TABLE users ADD COLUMN ttm_intake_done_at TEXT');
    console.log('  Migrated users: added ttm_intake_done_at.');
  }
  // Migrate users: add Telegram link fields (Agent 2 coaching — reminders,
  // meal-log feedback, admin escalation alerts are pushed via Telegram)
  if (!userCols.includes('telegram_chat_id')) {
    db.exec('ALTER TABLE users ADD COLUMN telegram_chat_id TEXT');
    db.exec('ALTER TABLE users ADD COLUMN telegram_link_code TEXT');
    db.exec('ALTER TABLE users ADD COLUMN telegram_link_code_expires_at TEXT');
    console.log('  Migrated users: added telegram_chat_id + link code fields.');
  }

  // Migrate meal_logs: add Agent 2 AI feedback + warning-flag fields
  const mealLogCols = db.all('PRAGMA table_info(meal_logs)').map(c => c.name);
  if (!mealLogCols.includes('ai_feedback')) {
    db.exec('ALTER TABLE meal_logs ADD COLUMN ai_feedback TEXT');
    db.exec("ALTER TABLE meal_logs ADD COLUMN flag_level TEXT");
    db.exec('ALTER TABLE meal_logs ADD COLUMN flagged_reason TEXT');
    db.exec('ALTER TABLE meal_logs ADD COLUMN agent2_notified_at TEXT');
    db.exec('ALTER TABLE meal_logs ADD COLUMN admin_notified_at TEXT');
    console.log('  Migrated meal_logs: added ai_feedback + flag fields.');
  }

  // Migrate posts: add space_id
  const postCols = db.all('PRAGMA table_info(posts)').map(c => c.name);
  if (!postCols.includes('space_id')) {
    db.exec('ALTER TABLE posts ADD COLUMN space_id INTEGER REFERENCES spaces(id)');
    console.log('  Migrated posts: added space_id.');
  }
  // Migrate posts: add topic_id + rich embed fields (image/video/doc/gif links, poll)
  if (!postCols.includes('topic_id')) {
    db.exec('ALTER TABLE posts ADD COLUMN topic_id INTEGER REFERENCES topics(id)');
    console.log('  Migrated posts: added topic_id.');
  }
  if (!postCols.includes('image_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN image_url TEXT');
    console.log('  Migrated posts: added image_url.');
  }
  if (!postCols.includes('video_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN video_url TEXT');
    console.log('  Migrated posts: added video_url.');
  }
  if (!postCols.includes('doc_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN doc_url TEXT');
    console.log('  Migrated posts: added doc_url.');
  }
  if (!postCols.includes('gif_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN gif_url TEXT');
    console.log('  Migrated posts: added gif_url.');
  }
  if (!postCols.includes('poll_question')) {
    db.exec('ALTER TABLE posts ADD COLUMN poll_question TEXT');
    console.log('  Migrated posts: added poll_question.');
  }
  if (!postCols.includes('poll_options')) {
    db.exec('ALTER TABLE posts ADD COLUMN poll_options TEXT');
    console.log('  Migrated posts: added poll_options.');
  }

  // Migrate courses: add space_id (course shows in a member's sidebar only if they belong to this space)
  const courseCols = db.all('PRAGMA table_info(courses)').map(c => c.name);
  if (!courseCols.includes('space_id')) {
    db.exec('ALTER TABLE courses ADD COLUMN space_id INTEGER REFERENCES spaces(id)');
    console.log('  Migrated courses: added space_id.');
  }

  // Migrate courses: add group_id (attach a course to a whole Space Group instead of a single Space —
  // anyone approved in ANY space under that group can see the course)
  if (!courseCols.includes('group_id')) {
    db.exec('ALTER TABLE courses ADD COLUMN group_id INTEGER REFERENCES space_groups(id)');
    console.log('  Migrated courses: added group_id.');
  }

  // Migrate courses: add visibility (public = enroll instantly, private = must pay via a linked product)
  if (!courseCols.includes('visibility')) {
    db.exec("ALTER TABLE courses ADD COLUMN visibility TEXT DEFAULT 'public'");
    console.log('  Migrated courses: added visibility.');
  }
  if (!courseCols.includes('price')) {
    db.exec('ALTER TABLE courses ADD COLUMN price INTEGER DEFAULT 0');
    console.log('  Migrated courses: added price.');
  }
  if (!courseCols.includes('compare_price')) {
    db.exec('ALTER TABLE courses ADD COLUMN compare_price INTEGER DEFAULT 0');
    console.log('  Migrated courses: added compare_price.');
  }

  // Migrate products: add course_id — a product can represent the paid checkout for a private course.
  // Completing this product's order auto-enrolls the buyer into the course.
  const productCols = db.all('PRAGMA table_info(products)').map(c => c.name);
  if (!productCols.includes('course_id')) {
    db.exec('ALTER TABLE products ADD COLUMN course_id INTEGER REFERENCES courses(id)');
    console.log('  Migrated products: added course_id.');
  }
  if (!productCols.includes('compare_price')) {
    db.exec('ALTER TABLE products ADD COLUMN compare_price INTEGER DEFAULT 0');
    console.log('  Migrated products: added compare_price.');
  }
  if (!productCols.includes('detail_url')) {
    db.exec('ALTER TABLE products ADD COLUMN detail_url TEXT');
    console.log('  Migrated products: added detail_url.');
  }
  if (!productCols.includes('is_featured')) {
    db.exec('ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0');
    console.log('  Migrated products: added is_featured.');
  }

  // Migrate course_lessons: add status (draft/published, independent from the parent course's status)
  const lessonCols = db.all('PRAGMA table_info(course_lessons)').map(c => c.name);
  if (!lessonCols.includes('status')) {
    db.exec("ALTER TABLE course_lessons ADD COLUMN status TEXT DEFAULT 'published'");
    console.log('  Migrated course_lessons: added status.');
  }

  // Migrate course_lessons: add module_id (groups lessons into modules/chapters)
  if (!lessonCols.includes('module_id')) {
    db.exec('ALTER TABLE course_lessons ADD COLUMN module_id INTEGER REFERENCES course_modules(id)');
    console.log('  Migrated course_lessons: added module_id.');
  }

  // Migrate course_lessons: add AI-graded exercise fields
  if (!lessonCols.includes('exercise_enabled')) {
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_enabled INTEGER DEFAULT 0');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_prompt TEXT');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_rubric TEXT');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_max_score INTEGER DEFAULT 100');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_pass_score INTEGER DEFAULT 70');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_xp_reward INTEGER DEFAULT 0');
    console.log('  Migrated course_lessons: added AI exercise fields.');
  }

  // Migrate course_lessons: add exercise_type ('text' = AI-graded free text, 'quiz' = auto-graded multiple choice)
  if (!lessonCols.includes('exercise_type')) {
    db.exec("ALTER TABLE course_lessons ADD COLUMN exercise_type TEXT DEFAULT 'text'");
    console.log('  Migrated course_lessons: added exercise_type.');
  }

  // Migrate lesson_exercise_submissions: add teacher workflow fields (resubmit request / manual final grade)
  const lesCols = db.all('PRAGMA table_info(lesson_exercise_submissions)').map(c => c.name);
  if (!lesCols.includes('status')) {
    db.exec("ALTER TABLE lesson_exercise_submissions ADD COLUMN status TEXT DEFAULT 'graded'");
    db.exec('ALTER TABLE lesson_exercise_submissions ADD COLUMN teacher_note TEXT');
    console.log('  Migrated lesson_exercise_submissions: added status, teacher_note.');
  }

  // Migrate course_lessons: link to a shared IELTS test-bank entry (ielts_tests), replacing
  // the ad-hoc exercise_* fields for that lesson when set — see server.js docs near the submit endpoint.
  if (!lessonCols.includes('ielts_test_id')) {
    db.exec('ALTER TABLE course_lessons ADD COLUMN ielts_test_id INTEGER REFERENCES ielts_tests(id)');
    console.log('  Migrated course_lessons: added ielts_test_id.');
  }

  // Migrate lesson_exercise_submissions: add IELTS Writing band-score feedback (null unless
  // the graded exercise is an attached IELTS Writing test)
  if (!lesCols.includes('ielts_band_feedback')) {
    db.exec('ALTER TABLE lesson_exercise_submissions ADD COLUMN ielts_band_feedback TEXT');
    console.log('  Migrated lesson_exercise_submissions: added ielts_band_feedback.');
  }

  // Migrate ielts_tests: add chatgpt_url for the Speaking skill (link students open to
  // practice speaking with an AI chatbot). Listening reuses the existing `passages` JSON
  // column — each passage gets an optional video_url instead of body_html.
  const ieltsTestCols = db.all('PRAGMA table_info(ielts_tests)').map(c => c.name);
  if (!ieltsTestCols.includes('chatgpt_url')) {
    db.exec('ALTER TABLE ielts_tests ADD COLUMN chatgpt_url TEXT');
    console.log('  Migrated ielts_tests: added chatgpt_url.');
  }

  // Migrate users: add is_admin (community-level admin, separate from ADMIN_KEY back office)
  const userCols2 = db.all('PRAGMA table_info(users)').map(c => c.name);
  if (!userCols2.includes('is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
    console.log('  Migrated users: added is_admin.');
  }

  // Migrate users: add editable profile fields (bio, location, social_links as JSON)
  if (!userCols2.includes('bio')) {
    db.exec('ALTER TABLE users ADD COLUMN bio TEXT');
    db.exec('ALTER TABLE users ADD COLUMN location TEXT');
    db.exec('ALTER TABLE users ADD COLUMN social_links TEXT');
    console.log('  Migrated users: added bio, location, social_links.');
  }
  if (!userCols2.includes('phone')) {
    db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    console.log('  Migrated users: added phone.');
  }

  // Migrate users: add admin_pin_hash (2nd factor PIN for community admins logging into admin.html)
  if (!userCols2.includes('admin_pin_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN admin_pin_hash TEXT');
    console.log('  Migrated users: added admin_pin_hash.');
  }

  // Migrate spaces: add group_id, backfill a default group for ungrouped spaces
  const spaceCols = db.all('PRAGMA table_info(spaces)').map(c => c.name);
  if (!spaceCols.includes('group_id')) {
    db.exec('ALTER TABLE spaces ADD COLUMN group_id INTEGER REFERENCES space_groups(id)');
    console.log('  Migrated spaces: added group_id.');
  }
  const ungroupedCount = db.get('SELECT COUNT(*) AS n FROM spaces WHERE group_id IS NULL').n;
  if (ungroupedCount > 0) {
    let defaultGroup = db.get("SELECT id FROM space_groups WHERE name = 'Chung'");
    if (!defaultGroup) {
      const r = db.run("INSERT INTO space_groups (name, order_num) VALUES ('Chung', 0)");
      defaultGroup = { id: r.lastInsertRowid };
    }
    db.run('UPDATE spaces SET group_id = ? WHERE group_id IS NULL', [defaultGroup.id]);
    console.log(`  Migrated ${ungroupedCount} ungrouped space(s) into default group "Chung".`);
  }
  if (!spaceCols.includes('allow_join_requests')) {
    db.exec('ALTER TABLE spaces ADD COLUMN allow_join_requests INTEGER DEFAULT 1');
    console.log('  Migrated spaces: added allow_join_requests.');
  }

  // Migrate ttm_roadmaps: add reviewed_by (ai đã duyệt/từ chối lộ trình)
  const ttmRoadmapCols = db.all('PRAGMA table_info(ttm_roadmaps)').map(c => c.name);
  if (!ttmRoadmapCols.includes('reviewed_by')) {
    db.exec('ALTER TABLE ttm_roadmaps ADD COLUMN reviewed_by INTEGER REFERENCES users(id)');
    console.log('  Migrated ttm_roadmaps: added reviewed_by.');
  }
  if (!ttmRoadmapCols.includes('the_trang')) {
    db.exec('ALTER TABLE ttm_roadmaps ADD COLUMN the_trang TEXT');
    console.log('  Migrated ttm_roadmaps: added the_trang.');
  }

  // Migrate program377_reports: thêm cột AI feedback (An Nhiên nhận xét thay đổi sức khỏe
  // dựa trên hồ sơ/lộ trình + báo cáo hằng ngày — tab "Kết quả" ở trang khách).
  const p377ReportCols = db.all('PRAGMA table_info(program377_reports)').map(c => c.name);
  ['ai_feedback', 'flag_level', 'flagged_reason', 'agent2_notified_at'].forEach((col) => {
    if (!p377ReportCols.includes(col)) {
      db.exec(`ALTER TABLE program377_reports ADD COLUMN ${col} TEXT`);
      console.log(`  Migrated program377_reports: added ${col}.`);
    }
  });

  // Migrate ttm_body_photos: add drive_folder_id (mỗi user 1 thư mục Drive riêng, tái dùng lần sau)
  const ttmPhotoCols = db.all('PRAGMA table_info(ttm_body_photos)').map(c => c.name);
  if (!ttmPhotoCols.includes('drive_folder_id')) {
    db.exec('ALTER TABLE ttm_body_photos ADD COLUMN drive_folder_id TEXT');
    console.log('  Migrated ttm_body_photos: added drive_folder_id.');
  }

  // Migrate ttm_body_photos: link ảnh cũ dùng dạng "uc?export=view" (đôi khi trả HTML thay vì ảnh
  // thật khi nhúng trên trình duyệt) — đổi sang endpoint thumbnail chính thức của Drive, ổn định hơn.
  ['front_url', 'back_url', 'side_url'].forEach((col) => {
    const rows = db.all(`SELECT user_id, ${col} AS url FROM ttm_body_photos WHERE ${col} LIKE '%uc?export=view%'`);
    rows.forEach((r) => {
      const fixed = r.url.replace(/https:\/\/drive\.google\.com\/uc\?export=view&id=([^&]+)/, 'https://drive.google.com/thumbnail?id=$1&sz=w1000');
      db.run(`UPDATE ttm_body_photos SET ${col} = ? WHERE user_id = ?`, [fixed, r.user_id]);
    });
    if (rows.length) console.log(`  Migrated ttm_body_photos.${col}: ${rows.length} link(s) đổi sang thumbnail endpoint.`);
  });

  // Migrate program377_days: video_url admin dán dạng watch/live/shorts (bị YouTube chặn nhúng
  // iframe) -> đổi sang dạng embed. normalizeEmbedVideoUrl được định nghĩa ở dưới (hoisted).
  {
    const badVideoRows = db.all("SELECT id, video_url FROM program377_days WHERE video_url IS NOT NULL AND video_url NOT LIKE '%/embed/%'");
    badVideoRows.forEach((r) => {
      db.run('UPDATE program377_days SET video_url = ? WHERE id = ?', [normalizeEmbedVideoUrl(r.video_url), r.id]);
    });
    if (badVideoRows.length) console.log(`  Migrated program377_days.video_url: ${badVideoRows.length} link(s) đổi sang dạng embed.`);
  }

  // Lấy Drive client đã xác thực bằng OAuth refresh token (kết nối 1 lần qua Admin > Cài đặt >
  // Google Drive). Refresh token được lưu trong admin_secrets, googleapis tự làm mới access token.
  function getDriveClient() {
    if (!GOOGLE_DRIVE_PARENT_FOLDER_ID) {
      throw new Error('Chưa cấu hình GOOGLE_DRIVE_PARENT_FOLDER_ID.');
    }
    const refreshToken = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_refresh_token'")?.value;
    if (!refreshToken) {
      throw new Error('Chưa kết nối Google Drive — vào Admin > Cài đặt > Google Drive để kết nối.');
    }
    const oauth2Client = newDriveOAuthClient();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  // Mỗi user có 1 thư mục con riêng trong thư mục cha trên Drive — tạo 1 lần, tái dùng cho các lần
  // upload sau. Đặt tên theo đúng quy ước thư mục cũ: "Tên - SĐT - Ngày tạo".
  async function ensureUserDriveFolder(drive, userId) {
    const existing = db.get('SELECT drive_folder_id FROM ttm_body_photos WHERE user_id = ?', [userId]);
    if (existing?.drive_folder_id) return existing.drive_folder_id;

    const user = db.get('SELECT first_name, last_name, phone FROM users WHERE id = ?', [userId]);
    const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || `User #${userId}`;
    const today = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    const folderName = `${fullName} - ${user?.phone || 'N/A'} - ${today}`;

    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [GOOGLE_DRIVE_PARENT_FOLDER_ID],
      },
      fields: 'id',
    });
    const folderId = folder.data.id;

    if (existing) {
      db.run('UPDATE ttm_body_photos SET drive_folder_id = ? WHERE user_id = ?', [folderId, userId]);
    } else {
      db.run('INSERT INTO ttm_body_photos (user_id, drive_folder_id) VALUES (?, ?)', [userId, folderId]);
    }
    return folderId;
  }

  const seedChallengeDays = () => {
    db.run('DELETE FROM challenge_days WHERE challenge_id = 1');
    CHALLENGE_DAYS.forEach(([num, title, desc, instructions, xp]) =>
      db.run(
        'INSERT INTO challenge_days (challenge_id, day_number, title, description, instructions, xp_reward) VALUES (1,?,?,?,?,?)',
        [num, title, desc, instructions, xp]
      )
    );
    console.log(`  Seeded ${CHALLENGE_DAYS.length} challenge days (Ngũ Hành).`);
  };
  const day1 = db.get('SELECT title FROM challenge_days WHERE challenge_id = 1 AND day_number = 1 LIMIT 1');
  const cd1Count = db.get('SELECT COUNT(*) AS n FROM challenge_days WHERE challenge_id = 1').n;
  const looksLikeOldContent = day1 && /Kick Off|Cài Tool|Giới thiệu bản thân|Landing Page/i.test(day1.title || '');
  if (cd1Count === 0 || looksLikeOldContent || cd1Count !== CHALLENGE_DAYS.length) {
    seedChallengeDays();
  }

  // Seed default site settings
  const defaultSettings = [
    ['announcement_enabled',   '0'],
    ['announcement_text',      ''],
    ['announcement_icon',      '📢'],
    ['late_reminder_enabled',  '0'],
    ['calendar_embed_url',     ''],
    ['about_intro',            ''],
    ['about_media',            '[]'],
    ['community_name',         COMMUNITY_NAME],
    ['challenge_hero_icon',    '🌱'],
    ['challenge_hero_title',   'Thử thách 28 ngày Dưỡng Hóa'],
    ['challenge_hero_desc',    'Mỗi ngày một bước — ăn uống theo Ngũ Hành, thanh lọc và cân bằng cơ thể. Bổ sung → Đào thải → Lưu thông Khí Huyết → Duy trì.'],
    ['mp_store_name',          COMMUNITY_NAME + ' Marketplace'],
    ['mp_store_desc',          'Combo thực phẩm, tài liệu và công cụ ăn uống theo Ngũ Hành dành cho cộng đồng.'],
    ['mp_bank_name',           'BIDV'],
    ['mp_bank_account_name',   'TỪ CHÍ NGUYỆN'],
    ['mp_bank_account_number', '96247NGUYEN'],
    ['home_tagline',           'Cộng đồng Ăn Uống Ngũ Hành'],
    ['home_heading_line1',     'Ăn uống thuận'],
    ['home_heading_highlight', 'Ngũ Hành'],
    ['home_heading_line2',     'mỗi ngày.'],
    ['home_desc',              'Nơi mọi người cùng học cách ăn theo ngũ sắc — ngũ vị — tạng phủ, thanh lọc và cân bằng cơ thể một cách tự nhiên.'],
    ['home_stat1_value',       '5'],
    ['home_stat1_label',       'Hành'],
    ['home_stat2_value',       '3'],
    ['home_stat2_label',       'Buổi / ngày'],
    ['home_stat3_value',       '28'],
    ['home_stat3_label',       'Ngày Dưỡng Hóa'],
    ['home_tags',              'Ngũ Hành, Ngũ Sắc, Ngũ Vị, Âm Dương, Thải Độc'],
    ['courses_hero_icon',      '📗'],
    ['courses_hero_title',     'Khóa học Ăn Uống Ngũ Hành'],
    ['courses_hero_desc',      'Từ nền tảng Âm Dương Ngũ Hành đến ăn theo từng Hành, công thức cháo bổ âm và cách dùng gừng.'],
  ];
  defaultSettings.forEach(([key, value]) => {
    const existing = db.get('SELECT key FROM site_settings WHERE key = ?', [key]);
    if (!existing) db.run('INSERT INTO site_settings (key, value) VALUES (?,?)', [key, value]);
  });

  // One-time re-theme migration: overwrite leftover IELTS / AI-Agent branding values
  const rethemeMarker = db.get("SELECT value FROM site_settings WHERE key = 'retheme_nguhanh'");
  if (!rethemeMarker || rethemeMarker.value !== '2') {
    const stale = /IELTS|AI Agent|prompt engineering|deploy agent|luyện thi|nâng band|Chương Cà Mau/i;
    // These pure-branding keys are always reset to the Ngũ Hành defaults on this migration;
    // admin-authored content keys (about_intro, calendar, announcement) are left untouched.
    const forceKeys = new Set([
      'community_name', 'challenge_hero_icon', 'challenge_hero_title', 'challenge_hero_desc',
      'mp_store_name', 'mp_store_desc',
      'home_tagline', 'home_heading_line1', 'home_heading_highlight', 'home_heading_line2', 'home_desc',
      'home_stat1_value', 'home_stat1_label', 'home_stat2_value', 'home_stat2_label',
      'home_stat3_value', 'home_stat3_label', 'home_tags',
      'courses_hero_icon', 'courses_hero_title', 'courses_hero_desc',
    ]);
    defaultSettings.forEach(([key, value]) => {
      if (key === 'about_intro' || key === 'about_media' || key === 'calendar_embed_url') return;
      const row = db.get('SELECT value FROM site_settings WHERE key = ?', [key]);
      if (row && (forceKeys.has(key) || stale.test(row.value || ''))) {
        db.run('UPDATE site_settings SET value = ? WHERE key = ?', [value, key]);
      }
    });
    db.run("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('retheme_nguhanh', '2')");
    console.log('  Re-theme migration: refreshed branding settings for Ngũ Hành.');
  }

  // Seed sample products if empty
  const prodCount = db.get('SELECT COUNT(*) AS n FROM products').n;
  const seedSampleProducts = () => {
    const adminUser = db.get('SELECT id FROM users LIMIT 1');
    if (adminUser) {
      const sampleProducts = [
        [adminUser.id, 'Combo Dưỡng Hóa 28 ngày', 'Bộ thực phẩm hỗ trợ hành trình 28 ngày: sữa kháng thể, mật mía, trà thải độc, chanh muối bổ Thận — kèm hướng dẫn ăn theo Ngũ Hành.', '## Trọn bộ combo gồm\n\n- Sữa kháng thể IGG (tăng miễn dịch, canxi & D3)\n- Mật mía nguyên chất (chống oxy hóa, tạo máu)\n- Trà thải độc (nhuận tràng nhẹ)\n- Chanh muối bổ Thận – dưỡng Tùy\n- Tài liệu hướng dẫn ăn theo Ngũ Hành + tác động cột sống\n\n**Chống chỉ định:** người cấy ghép nội tạng; hạn chế với người có bệnh lý đông máu.\n\nLịch trình mẫu trong ngày cho từng tuần (giờ giấc dùng combo kết hợp bữa ăn) xem trong mục Thử thách 28 ngày Dưỡng Hóa.', 1200000, 'combo', '#10b981'],
        [adminUser.id, 'Ebook: Ngũ Hành – Chìa Khóa Của Sức Khỏe', 'Sách hướng dẫn ăn uống theo Âm Dương Ngũ Hành: ngũ sắc – ngũ vị – tạng phủ – mùa, cách đọc huyết áp/nước tiểu/phân.', '## Nội dung\n\n**Phần 1:** Tổng quan Âm Dương Ngũ Hành trong ẩm thực Việt\n**Phần 2:** Ăn theo từng Hành (Kim/Mộc/Thủy/Hỏa/Thổ)\n**Phần 3:** Hormone hạnh phúc theo mùa\n**Phần 4:** Tự kiểm tra huyết áp, nước tiểu, phân, mồ hôi', 89000, 'ebook', '#f59e0b'],
        [adminUser.id, 'Bộ công thức Cháo Bổ Âm & Trà dưỡng sinh', 'Tuyển tập công thức nền tảng: cháo bổ âm, trà Bình Minh, nước chanh gừng mật mía, trà tim sen — kèm cách dùng gừng.', '## Bao gồm\n\n- Cháo bổ âm (làm dịu cơ thể khi nhiệt)\n- Trà Bình Minh (bột sắn dây + trà + chanh muối + gừng + mật mía)\n- Nước chanh gừng mật mía buổi sáng\n- Trà tim sen hạ nhịp tim\n- Hướng dẫn dùng gừng: cay nhiệt vs cay hàn', 149000, 'cong-thuc', '#ef4444'],
        [adminUser.id, 'Mini Course: Ăn theo từng Hành', 'Khóa học 5 buổi video: mỗi Hành một buổi — màu, vị dẫn, tạng phủ, mùa, thực phẩm nên dùng và tương sinh – tương khắc.', '## Chương trình\n\n**Buổi 1:** Hành Kim – Phổi/Đại tràng\n**Buổi 2:** Hành Thủy – Thận/Bàng quang\n**Buổi 3:** Hành Mộc – Gan/Mật\n**Buổi 4:** Hành Hỏa – Tim/Ruột non\n**Buổi 5:** Hành Thổ – Tỳ/Vị', 399000, 'course', '#8b5cf6'],
        [adminUser.id, 'Thảo dược: Gừng – Sả – Tim sen', 'Bộ thảo dược nền tảng cho ăn uống Ngũ Hành — gừng (cay nhiệt), sả (màu trắng tốt Phổi), tim sen (đắng hàn hạ nhiệt).', '## Công dụng\n\n- **Gừng:** làm ấm khi trời lạnh, thêm vào bữa sáng vị cay\n- **Sả:** màu trắng, vị cay — tốt cho Phổi/Đại tràng\n- **Tim sen:** đắng hàn — hạ huyết áp, hạ nhịp tim, dễ ngủ', 129000, 'thao-duoc', '#3b82f6'],
      ];
      sampleProducts.forEach(([sid, title, desc, longDesc, price, cat, color]) => {
        db.run(
          'INSERT INTO products (seller_id, title, description, long_description, price, category, cover_color) VALUES (?,?,?,?,?,?,?)',
          [sid, title, desc, longDesc, price, cat, color]
        );
      });
      console.log('  Seeded sample products.');
    }
  };
  if (db.get("SELECT id FROM products WHERE title LIKE '%AI Agent%' OR title LIKE '%Prompt ChatGPT%' OR title LIKE '%Prompt Engineering%' OR title LIKE '%AI Workflow%' OR title LIKE '%Đăng Bài Facebook%' OR title LIKE '%Slide Pitch%'")
      && db.get('SELECT COUNT(*) AS n FROM orders').n === 0) {
    db.run("DELETE FROM products WHERE title LIKE '%AI Agent%' OR title LIKE '%Prompt ChatGPT%' OR title LIKE '%Prompt Engineering%' OR title LIKE '%AI Workflow%' OR title LIKE '%Đăng Bài Facebook%' OR title LIKE '%Slide Pitch%'");
    console.log('  Re-theme migration: removed AI-Agent sample products.');
  }
  if (db.get("SELECT COUNT(*) AS n FROM products WHERE is_featured = 0 AND course_id IS NULL").n === 0
      && db.get('SELECT COUNT(*) AS n FROM orders').n === 0) {
    seedSampleProducts();
  }

  // Seed flagship featured product — 28-day Dưỡng Hóa program, shown in the marketplace hero
  const featuredCount = db.get('SELECT COUNT(*) AS n FROM products WHERE is_featured = 1').n;
  if (featuredCount === 0) {
    const adminUser = db.get('SELECT id FROM users LIMIT 1');
    if (adminUser) {
      db.run(
        `INSERT INTO products (seller_id, title, description, long_description, price, compare_price, category, cover_color, status, is_featured, detail_url)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [adminUser.id, 'Chương trình 28 Ngày Dưỡng Hóa – Mở Khóa Cơ Thể',
         '28 ngày cầm tay chỉ việc ăn uống theo Ngũ Hành — thanh lọc, đào thải độc tố và cân bằng cơ thể, kèm combo thực phẩm và cộng đồng đồng hành.',
         '## Bạn sẽ nhận được gì\n\n- 28 ngày hướng dẫn ăn uống theo Ngũ Hành, quy trình 1 ngày 3 buổi\n- Combo thực phẩm hỗ trợ (sữa kháng thể, mật mía, trà thải độc, chanh muối bổ Thận)\n- Đồng hành, giải đáp mỗi ngày\n- Cộng đồng học viên hỗ trợ suốt 28 ngày\n- Truy cập trọn đời tài liệu, công thức & video\n\n**3 giai đoạn:** Bổ sung dinh dưỡng → Đào thải độc tố → Lưu thông Khí Huyết',
         5000000, 0, 'combo', '#10b981', 'published', 1, 'challenge.html']
      );
      console.log('  Seeded featured product: 28 Ngày Dưỡng Hóa.');
    }
  }

  // Capitalizes the first letter of each word ("từ chí nguyện" → "Từ Chí
  // Nguyện"). Used to normalize user display names — many were stored
  // exactly as typed at registration (often all-lowercase on mobile).
  // String.prototype.toUpperCase/toLowerCase are Unicode-aware in Node, so
  // Vietnamese diacritics (đ/Đ, ạ/Ạ, ...) round-trip correctly.
  function toTitleCase(s) {
    return String(s || '')
      .trim()
      .split(/\s+/)
      .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)
      .join(' ');
  }

  // One-time cleanup: normalize any already-stored names that aren't Title
  // Case yet. Idempotent — once names are fixed, this is a no-op on every
  // future startup.
  db.all('SELECT id, first_name, last_name FROM users').forEach(u => {
    const fn = toTitleCase(u.first_name);
    const ln = toTitleCase(u.last_name);
    if (fn !== u.first_name || ln !== u.last_name) {
      db.run('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?', [fn, ln, u.id]);
    }
  });

  // Seed default pillars = 5 Hành (Ngũ Hành): Kim / Mộc / Thủy / Hỏa / Thổ
  const pillarCount = db.get('SELECT COUNT(*) AS n FROM pillars').n;
  if (pillarCount === 0) {
    const defaultPillars = [
      ['kim',  'Hành Kim — Phổi/Đại tràng · vị Cay · màu Trắng',   '⚪', '#94a3b8', 0],
      ['moc',  'Hành Mộc — Gan/Mật · vị Chua · màu Xanh',           '🟢', '#10b981', 1],
      ['thuy', 'Hành Thủy — Thận/Bàng quang · vị Mặn · màu Đen',    '⚫', '#1f2937', 2],
      ['hoa',  'Hành Hỏa — Tim/Ruột non · vị Đắng · màu Đỏ',        '🔴', '#ef4444', 3],
      ['tho',  'Hành Thổ — Tỳ/Vị · vị Ngọt · màu Vàng',             '🟡', '#f59e0b', 4],
    ];
    defaultPillars.forEach(([key, label, icon, color, order_num]) => {
      db.run('INSERT INTO pillars (key, label, icon, color, order_num) VALUES (?,?,?,?,?)', [key, label, icon, color, order_num]);
    });
    console.log('  Seeded 5 Ngũ Hành pillars.');
  } else if (db.get("SELECT id FROM pillars WHERE key = 'offer'")) {
    // Re-theme migration: replace old business pillars with Ngũ Hành, remap existing posts
    const remap = { offer: 'tho', traffic: 'moc', conversion: 'hoa', delivery: 'kim', continuity: 'thuy' };
    Object.entries(remap).forEach(([oldKey, newKey]) =>
      db.run('UPDATE posts SET pillar = ? WHERE pillar = ?', [newKey, oldKey]));
    db.run('DELETE FROM pillars');
    [
      ['kim',  'Hành Kim — Phổi/Đại tràng · vị Cay · màu Trắng',   '⚪', '#94a3b8', 0],
      ['moc',  'Hành Mộc — Gan/Mật · vị Chua · màu Xanh',           '🟢', '#10b981', 1],
      ['thuy', 'Hành Thủy — Thận/Bàng quang · vị Mặn · màu Đen',    '⚫', '#1f2937', 2],
      ['hoa',  'Hành Hỏa — Tim/Ruột non · vị Đắng · màu Đỏ',        '🔴', '#ef4444', 3],
      ['tho',  'Hành Thổ — Tỳ/Vị · vị Ngọt · màu Vàng',             '🟡', '#f59e0b', 4],
    ].forEach(([key, label, icon, color, order_num]) =>
      db.run('INSERT INTO pillars (key, label, icon, color, order_num) VALUES (?,?,?,?,?)', [key, label, icon, color, order_num]));
    console.log('  Re-theme migration: replaced business pillars with Ngũ Hành.');
  }

  // ── Helpers ────────────────────────────────────────────────
  function addXP(userId, amount, source, note = null) {
    db.run('UPDATE users SET xp = xp + ? WHERE id = ?', [amount, userId]);
    db.run(
      'INSERT INTO xp_log (user_id, amount, source, note) VALUES (?,?,?,?)',
      [userId, amount, source, note]
    );
  }

  // Recompute a user's streak = number of consecutive days (ending today) that have a meal_log.
  // Returns the new streak. Awards a bonus XP the first time each 7-day milestone is reached.
  function recomputeStreak(userId) {
    const set = new Set(
      db.all("SELECT DISTINCT log_date FROM meal_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 90", [userId])
        .map(r => r.log_date)
    );
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const cur = new Date(todayStr + 'T12:00:00');
    // if today not logged yet, count from yesterday so the streak doesn't drop mid-day
    if (!set.has(iso(cur))) cur.setDate(cur.getDate() - 1);
    let streak = 0;
    while (set.has(iso(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
    const prev = db.get('SELECT streak FROM users WHERE id = ?', [userId])?.streak || 0;
    db.run('UPDATE users SET streak = ? WHERE id = ?', [streak, userId]);
    // milestone bonus: +10 XP each new multiple of 7, only when crossing upward
    if (streak > prev && streak % 7 === 0) {
      addXP(userId, 10, 'streak', `Chuỗi ${streak} ngày ghi nhật ký ăn uống`);
    }
    return streak;
  }

  function slugify(label) {
    let s = String(label || '').trim().toLowerCase();
    s = s.replace(/đ/g, 'd').replace(/Đ/g, 'd');
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return s || 'pillar';
  }
  function uniquePillarKey(base) {
    let key = base;
    let i = 2;
    while (db.get('SELECT id FROM pillars WHERE key = ?', [key])) { key = `${base}_${i}`; i++; }
    return key;
  }

  function extractJsonObject(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object in AI response');
    return JSON.parse(candidate.slice(start, end + 1));
  }

  function gradeQuizExercise(questions, answers, maxScore) {
    const issues = [];
    const hints = [];
    let correctCount = 0;
    questions.forEach((q, i) => {
      const picked = answers[q.id];
      if (picked === q.correct_index) {
        correctCount++;
      } else {
        issues.push(`Câu ${i + 1}: "${q.question_text}" — bạn chọn sai.`);
        if (q.explanation) hints.push(`Câu ${i + 1}: ${q.explanation}`);
      }
    });
    const score = questions.length ? Math.round((correctCount / questions.length) * maxScore) : 0;
    return { score, issues, hints };
  }

  async function gradeExerciseWithGemini({ lessonTitle, exercisePrompt, rubric, maxScore, studentAnswer }) {
    const systemPrompt = `Bạn là trợ giảng chấm bài tập cho khoá học "${lessonTitle}". Chấm nghiêm túc, công bằng theo đúng tiêu chí chấm điểm được cung cấp.

Trả lời DUY NHẤT một JSON object theo đúng format sau, không thêm chữ nào khác trước/sau:
{"score": <số nguyên 0-${maxScore}>, "issues": [<chuỗi tiếng Việt, mỗi phần tử là 1 lỗi/điểm sai cụ thể trong bài làm>], "hints": [<chuỗi tiếng Việt, mỗi phần tử là 1 gợi ý/câu hỏi dẫn dắt để học viên TỰ nhận ra và TỰ sửa lỗi>]}

QUY TẮC BẮT BUỘC:
- "issues" phải cụ thể, chỉ đúng chỗ sai trong bài làm của học viên, không nói chung chung.
- "hints" phải mang tính gợi mở, đặt câu hỏi hoặc chỉ ra hướng suy nghĩ — TUYỆT ĐỐI KHÔNG được viết ra đáp án đúng, lời giải hoàn chỉnh, hay đoạn văn bản sửa sẵn. Mục tiêu là để học viên tự hiểu và tự sửa, không phải giải hộ.
- Nếu bài làm tốt/đúng hoàn toàn, "issues" và "hints" có thể là mảng rỗng.`;

    const userPrompt = `ĐỀ BÀI (học viên thấy):\n${exercisePrompt}\n\nTIÊU CHÍ CHẤM ĐIỂM (nội bộ, học viên không thấy):\n${rubric || '(không có tiêu chí riêng, chấm theo mức độ đúng/đủ so với đề bài)'}\n\nBÀI LÀM CỦA HỌC VIÊN:\n${studentAnswer}`;

    try {
      const result = await callAiChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: 1500,
      });
      if (!result.ok) return { ok: false, error: result.error };

      const raw = result.text;
      const parsed = extractJsonObject(raw);

      let score = Number(parsed.score);
      if (!Number.isFinite(score)) throw new Error('Invalid score in AI response');
      score = Math.max(0, Math.min(maxScore, Math.round(score)));

      const toStrArray = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : (v ? [String(v).trim()] : []);

      return { ok: true, score, issues: toStrArray(parsed.issues), hints: toStrArray(parsed.hints), raw };
    } catch (err) {
      console.error('[ExerciseGrade] Error:', err.message);
      return { ok: false, error: err.message };
    }
  }


  // ── Admin middleware ───────────────────────────────────────
  // Accepts either the shared ADMIN_KEY (master/bootstrap) or a per-admin
  // session token from /api/admin/login. The session's is_admin/status are
  // re-checked on every request, so revoking admin access takes effect immediately.
  function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!key) return res.status(401).json({ error: 'Unauthorized' });
    if (key === ADMIN_KEY) { req.adminUserId = null; return next(); } // master key — không gắn với 1 người cụ thể

    const session = db.get(
      `SELECT u.id, u.is_admin, u.status FROM admin_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now','localtime')`,
      [key]
    );
    if (session && session.is_admin && session.status === 'active') { req.adminUserId = session.id; return next(); }

    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC ROUTES
  // ══════════════════════════════════════════════════════════

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: 'brain.db' }));

  // Test email (admin only)
  app.get('/api/admin/test-email', requireAdmin, async (req, res) => {
    const to = req.query.to || ADMIN_EMAIL;
    await sendEmail({
      to,
      subject: `🧪 Test email từ ${COMMUNITY_NAME}`,
      html: emailWrap('Email test thành công!', `
        <p>Email system đang hoạt động bình thường.</p>
        <p>From: <strong>${FROM_EMAIL}</strong></p>
        <p>Resend key: <strong>${RESEND_KEY ? '✅ Đã cấu hình' : '❌ Chưa cấu hình'}</strong></p>
      `)
    });
    res.json({ ok: true, sent_to: to, resend_active: !!resendClient });
  });

  // Public site settings
  app.get('/api/settings', (_req, res) => {
    const rows = db.all('SELECT key, value FROM site_settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  });

  // Public courses list
  // Private courses must always have a published, in-sync checkout product. Courses saved
  // before that pairing existed (or whose product drifted out of sync some other way) get
  // healed here on read, so the "Thanh toán" button never dead-ends.
  function ensureCourseProduct(courseId) {
    const product = db.get("SELECT id FROM products WHERE course_id = ? AND status = 'published'", [courseId]);
    if (product) return product.id;
    syncCourseProduct(courseId);
    return db.get("SELECT id FROM products WHERE course_id = ? AND status = 'published'", [courseId])?.id || null;
  }

  app.get('/api/courses', (req, res) => {
    const { user_id = '' } = req.query;
    const courses = db.all(`
      SELECT c.id, c.title, c.description, c.cover_color, c.status, c.visibility, c.price, c.compare_price,
             c.instructor, c.order_num, c.created_at, c.space_id, c.group_id,
             s.name AS space_name, s.icon AS space_icon, g.name AS group_name,
             p.id AS checkout_product_id,
             COUNT(cl.id) AS lesson_count
      FROM courses c
      LEFT JOIN course_lessons cl ON cl.course_id = c.id AND cl.status = 'published'
      LEFT JOIN spaces s ON s.id = c.space_id
      LEFT JOIN space_groups g ON g.id = c.group_id
      LEFT JOIN products p ON p.course_id = c.id AND p.status = 'published'
      WHERE c.status = 'published'
      GROUP BY c.id
      ORDER BY c.order_num ASC, c.created_at DESC
    `).map(c => ({
      ...c,
      join_status: c.group_id ? (getGroupMembership(c.group_id, user_id)?.status || 'none')
        : c.space_id ? (getMembership(c.space_id, user_id)?.status || 'none')
        : null,
      enroll_status: user_id ? (getEnrollment(c.id, user_id)?.status || 'none') : 'none',
      checkout_product_id: c.visibility === 'private' && !c.checkout_product_id ? ensureCourseProduct(c.id) : c.checkout_product_id,
    }));
    const total_lessons = db.get("SELECT COUNT(*) AS n FROM course_lessons cl JOIN courses c ON c.id = cl.course_id WHERE c.status = 'published' AND cl.status = 'published'").n;
    res.json({ courses, total_lessons });
  });

  // Course detail with lessons. Private courses the user hasn't paid for get the lesson
  // curriculum stripped of content — only the checkout prompt should render client-side.
  app.get('/api/courses/:id', (req, res) => {
    const { user_id = '' } = req.query;
    const course = db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const enroll_status = user_id ? (getEnrollment(course.id, user_id)?.status || 'none') : 'none';
    const unlocked = course.visibility !== 'private' || enroll_status === 'approved';
    const lesson_count = db.get("SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ? AND status = 'published'", [req.params.id]).n;
    const modules = db.all('SELECT id, title, order_num FROM course_modules WHERE course_id = ? ORDER BY order_num ASC, id ASC', [req.params.id]);
    const lessons = unlocked
      ? db.all(
          `SELECT id, module_id, title, content, video_url, duration_min, order_num,
                  exercise_enabled, exercise_type, exercise_prompt, exercise_max_score, exercise_pass_score
           FROM course_lessons WHERE course_id = ? AND status = 'published' ORDER BY order_num ASC, id ASC`,
          [req.params.id]
        ).map(l => {
          if (!l.exercise_enabled) return { ...l, my_submission: null };
          const s = user_id ? db.get(
            'SELECT answer_text, score, max_score, pass_score, passed, issues, hints, xp_awarded, status, teacher_note, submitted_at FROM lesson_exercise_submissions WHERE user_id = ? AND lesson_id = ?',
            [user_id, l.id]
          ) : null;
          const my_submission = s ? {
            ...s,
            issues: JSON.parse(s.issues || '[]'),
            hints: JSON.parse(s.hints || '[]'),
          } : null;
          const result = { ...l, my_submission };
          const needsForm = !my_submission || my_submission.status === 'needs_resubmit';

          if (l.exercise_type === 'quiz') {
            const questions = db.all(
              'SELECT id, question_text, options, correct_index, order_num FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC',
              [l.id]
            );
            if (needsForm) {
              result.quiz_questions = questions.map(q => ({ id: q.id, question_text: q.question_text, options: JSON.parse(q.options), order_num: q.order_num }));
            } else {
              const answers = JSON.parse(s.answer_text || '{}');
              my_submission.quiz_review = questions.map(q => ({
                question_text: q.question_text,
                options: JSON.parse(q.options),
                picked_index: answers[q.id] !== undefined ? Number(answers[q.id]) : null,
                correct_index: q.correct_index,
              }));
            }
          }
          return result;
        })
      : [];
    const checkout_product_id = course.visibility === 'private' ? ensureCourseProduct(course.id) : null;
    res.json({
      course: { ...course, enroll_status, checkout_product_id },
      lessons,
      lesson_count,
      modules,
    });
  });

  // Enroll instantly in a public course. Private courses must go through checkout —
  // enrollment there is granted automatically once the linked order completes.
  app.post('/api/courses/:id/enroll', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const course = db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    if (course.visibility === 'private') {
      return res.status(402).json({ error: 'Khóa học này yêu cầu thanh toán để tham gia.', checkout_product_id: ensureCourseProduct(course.id) });
    }

    const status = 'approved';
    const existing = db.get('SELECT id, status FROM course_enrollments WHERE course_id = ? AND user_id = ?', [req.params.id, user_id]);
    if (existing) {
      if (existing.status !== 'approved')
        db.run('UPDATE course_enrollments SET status = ? WHERE id = ?', [status, existing.id]);
    } else {
      db.run('INSERT INTO course_enrollments (course_id, user_id, status) VALUES (?,?,?)', [req.params.id, user_id, status]);
    }
    res.json({ success: true, status: 'approved' });
  });

  // AI-graded lesson exercise — student submits once, gets an immediate score + feedback.
  // The row is only inserted after a SUCCESSFUL grading call, so a failed AI call never
  // burns the student's single attempt (see UNIQUE(user_id, lesson_id) on the table).
  app.post('/api/courses/lessons/:lessonId/exercise/submit', async (req, res) => {
    const { user_id, answer, answers } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });

    const lesson = db.get('SELECT * FROM course_lessons WHERE id = ? AND exercise_enabled = 1', [req.params.lessonId]);
    if (!lesson) return res.status(404).json({ error: 'Bài tập không tồn tại.' });

    const enrollment = getEnrollment(lesson.course_id, user_id);
    if (!enrollment || enrollment.status !== 'approved')
      return res.status(403).json({ error: 'Bạn cần tham gia khóa học này trước khi nộp bài tập.' });

    const existing = db.get('SELECT * FROM lesson_exercise_submissions WHERE user_id = ? AND lesson_id = ?', [user_id, lesson.id]);
    if (existing && existing.status !== 'needs_resubmit') {
      return res.status(409).json({
        error: existing.status === 'finalized'
          ? 'Bài tập này đã được giáo viên chấm và kết thúc.'
          : 'Bạn đã nộp bài tập này rồi.',
      });
    }

    let answerText, score, issues, hints, raw = '', maxScore = lesson.exercise_max_score || 100;

    if (lesson.exercise_type === 'quiz') {
      if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Vui lòng trả lời tất cả câu hỏi.' });
      const questions = db.all('SELECT * FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC', [lesson.id]);
      if (!questions.length) return res.status(400).json({ error: 'Bài tập trắc nghiệm chưa có câu hỏi.' });
      const normalizedAnswers = {};
      questions.forEach(q => { if (answers[q.id] !== undefined) normalizedAnswers[q.id] = Number(answers[q.id]); });
      if (Object.keys(normalizedAnswers).length < questions.length)
        return res.status(400).json({ error: 'Vui lòng trả lời tất cả câu hỏi.' });
      const graded = gradeQuizExercise(questions, normalizedAnswers, maxScore);
      answerText = JSON.stringify(normalizedAnswers);
      score = graded.score; issues = graded.issues; hints = graded.hints;
    } else {
      if (!answer || !answer.trim()) return res.status(400).json({ error: 'Vui lòng nhập nội dung bài làm.' });
      const result = await gradeExerciseWithGemini({
        lessonTitle: lesson.title,
        exercisePrompt: lesson.exercise_prompt || '',
        rubric: lesson.exercise_rubric || '',
        maxScore,
        studentAnswer: answer.trim(),
      });
      if (!result.ok) return res.status(502).json({ error: 'AI chấm bài gặp lỗi, vui lòng thử lại sau.' });
      answerText = answer.trim(); score = result.score; issues = result.issues; hints = result.hints; raw = result.raw || '';
    }

    const passed = score >= lesson.exercise_pass_score ? 1 : 0;
    const alreadyAwarded = existing ? existing.xp_awarded > 0 : false;
    const newlyAwardedXp = (passed && !alreadyAwarded) ? (lesson.exercise_xp_reward || 0) : 0;
    const xp_awarded = alreadyAwarded ? existing.xp_awarded : newlyAwardedXp;

    if (existing) {
      db.run(
        `UPDATE lesson_exercise_submissions
           SET answer_text=?, score=?, max_score=?, pass_score=?, passed=?, issues=?, hints=?, ai_feedback_raw=?, xp_awarded=?,
               status='graded', teacher_note=NULL, submitted_at=datetime('now','localtime')
         WHERE id=?`,
        [answerText, score, maxScore, lesson.exercise_pass_score, passed,
         JSON.stringify(issues), JSON.stringify(hints), raw, xp_awarded, existing.id]
      );
    } else {
      db.run(
        `INSERT INTO lesson_exercise_submissions
          (user_id, lesson_id, course_id, answer_text, score, max_score, pass_score, passed, issues, hints, ai_feedback_raw, xp_awarded)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [user_id, lesson.id, lesson.course_id, answerText, score, maxScore, lesson.exercise_pass_score,
         passed, JSON.stringify(issues), JSON.stringify(hints), raw, xp_awarded]
      );
    }

    if (newlyAwardedXp > 0) {
      addXP(user_id, newlyAwardedXp, 'lesson_exercise', `Đạt bài tập: ${lesson.title}`);
    }

    const saved = db.get(
      'SELECT answer_text, score, max_score, pass_score, passed, issues, hints, xp_awarded, status, teacher_note, submitted_at FROM lesson_exercise_submissions WHERE user_id = ? AND lesson_id = ?',
      [user_id, lesson.id]
    );
    res.status(201).json({
      success: true,
      my_submission: {
        ...saved,
        issues: JSON.parse(saved.issues || '[]'),
        hints: JSON.parse(saved.hints || '[]'),
      },
    });
  });

  // ── Lesson discussion (comments right under a course lesson) ────────
  app.get('/api/courses/lessons/:lessonId/comments', (req, res) => {
    const comments = db.all(
      `SELECT c.id, c.parent_id, c.content, c.created_at,
              u.id AS author_id, u.first_name, u.last_name, u.level
       FROM lesson_comments c JOIN users u ON u.id = c.user_id
       WHERE c.lesson_id = ?
       ORDER BY COALESCE(c.parent_id, c.id), c.id ASC`,
      [req.params.lessonId]
    );
    res.json({ comments });
  });

  app.post('/api/courses/lessons/:lessonId/comments', (req, res) => {
    const lesson = db.get('SELECT id FROM course_lessons WHERE id = ?', [req.params.lessonId]);
    if (!lesson) return res.status(404).json({ error: 'Bài học không tồn tại.' });

    const { user_id, content, parent_id = null } = req.body;
    if (!user_id || !content?.trim()) return res.status(400).json({ error: 'Thiếu thông tin' });

    db.run('INSERT INTO lesson_comments (lesson_id, user_id, content, parent_id) VALUES (?,?,?,?)',
      [lesson.id, user_id, content.trim(), parent_id || null]);
    addXP(user_id, 2, 'lesson_comment', 'Bình luận bài học');
    res.json({ success: true });
  });

  // Register
  app.post('/api/auth/register', (req, res) => {
    const { first_name, last_name, email, password } = req.body;

    if (!first_name || !last_name || !email || !password)
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });
    if (!/\S+@\S+\.\S+/.test(email))
      return res.status(400).json({ error: 'Email không hợp lệ.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' });

    const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing)
      return res.status(409).json({ error: 'Email này đã được đăng ký.' });

    const hash   = bcrypt.hashSync(password, 10);
    const result = db.run(
      'INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?,?,?,?)',
      [toTitleCase(first_name), toTitleCase(last_name), email, hash]
    );

    const userId = result.lastInsertRowid;
    addXP(userId, 10, 'register', 'Chào mừng thành viên mới');

    const user = db.get(
      'SELECT id, first_name, last_name, email, level, xp, created_at FROM users WHERE id = ?',
      [userId]
    );
    res.status(201).json({ success: true, user });

    // Welcome email (fire-and-forget after response)
    sendEmail({
      to: email,
      subject: `🎉 Chào mừng bạn đến với ${COMMUNITY_NAME}!`,
      html: emailWrap('Chào mừng đến với cộng đồng!', `
        <p>Xin chào <strong>${user.first_name} ${user.last_name}</strong>,</p>
        <p>Bạn đã đăng ký thành công tài khoản tại <strong>${COMMUNITY_NAME}</strong>.</p>
        <p>Với tài khoản này, bạn có thể:</p>
        <ul style="color:#475569;line-height:2">
          <li>📝 Chia sẻ bữa ăn và học hỏi từ cộng đồng</li>
          <li>🌱 Tham gia Thử Thách 28 Ngày Dưỡng Hóa</li>
          <li>🍚 Tra cứu thực phẩm theo màu – vị – ngũ hành</li>
          <li>📗 Truy cập khoá học và công thức độc quyền</li>
        </ul>
        <a class="btn" href="${SITE_URL}/feed.html">Vào Bảng Tin Ngay</a>
        <p>Nếu có bất kỳ câu hỏi nào, hãy đăng lên cộng đồng — chúng tôi luôn sẵn sàng hỗ trợ!</p>
      `)
    });
  });

  // Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu.' });

    const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
    if (!user.password_hash)
      return res.status(401).json({ error: 'Tài khoản này đăng nhập bằng Google. Vui lòng dùng nút "Đăng nhập với Google".' });
    if (!bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
    if (user.status !== 'active')
      return res.status(403).json({ error: 'Tài khoản này đã bị khoá.' });

    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    res.json({
      success: true,
      user: { id: user.id, first_name: user.first_name, last_name: user.last_name,
              email: user.email, level: user.level, xp: user.xp, is_admin: !!user.is_admin,
              ttm_intake_done_at: user.ttm_intake_done_at || null,
              telegram_chat_id: user.telegram_chat_id || null },
    });
  });

  // Google OAuth
  app.post('/api/auth/google', async (req, res) => {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Thiếu access_token.' });

    let gUser;
    try {
      const gRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!gRes.ok) return res.status(401).json({ error: 'Token Google không hợp lệ.' });
      gUser = await gRes.json();
    } catch (err) {
      return res.status(502).json({ error: 'Không thể xác thực với Google.' });
    }

    if (!gUser.email_verified) return res.status(401).json({ error: 'Email Google chưa xác minh.' });

    const { sub: google_id, email, given_name, family_name, picture } = gUser;
    const first_name = toTitleCase(given_name || (gUser.name || '').split(' ').pop() || 'Thành viên');
    const last_name  = toTitleCase(family_name || (gUser.name || '').split(' ').slice(0, -1).join(' ') || '');

    let user = db.get('SELECT * FROM users WHERE google_id = ?', [google_id]);

    if (!user) {
      user = db.get('SELECT * FROM users WHERE email = ?', [email]);
      if (user) {
        // Liên kết Google vào tài khoản email đã có
        db.run('UPDATE users SET google_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
          [google_id, picture, user.id]);
        user = db.get('SELECT * FROM users WHERE id = ?', [user.id]);
      } else {
        // Tạo tài khoản mới qua Google
        const result = db.run(
          'INSERT INTO users (first_name, last_name, email, google_id, avatar_url, status, level, xp) VALUES (?,?,?,?,?,?,?,?)',
          [first_name, last_name, email, google_id, picture, 'active', 1, 0]
        );
        addXP(result.lastInsertRowid, 10, 'register', 'Chào mừng thành viên mới');
        user = db.get('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
        sendEmail({
          to: email,
          subject: `🎉 Chào mừng bạn đến với ${COMMUNITY_NAME}!`,
          html: emailWrap('Chào mừng đến với cộng đồng!', `
            <p>Xin chào <strong>${first_name}</strong>,</p>
            <p>Bạn đã đăng ký thành công tài khoản tại <strong>${COMMUNITY_NAME}</strong> qua Google.</p>
            <a class="btn" href="${SITE_URL}/feed.html">Vào Bảng Tin Ngay</a>
          `)
        });
      }
    }

    if (user.status === 'banned') return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });

    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    res.json({
      success: true,
      user: {
        id: user.id, first_name: user.first_name, last_name: user.last_name,
        email: user.email, level: user.level, xp: user.xp, is_admin: !!user.is_admin,
        avatar: user.avatar_url || picture,
        ttm_intake_done_at: user.ttm_intake_done_at || null,
        telegram_chat_id: user.telegram_chat_id || null,
      },
    });
  });

  // Forgot password — generate reset token
  app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Vui lòng nhập email.' });

    const user = db.get('SELECT id, email, first_name FROM users WHERE email = ?', [email]);
    // Always return success to avoid email enumeration
    if (!user) return res.json({ success: true });

    // Invalidate old tokens for this user
    db.run('UPDATE reset_tokens SET used = 1 WHERE user_id = ?', [user.id]);

    // Generate a random 32-char hex token
    const token = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.run('INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?,?,?)',
      [user.id, token, expires_at]);

    const resetLink = `${SITE_URL}/reset-password.html?token=${token}`;
    sendEmail({
      to: user.email,
      subject: `🔑 Đặt lại mật khẩu — ${COMMUNITY_NAME}`,
      html: emailWrap('Đặt lại mật khẩu', `
        <p>Xin chào <strong>${user.first_name}</strong>,</p>
        <p>Có yêu cầu đặt lại mật khẩu cho tài khoản này. Bấm nút bên dưới để đặt mật khẩu mới (link có hiệu lực trong 1 giờ):</p>
        <a class="btn" href="${resetLink}">Đặt lại mật khẩu</a>
        <p>Nếu bạn không yêu cầu điều này, hãy bỏ qua email — mật khẩu hiện tại của bạn vẫn an toàn.</p>
      `)
    });

    // No RESEND_API_KEY configured (local dev) — fall back to returning the token directly
    // instead of silently failing, since there's no way to deliver the email.
    if (!resendClient)
      return res.json({ success: true, dev_token: token, dev_hint: `Dùng token này tại /reset-password.html?token=${token}` });

    res.json({ success: true });
  });

  // Reset password — use token to set new password
  app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Thiếu thông tin.' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' });

    const row = db.get(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.used
       FROM reset_tokens rt WHERE rt.token = ?`, [token]
    );
    if (!row) return res.status(400).json({ error: 'Token không hợp lệ.' });
    if (row.used) return res.status(400).json({ error: 'Token đã được sử dụng.' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token đã hết hạn.' });

    const hash = bcrypt.hashSync(password, 10);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
    db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?', [row.id]);

    res.json({ success: true });
  });

  // ══════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ══════════════════════════════════════════════════════════

  app.post('/api/admin/verify', (req, res) => {
    res.json({ ok: req.body.key === ADMIN_KEY });
  });

  // Admin login for community admins (is_admin=1): email + password + 6-digit PIN.
  // Separate from /api/auth/login — issues a short-lived admin_sessions token instead
  // of trusting a client-supplied user id, since this gates destructive back-office actions.
  const adminLoginAttempts = new Map(); // email -> { count, resetAt }
  app.post('/api/admin/login', (req, res) => {
    const { email, password, pin } = req.body;
    if (!email || !password || !pin)
      return res.status(400).json({ error: 'Vui lòng nhập đủ email, mật khẩu và mã PIN.' });

    const attempt = adminLoginAttempts.get(email);
    if (attempt && attempt.count >= 5 && Date.now() < attempt.resetAt)
      return res.status(429).json({ error: 'Sai quá nhiều lần. Vui lòng thử lại sau ít phút.' });

    const fail = (msg) => {
      const a = adminLoginAttempts.get(email) || { count: 0, resetAt: 0 };
      a.count += 1;
      a.resetAt = Date.now() + 15 * 60 * 1000;
      adminLoginAttempts.set(email, a);
      return res.status(401).json({ error: msg });
    };

    const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !user.is_admin) return fail('Email hoặc mật khẩu không đúng.');
    if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });
    if (!user.password_hash)
      return fail('Tài khoản này đăng nhập bằng Google, chưa có mật khẩu. Hãy đặt mật khẩu qua "Quên mật khẩu" trước.');
    if (!bcrypt.compareSync(password, user.password_hash)) return fail('Email hoặc mật khẩu không đúng.');
    if (!user.admin_pin_hash) return fail('Tài khoản chưa được cấp mã PIN admin. Liên hệ quản trị viên.');
    if (!bcrypt.compareSync(pin, user.admin_pin_hash)) return fail('Mã PIN không đúng.');

    adminLoginAttempts.delete(email);
    db.run("DELETE FROM admin_sessions WHERE expires_at < datetime('now','localtime')");

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    db.run('INSERT INTO admin_sessions (user_id, token, expires_at) VALUES (?,?,?)', [user.id, token, expiresAt]);

    res.json({
      success: true,
      token,
      user: { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email },
    });
  });

  // Logout — invalidate the current session token (no-op for the master ADMIN_KEY)
  app.post('/api/admin/logout', requireAdmin, (req, res) => {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) db.run('DELETE FROM admin_sessions WHERE token = ?', [key]);
    res.json({ success: true });
  });

  // Stats
  app.get('/api/admin/stats', requireAdmin, (_req, res) => {
    const total_users  = db.get('SELECT COUNT(*) AS n FROM users').n;
    const new_today    = db.get("SELECT COUNT(*) AS n FROM users WHERE date(created_at) = date('now','localtime')").n;
    const total_posts  = db.get('SELECT COUNT(*) AS n FROM posts').n;
    const posts_today  = db.get("SELECT COUNT(*) AS n FROM posts WHERE date(created_at) = date('now','localtime')").n;
    const total_xp     = db.get('SELECT COALESCE(SUM(xp),0) AS n FROM users').n;
    const xp_today     = db.get("SELECT COALESCE(SUM(amount),0) AS n FROM xp_log WHERE date(created_at) = date('now','localtime')").n;
    const completions  = db.get('SELECT COUNT(*) AS n FROM user_challenge_progress').n;
    const active_users = db.get("SELECT COUNT(*) AS n FROM users WHERE last_active_at >= datetime('now','-7 days','localtime')").n;

    const by_level = db.all(
      'SELECT level, COUNT(*) AS count FROM users GROUP BY level ORDER BY level'
    );
    const recent_users = db.all(
      'SELECT id, first_name, last_name, email, level, xp, created_at FROM users ORDER BY created_at DESC LIMIT 5'
    );

    res.json({ total_users, new_today, total_posts, posts_today,
               total_xp, xp_today, completions, active_users, by_level, recent_users });
  });

  // List users
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const { search = '', status = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;

    let sql = `SELECT id, first_name, last_name, email, level, xp, streak,
                      status, is_admin, last_active_at, created_at
               FROM users
               WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`;
    const params = [like, like, like];

    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const users = db.all(sql, params);

    let cntSql = `SELECT COUNT(*) AS n FROM users WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`;
    const cntP = [like, like, like];
    if (status) { cntSql += ' AND status = ?'; cntP.push(status); }
    const total = db.get(cntSql, cntP).n;

    res.json({ users, total });
  });

  // Update user status
  app.patch('/api/admin/users/:id/status', requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!['active','banned','suspended'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    db.run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  });

  app.patch('/api/admin/users/:id/admin', requireAdmin, (req, res) => {
    const isAdmin = req.body.is_admin ? 1 : 0;
    db.run('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin, req.params.id]);
    if (!isAdmin) db.run('DELETE FROM admin_sessions WHERE user_id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Set/reset an admin's 6-digit PIN (2nd factor for admin.html login)
  app.patch('/api/admin/users/:id/pin', requireAdmin, (req, res) => {
    const { pin } = req.body;
    if (!/^\d{6}$/.test(pin || ''))
      return res.status(400).json({ error: 'Mã PIN phải gồm đúng 6 chữ số.' });
    const hash = bcrypt.hashSync(pin, 10);
    db.run('UPDATE users SET admin_pin_hash = ? WHERE id = ?', [hash, req.params.id]);
    res.json({ success: true });
  });

  // Delete user
  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // List posts
  app.get('/api/admin/posts', requireAdmin, (req, res) => {
    const { search = '', pillar = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;

    let sql = `SELECT p.id, p.title, p.pillar, p.post_type, p.likes_count, p.comments_count,
                      p.is_pinned, p.created_at,
                      u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email
               FROM posts p JOIN users u ON u.id = p.user_id
               WHERE (p.title LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
    const params = [like, like, like];
    if (pillar) { sql += ' AND p.pillar = ?'; params.push(pillar); }
    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    res.json({ posts: db.all(sql, params) });
  });

  app.post('/api/admin/posts', requireAdmin, (req, res) => {
    const { user_id, title, content, pillar, post_type = 'post' } = req.body;
    if (!content || !String(content).trim())
      return res.status(400).json({ error: 'Nội dung bài đăng không được để trống.' });
    const uid = user_id ? Number(user_id) : db.get('SELECT id FROM users ORDER BY id LIMIT 1').id;
    const user = db.get('SELECT id FROM users WHERE id = ?', [uid]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tác giả.' });
    const result = db.run(
      'INSERT INTO posts (user_id, title, content, pillar, post_type) VALUES (?,?,?,?,?)',
      [uid, (title || '').trim(), content.trim(), pillar || null, post_type]
    );
    res.status(201).json({ success: true, post_id: result.lastInsertRowid });
  });

  // Delete post
  app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // XP log
  app.get('/api/admin/xp-log', requireAdmin, (_req, res) => {
    const rows = db.all(`
      SELECT x.id, x.amount, x.source, x.note, x.created_at,
             u.first_name || ' ' || u.last_name AS user_name, u.email
      FROM xp_log x JOIN users u ON u.id = x.user_id
      ORDER BY x.created_at DESC LIMIT 100`);
    res.json({ rows });
  });

  // ── Seed sample posts (chỉ chạy 1 lần khi DB trống) ─────────
  const seedPosts = () => {
    const uRow = db.get('SELECT id FROM users LIMIT 1');
    if (!uRow) return;
    const uid = uRow.id;
    const samples = [
      ['Bữa sáng vị chua nuôi Gan (Hành Mộc)', 'Sáng nay mình vắt 1 lát chanh vào nước chấm, ăn kèm lá diếp cá và uống nước cam. Người nhẹ hẳn, đỡ đầy bụng.', 'moc', 'post', 33, 31],
      ['Nước chanh gừng mật mía buổi sáng', 'Công thức thải độc Gan + rửa hệ tiêu hóa: 1 lát chanh + vài lát gừng + 1 thìa mật mía + nước ấm, uống lúc bụng đói.', 'moc', 'post', 26, 25],
      ['Chào cả nhà — Ngày 1 Dưỡng Hóa', 'Em mới tham gia cộng đồng, bắt đầu 28 ngày ăn theo Ngũ Hành. Rất mong được đồng hành cùng mọi người 🙌', 'tho', 'cot', 30, 56],
      ['Kickoff: Thử thách 28 ngày Dưỡng Hóa', 'Cùng nhau bắt đầu hành trình thanh lọc và cân bằng cơ thể. Mỗi ngày một bữa ăn đúng màu – đúng vị – đúng Hành 🌱', 'hoa', 'signal', 25, 42],
      ['Cháo bổ âm — món nền tảng nên biết', 'Cháo bổ âm nấu loãng, nhai kỹ để nước bọt (ngọc dịch) thấm vào ruột non, giúp tạo máu và làm dịu cơ thể khi nhiệt.', 'thuy', 'cot', 24, 27],
    ];
    samples.forEach(([title, content, pillar, type, likes, comments]) =>
      db.run(
        'INSERT INTO posts (user_id, title, content, pillar, post_type, likes_count, comments_count) VALUES (?,?,?,?,?,?,?)',
        [uid, title, content, pillar, type, likes, comments]
      )
    );
    console.log('  Seeded 5 sample posts.');
  };

  const postCount = db.get('SELECT COUNT(*) AS n FROM posts').n;
  if (postCount === 0) {
    seedPosts();
  } else if (db.get("SELECT id FROM posts WHERE title LIKE 'How to Win With AI%' OR title LIKE '%Prompt Engineering%' OR title LIKE '%AI Agent Challenge%' OR title LIKE '%AI first mindset%'")) {
    // Re-theme: remove leftover AI-Agent sample posts (only while site has no real activity yet)
    const totalComments = db.get('SELECT COUNT(*) AS n FROM comments').n;
    const totalSubs = db.get('SELECT COUNT(*) AS n FROM challenge_submissions').n;
    if (postCount <= 5 && totalComments === 0 && totalSubs === 0) {
      db.run('DELETE FROM posts');
      seedPosts();
      console.log('  Re-theme migration: replaced sample posts.');
    }
  }

  const NGUHANH_CHALLENGE_TITLE = '28 Ngày Dưỡng Hóa – Mở Khóa Cơ Thể';
  const NGUHANH_CHALLENGE_DESC = 'Ăn uống theo Ngũ Hành để thanh lọc và cân bằng cơ thể. Mỗi ngày một quy trình 3 buổi cụ thể: Bổ sung → Đào thải → Lưu thông Khí Huyết → Duy trì.';
  const challengeCount = db.get('SELECT COUNT(*) AS n FROM challenges').n;
  if (challengeCount === 0) {
    db.run(
      `INSERT INTO challenges (id, title, description, duration, status, cover_color) VALUES (1,?,?,28,'active','#10b981')`,
      [NGUHANH_CHALLENGE_TITLE, NGUHANH_CHALLENGE_DESC]
    );
    db.exec('UPDATE challenge_days SET challenge_id = 1');
    console.log('  Seeded default challenge.');
  } else {
    // Re-theme migration: rename the flagship challenge #1 and drop the old teacher challenge
    const ch1 = db.get('SELECT title FROM challenges WHERE id = 1');
    if (ch1 && /AI Agent|Làm Chủ|21 Ngày/i.test(ch1.title || '')) {
      db.run('UPDATE challenges SET title = ?, description = ?, duration = 28, cover_color = ? WHERE id = 1',
        [NGUHANH_CHALLENGE_TITLE, NGUHANH_CHALLENGE_DESC, '#10b981']);
      db.run("DELETE FROM challenge_days WHERE challenge_id IN (SELECT id FROM challenges WHERE id != 1 AND (title LIKE '%AI Agent%' OR title LIKE '%Giáo Viên%'))");
      db.run("DELETE FROM challenges WHERE id != 1 AND (title LIKE '%AI Agent%' OR title LIKE '%Giáo Viên%')");
      console.log('  Re-theme migration: renamed flagship challenge, removed AI-Agent challenges.');
    }
  }

  // Seed Ngũ Hành courses (public, free) if none exist yet
  const courseCount = db.get('SELECT COUNT(*) AS n FROM courses').n;
  if (courseCount === 0) {
    COURSE_SEED.forEach(([title, description, cover, lessons], ci) => {
      const c = db.run(
        "INSERT INTO courses (title, description, cover_color, status, instructor, order_num, visibility, price) VALUES (?,?,?,'published',?,?,'public',0)",
        [title, description, cover, 'Điền Viên Đường', ci]
      );
      lessons.forEach(([lt, lc, dur], li) => {
        db.run(
          "INSERT INTO course_lessons (course_id, title, content, duration_min, order_num, status) VALUES (?,?,?,?,?,'published')",
          [c.lastInsertRowid, lt, lc, dur || 0, li]
        );
      });
    });
    console.log(`  Seeded ${COURSE_SEED.length} Ngũ Hành courses.`);
  }

  // Seed foods lookup + recipe library if empty
  if (db.get('SELECT COUNT(*) AS n FROM foods').n === 0) {
    FOOD_SEED.forEach(([name, element, color, taste, nature, organ, note], i) =>
      db.run('INSERT INTO foods (name, element, color, taste, nature, organ, note, order_num) VALUES (?,?,?,?,?,?,?,?)',
        [name, element, color, taste, nature, organ, note, i]));
    console.log(`  Seeded ${FOOD_SEED.length} foods.`);
  }
  if (db.get('SELECT COUNT(*) AS n FROM recipes').n === 0) {
    RECIPE_SEED.forEach(([title, tags, buoi, summary, ingredients, steps, dung_khi, note], i) =>
      db.run('INSERT INTO recipes (title, element_tags, buoi, summary, ingredients, steps, dung_khi, note, order_num) VALUES (?,?,?,?,?,?,?,?,?)',
        [title, tags, buoi, summary, ingredients, steps, dung_khi, note, i]));
    console.log(`  Seeded ${RECIPE_SEED.length} recipes.`);
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC CONTENT ROUTES
  // ══════════════════════════════════════════════════════════

  // Attach poll tallies + the requesting user's vote to a batch of posts (mutates in place)
  function attachPollData(posts, userId) {
    const pollPosts = posts.filter(p => p.poll_options);
    if (!pollPosts.length) return;
    const ids = pollPosts.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const voteRows = db.all(`SELECT post_id, option_index, COUNT(*) AS n FROM poll_votes WHERE post_id IN (${placeholders}) GROUP BY post_id, option_index`, ids);
    const myVoteRows = userId
      ? db.all(`SELECT post_id, option_index FROM poll_votes WHERE user_id = ? AND post_id IN (${placeholders})`, [userId, ...ids])
      : [];
    pollPosts.forEach(p => {
      let options = [];
      try { options = JSON.parse(p.poll_options) || []; } catch { options = []; }
      const tallies = options.map((_, i) => voteRows.filter(v => v.post_id === p.id && v.option_index === i).reduce((n, v) => n + v.n, 0));
      p.poll_options = options;
      p.poll_tallies = tallies;
      p.poll_total = tallies.reduce((a, b) => a + b, 0);
      const mine = myVoteRows.find(v => v.post_id === p.id);
      p.my_vote = mine ? mine.option_index : null;
    });
  }

  // Feed
  app.get('/api/feed', (req, res) => {
    const { limit = 20, offset = 0, pillar = '', type = '', sort = '', space_id = '', user_id = '' } = req.query;
    let sql = `
      SELECT p.id, p.title, p.content, p.pillar, p.post_type, p.space_id,
             p.topic_id, p.image_url, p.video_url, p.doc_url, p.gif_url, p.poll_question, p.poll_options,
             p.likes_count, p.comments_count, p.is_pinned, p.created_at,
             u.id AS author_id, u.first_name, u.last_name, u.level,
             t.name AS topic_name, t.icon AS topic_icon
      FROM posts p JOIN users u ON u.id = p.user_id
      LEFT JOIN topics t ON t.id = p.topic_id
      WHERE 1=1`;
    const params = [];
    if (pillar) { sql += ' AND p.pillar = ?'; params.push(pillar); }
    if (type)   { sql += ' AND p.post_type = ?'; params.push(type); }
    if (space_id) {
      const space = db.get('SELECT * FROM spaces WHERE id = ?', [space_id]);
      if (space) {
        const { isAdmin } = getUserFlags(user_id);
        if (!canViewContent(space, user_id, isAdmin)) return res.json({ posts: [], total: 0 });
      }
      sql += ' AND p.space_id = ?'; params.push(space_id);
    } else {
      // Aggregate feed: hide posts from spaces the user isn't an approved member of (private/secret)
      const { isAdmin } = getUserFlags(user_id);
      const allSpaces = db.all('SELECT * FROM spaces');
      const accessibleIds = allSpaces.filter(s => canViewContent(s, user_id, isAdmin)).map(s => s.id);
      if (accessibleIds.length) {
        sql += ` AND (p.space_id IS NULL OR p.space_id IN (${accessibleIds.map(() => '?').join(',')}))`;
        params.push(...accessibleIds);
      } else {
        sql += ' AND p.space_id IS NULL';
      }
    }
    const order = sort === 'popular'
      ? 'p.likes_count DESC, p.comments_count DESC'
      : 'p.is_pinned DESC, p.created_at DESC';
    sql += ` ORDER BY ${order} LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));
    const posts = db.all(sql, params);
    attachPollData(posts, user_id);
    const total = db.get('SELECT COUNT(*) AS n FROM posts').n;
    res.json({ posts, total });
  });

  // Create post
  app.post('/api/posts', (req, res) => {
    const {
      user_id, title, content, pillar, post_type = 'post', space_id, topic_id,
      image_url, video_url, doc_url, gif_url, poll_question, poll_options,
    } = req.body;
    if (!user_id || !content)
      return res.status(400).json({ error: 'Thiếu thông tin bài đăng.' });
    const user = db.get('SELECT id, level FROM users WHERE id = ?', [user_id]);
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });
    if (space_id) {
      const space = db.get('SELECT * FROM spaces WHERE id = ?', [space_id]);
      if (!space) return res.status(404).json({ error: 'Space không tồn tại.' });
      const { isAdmin } = getUserFlags(user_id);
      // Public spaces are open to everyone (same rule as viewing); private/secret need an approved membership.
      if (!canViewContent(space, user_id, isAdmin))
        return res.status(403).json({ error: 'Bạn cần tham gia Space này trước khi đăng bài.' });
    }
    let pollOptionsJson = null;
    if (poll_question && Array.isArray(poll_options)) {
      const cleaned = poll_options.map(o => String(o || '').trim()).filter(Boolean);
      if (cleaned.length >= 2) pollOptionsJson = JSON.stringify(cleaned.slice(0, 6));
    }
    const result = db.run(
      `INSERT INTO posts (user_id, title, content, pillar, post_type, space_id, topic_id,
        image_url, video_url, doc_url, gif_url, poll_question, poll_options)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [user_id, title || '', content, pillar || null, post_type, space_id || null, topic_id || null,
       image_url || null, video_url || null, doc_url || null, gif_url || null,
       pollOptionsJson ? (poll_question || '').trim() : null, pollOptionsJson]
    );
    addXP(user_id, 3, 'post', `Đăng bài: ${title || content.slice(0, 30)}`);
    res.status(201).json({ success: true, post_id: result.lastInsertRowid });
  });

  // Vote (or change vote) on a post's poll
  app.post('/api/posts/:id/vote', (req, res) => {
    const { user_id, option_index } = req.body;
    if (!user_id || option_index === undefined) return res.status(400).json({ error: 'Thiếu thông tin bình chọn.' });
    const post = db.get('SELECT id, poll_options FROM posts WHERE id = ?', [req.params.id]);
    if (!post || !post.poll_options) return res.status(404).json({ error: 'Bài đăng không có poll.' });
    let options = [];
    try { options = JSON.parse(post.poll_options) || []; } catch { options = []; }
    const idx = Number(option_index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length)
      return res.status(400).json({ error: 'Lựa chọn không hợp lệ.' });
    db.run(
      `INSERT INTO poll_votes (post_id, user_id, option_index) VALUES (?,?,?)
       ON CONFLICT(post_id, user_id) DO UPDATE SET option_index = excluded.option_index`,
      [req.params.id, user_id, idx]
    );
    const voteRows = db.all('SELECT option_index, COUNT(*) AS n FROM poll_votes WHERE post_id = ? GROUP BY option_index', [req.params.id]);
    const tallies = options.map((_, i) => voteRows.find(v => v.option_index === i)?.n || 0);
    res.json({ success: true, poll_tallies: tallies, poll_total: tallies.reduce((a, b) => a + b, 0), my_vote: idx });
  });

  // ── Spaces (public) ──────────────────────────────────────────
  function getUserFlags(userId) {
    if (!userId) return { isAdmin: false };
    const u = db.get('SELECT is_admin FROM users WHERE id = ?', [userId]);
    return { isAdmin: !!(u && u.is_admin) };
  }
  function getMembership(spaceId, userId) {
    if (!userId) return null;
    return db.get('SELECT status FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId]);
  }
  // Approved in ANY space belonging to this group counts as "in the group".
  function getGroupMembership(groupId, userId) {
    if (!userId) return null;
    return db.get(
      `SELECT sm.status FROM space_members sm
       JOIN spaces s ON s.id = sm.space_id
       WHERE s.group_id = ? AND sm.user_id = ? AND sm.status = 'approved' LIMIT 1`,
      [groupId, userId]
    );
  }
  function getEnrollment(courseId, userId) {
    if (!userId) return null;
    return db.get('SELECT status FROM course_enrollments WHERE course_id = ? AND user_id = ?', [courseId, userId]);
  }
  // Called whenever an order flips to 'completed' — if the purchased product represents
  // a private course's checkout, approve (or create) that buyer's enrollment automatically.
  function autoEnrollFromProductPurchase(productId, buyerId) {
    const product = db.get('SELECT course_id FROM products WHERE id = ?', [productId]);
    if (!product || !product.course_id) return;
    const existing = db.get('SELECT id FROM course_enrollments WHERE course_id = ? AND user_id = ?', [product.course_id, buyerId]);
    if (existing) {
      db.run("UPDATE course_enrollments SET status = 'approved' WHERE id = ?", [existing.id]);
    } else {
      db.run('INSERT INTO course_enrollments (course_id, user_id, status) VALUES (?,?,?)', [product.course_id, buyerId, 'approved']);
    }
  }
  function canSeeSpace(space, userId, isAdmin) {
    if (space.visibility !== 'secret') return true;
    if (isAdmin) return true;
    const m = getMembership(space.id, userId);
    return !!(m && m.status === 'approved');
  }
  function canViewContent(space, userId, isAdmin) {
    if (space.visibility === 'public') return true;
    if (isAdmin) return true;
    const m = getMembership(space.id, userId);
    return !!(m && m.status === 'approved');
  }

  app.get('/api/spaces', (req, res) => {
    const { user_id = '' } = req.query;
    const { isAdmin } = getUserFlags(user_id);
    const spaces = db.all(`
      SELECT s.id, s.group_id, s.name, s.icon, s.description, s.visibility, s.min_level, s.allow_join_requests, s.created_at,
             COUNT(DISTINCT p.id) AS post_count,
             (SELECT COUNT(*) FROM space_members sm WHERE sm.space_id = s.id AND sm.status = 'approved') AS member_count,
             SUM(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS my_post_count
      FROM spaces s LEFT JOIN posts p ON p.space_id = s.id
      GROUP BY s.id
      ORDER BY s.order_num ASC, s.created_at ASC
    `, [user_id || 0]);
    const visible = spaces
      .filter(s => canSeeSpace(s, user_id, isAdmin))
      .map(s => {
        const m = getMembership(s.id, user_id);
        return { ...s, join_status: m ? m.status : 'none' };
      });
    res.json({ spaces: visible });
  });

  // Space groups with nested spaces the user has an APPROVED membership in — used by the sidebar.
  // (Discovery of not-yet-joined spaces happens on spaces.html, not the sidebar.)
  app.get('/api/space-groups', (req, res) => {
    const { user_id = '', all = '' } = req.query;
    const { isAdmin } = getUserFlags(user_id);
    const groups = db.all('SELECT id, name FROM space_groups ORDER BY order_num ASC, created_at ASC');
    if (all) return res.json({ groups, is_admin: isAdmin });
    const spaces = db.all(
      'SELECT id, group_id, name, icon, visibility, min_level FROM spaces ORDER BY order_num ASC, created_at ASC'
    );
    const result = groups
      .map(g => ({
        id: g.id,
        name: g.name,
        spaces: spaces
          .filter(s => s.group_id === g.id)
          .map(s => {
            const m = getMembership(s.id, user_id);
            return { ...s, join_status: m ? m.status : 'none' };
          })
          .filter(s => s.join_status === 'approved'),
      }))
      .filter(g => g.spaces.length > 0);
    res.json({ groups: result, is_admin: isAdmin });
  });

  // Member-facing space creation — only community admins (users.is_admin) can create
  app.post('/api/spaces', (req, res) => {
    const { user_id, group_id, name, icon = '💬', description = '', visibility = 'public', allow_join_requests = 1 } = req.body;
    const u = db.get('SELECT is_admin FROM users WHERE id = ?', [user_id]);
    if (!u || !u.is_admin) return res.status(403).json({ error: 'Bạn không có quyền tạo Space.' });
    if (!name?.trim()) return res.status(400).json({ error: 'Tên Space không được để trống.' });
    if (!group_id) return res.status(400).json({ error: 'Vui lòng chọn Group cho Space.' });
    const vis = ['public', 'private', 'secret'].includes(visibility) ? visibility : 'public';
    const r = db.run(
      'INSERT INTO spaces (group_id, name, icon, description, visibility, allow_join_requests) VALUES (?,?,?,?,?,?)',
      [group_id, name.trim(), icon || '💬', description || '', vis, allow_join_requests ? 1 : 0]
    );
    // Auto-join the creator so the new space shows up in their own sidebar immediately
    db.run('INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,?)', [r.lastInsertRowid, user_id, 'approved']);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.get('/api/spaces/:id', (req, res) => {
    const space = db.get('SELECT * FROM spaces WHERE id = ?', [req.params.id]);
    if (!space) return res.status(404).json({ error: 'Space không tồn tại.' });
    const userId = req.query.user_id;
    const { isAdmin } = getUserFlags(userId);
    if (!canSeeSpace(space, userId, isAdmin))
      return res.status(404).json({ error: 'Space không tồn tại.' });
    const m = getMembership(space.id, userId);
    res.json({
      space,
      join_status: m ? m.status : 'none',
      content_locked: !canViewContent(space, userId, isAdmin),
    });
  });

  // Topics of a space — used to populate the "Topic" select when posting
  app.get('/api/topics', (req, res) => {
    const { space_id } = req.query;
    if (!space_id) return res.status(400).json({ error: 'Thiếu space_id.' });
    const topics = db.all('SELECT id, space_id, name, icon FROM topics WHERE space_id = ? ORDER BY order_num ASC, created_at ASC', [space_id]);
    res.json({ topics });
  });

  // Join / request-to-join a space
  app.post('/api/spaces/:id/join', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const space = db.get('SELECT * FROM spaces WHERE id = ?', [req.params.id]);
    if (!space) return res.status(404).json({ error: 'Space không tồn tại.' });

    if (space.visibility === 'secret')
      return res.status(403).json({ error: 'Bạn cần được mời để tham gia Space này.' });

    if (space.visibility === 'private' && !space.allow_join_requests)
      return res.status(403).json({ error: 'Space này hiện không nhận yêu cầu tham gia mới.' });

    const status = space.visibility === 'public' ? 'approved' : 'pending';
    const existing = db.get('SELECT id, status FROM space_members WHERE space_id = ? AND user_id = ?', [req.params.id, user_id]);
    if (existing) {
      if (existing.status !== status && !(existing.status === 'approved'))
        db.run('UPDATE space_members SET status = ? WHERE id = ?', [status, existing.id]);
    } else {
      db.run('INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,?)', [req.params.id, user_id, status]);
    }
    res.json({ success: true, status: existing?.status === 'approved' ? 'approved' : status });
  });

  // Single post detail
  app.get('/api/posts/:id', (req, res) => {
    const p = db.get(
      `SELECT p.id, p.title, p.content, p.pillar, p.post_type, p.space_id, p.is_pinned,
              p.topic_id, p.image_url, p.video_url, p.doc_url, p.gif_url, p.poll_question, p.poll_options,
              p.likes_count, p.comments_count, p.created_at,
              u.id AS author_id, u.first_name, u.last_name, u.level,
              t.name AS topic_name, t.icon AS topic_icon
       FROM posts p JOIN users u ON u.id = p.user_id
       LEFT JOIN topics t ON t.id = p.topic_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!p) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    attachPollData([p], req.query.user_id);
    res.json(p);
  });

  // Toggle pin — community admins only
  app.post('/api/posts/:id/pin', (req, res) => {
    const { user_id } = req.body;
    const { isAdmin } = getUserFlags(user_id);
    if (!isAdmin) return res.status(403).json({ error: 'Chỉ admin mới có thể ghim bài viết.' });
    const post = db.get('SELECT id, is_pinned FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng.' });
    const newVal = post.is_pinned ? 0 : 1;
    db.run('UPDATE posts SET is_pinned = ? WHERE id = ?', [newVal, req.params.id]);
    res.json({ success: true, is_pinned: newVal });
  });

  // Comments for a post (flat list with parent_id; frontend builds tree)
  app.get('/api/posts/:id/comments', (req, res) => {
    const comments = db.all(
      `SELECT c.id, c.parent_id, c.content, c.created_at,
              u.id AS author_id, u.first_name, u.last_name, u.level
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ?
       ORDER BY COALESCE(c.parent_id, c.id), c.id ASC`,
      [req.params.id]
    );
    res.json({ comments });
  });

  // Add comment or reply
  app.post('/api/posts/:id/comments', (req, res) => {
    const { user_id, content, parent_id = null } = req.body;
    if (!user_id || !content?.trim()) return res.status(400).json({ error: 'Thiếu thông tin' });
    db.run('INSERT INTO comments (post_id, user_id, content, parent_id) VALUES (?,?,?,?)',
      [req.params.id, user_id, content.trim(), parent_id || null]);
    db.run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [req.params.id]);
    const post = db.get('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (post && post.user_id !== Number(user_id)) {
      addXP(user_id, 2, 'comment', 'Bình luận bài viết');
    }
    res.json({ success: true });
  });

  // Like a post (toggle)
  app.post('/api/posts/:id/like', (req, res) => {
    db.run('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Leaderboard
  app.get('/api/leaderboard', (req, res) => {
    const { period = 'alltime', limit = 10, user_id } = req.query;

    let ranked;
    if (period === 'alltime') {
      ranked = db.all(
        `SELECT u.id, u.first_name, u.last_name, u.level, u.xp AS period_xp
         FROM users u WHERE u.status = 'active'
         ORDER BY u.xp DESC LIMIT ?`, [Number(limit)]
      );
    } else {
      const days = period === '7day' ? 7 : 30;
      ranked = db.all(
        `SELECT u.id, u.first_name, u.last_name, u.level,
                COALESCE(SUM(x.amount), 0) AS period_xp
         FROM users u
         LEFT JOIN xp_log x ON x.user_id = u.id
           AND x.created_at >= datetime('now', ? || ' days', 'localtime')
         WHERE u.status = 'active'
         GROUP BY u.id
         ORDER BY period_xp DESC LIMIT ?`,
        [`-${days}`, Number(limit)]
      );
    }

    ranked.forEach((r, i) => { r.rank = i + 1; });

    // User's own rank
    let myRank = null;
    if (user_id) {
      const uid = Number(user_id);
      if (period === 'alltime') {
        const me = db.get('SELECT xp FROM users WHERE id = ?', [uid]);
        if (me) {
          const above = db.get('SELECT COUNT(*) AS n FROM users WHERE xp > ? AND status = ?', [me.xp, 'active']).n;
          const myXp  = db.get(
            `SELECT u.xp AS period_xp FROM users u WHERE u.id = ?`, [uid]
          );
          myRank = { rank: above + 1, period_xp: myXp ? myXp.period_xp : 0 };
        }
      } else {
        const days = period === '7day' ? 7 : 30;
        const myXpRow = db.get(
          `SELECT COALESCE(SUM(amount), 0) AS period_xp FROM xp_log
           WHERE user_id = ? AND created_at >= datetime('now', ? || ' days', 'localtime')`,
          [uid, `-${days}`]
        );
        const myPxp = myXpRow ? myXpRow.period_xp : 0;
        const aboveCount = db.get(
          `SELECT COUNT(DISTINCT u.id) AS n FROM users u
           LEFT JOIN xp_log x ON x.user_id = u.id
             AND x.created_at >= datetime('now', ? || ' days', 'localtime')
           WHERE u.status = 'active'
           GROUP BY u.id
           HAVING COALESCE(SUM(x.amount), 0) > ?`,
          [`-${days}`, myPxp]
        );
        myRank = { rank: (aboveCount ? aboveCount.n : 0) + 1, period_xp: myPxp };
      }
    }

    res.json({ ranked, my_rank: myRank });
  });

  // Challenge days + user progress
  app.get('/api/challenge/days', (req, res) => {
    const { user_id } = req.query;
    const days = db.all('SELECT * FROM challenge_days ORDER BY day_number');
    if (!user_id) return res.json({ days, completed: [] });

    const completed = db.all(
      'SELECT day_number FROM user_challenge_progress WHERE user_id = ?',
      [Number(user_id)]
    ).map(r => r.day_number);

    res.json({ days, completed });
  });

  // Complete a challenge day
  app.post('/api/challenge/complete', (req, res) => {
    const { user_id, day_number } = req.body;
    if (!user_id || !day_number)
      return res.status(400).json({ error: 'Thiếu thông tin.' });

    const already = db.get(
      'SELECT id FROM user_challenge_progress WHERE user_id = ? AND day_number = ?',
      [user_id, day_number]
    );
    if (already) return res.status(409).json({ error: 'Ngày này đã hoàn thành.' });

    const day = db.get('SELECT xp_reward FROM challenge_days WHERE day_number = ?', [day_number]);
    if (!day) return res.status(404).json({ error: 'Ngày không tồn tại.' });

    db.run(
      'INSERT INTO user_challenge_progress (user_id, day_number) VALUES (?,?)',
      [user_id, day_number]
    );
    addXP(user_id, day.xp_reward, 'challenge', `Hoàn thành ngày ${day_number}`);

    res.json({ success: true, xp_earned: day.xp_reward });
  });

  // Members list (public)
  app.get('/api/members', (req, res) => {
    const { search = '', limit = 24, offset = 0 } = req.query;
    const like = `%${search}%`;
    const users = db.all(`
      SELECT id, first_name, last_name, level, xp, streak, created_at, bio, location
      FROM users
      WHERE status = 'active' AND (first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)
      ORDER BY xp DESC
      LIMIT ? OFFSET ?
    `, [like, like, like, Number(limit), Number(offset)]);
    users.forEach(u => {
      u.post_count      = db.get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?', [u.id]).n;
      u.completed_days  = db.get('SELECT COUNT(*) AS n FROM user_challenge_progress WHERE user_id = ?', [u.id]).n;
    });
    const total = db.get(
      `SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND (first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)`,
      [like, like, like]
    ).n;
    res.json({ users, total });
  });

  // Global topbar search (public) — posts + members + products, 5 each
  app.get('/api/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ posts: [], users: [], products: [] });
    const like = `%${q}%`;

    const posts = db.all(`
      SELECT p.id, p.title, p.content, u.first_name, u.last_name
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.space_id IS NULL AND (p.title LIKE ? OR p.content LIKE ?)
      ORDER BY p.created_at DESC LIMIT 5
    `, [like, like]);

    const users = db.all(`
      SELECT id, first_name, last_name, level, xp
      FROM users
      WHERE status = 'active' AND (first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)
      ORDER BY xp DESC LIMIT 5
    `, [like, like, like]);

    const products = db.all(`
      SELECT id, title, price, cover_color
      FROM products
      WHERE status = 'published' AND (title LIKE ? OR description LIKE ?)
      ORDER BY sales_count DESC LIMIT 5
    `, [like, like]);

    res.json({ posts, users, products });
  });

  // Community stats bar (public) — members / admins / online counts
  app.get('/api/community/stats', (req, res) => {
    const members = db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n;
    const admins = db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND is_admin = 1").n;
    const online = db.get(
      "SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND last_active_at >= datetime('now', '-10 minutes', 'localtime')"
    ).n;
    res.json({ members, admins, online });
  });

  // About page bundle (public) — intro, media gallery, member count, creator
  app.get('/api/about', (req, res) => {
    const rows = db.all("SELECT key, value FROM site_settings WHERE key IN ('about_intro','about_media')");
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    let media = [];
    try { media = JSON.parse(settings.about_media || '[]'); } catch { media = []; }

    const member_count = db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n;
    const creator = db.get(
      "SELECT id, first_name, last_name FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1"
    );

    res.json({
      intro: settings.about_intro || '',
      media,
      member_count,
      creator: creator || null,
    });
  });

  // User's recent posts
  app.get('/api/users/:id/posts', (req, res) => {
    const posts = db.all(
      `SELECT id, title, content, pillar, post_type, likes_count, comments_count, created_at
       FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
      [req.params.id]
    );
    res.json({ posts });
  });

  // User profile — email/phone are only included when viewing your own profile (PII, not public)
  app.get('/api/users/:id', (req, res) => {
    const isSelf = req.query.requester_id && Number(req.query.requester_id) === Number(req.params.id);
    const fields = 'id, first_name, last_name, level, xp, streak, created_at, bio, location, social_links, is_admin'
      + (isSelf ? ', email, phone, telegram_chat_id' : '');
    const user = db.get(`SELECT ${fields} FROM users WHERE id = ?`, [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });
    user.is_admin = !!user.is_admin;
    try { user.social_links = user.social_links ? JSON.parse(user.social_links) : {}; } catch { user.social_links = {}; }

    const completed_days = db.get(
      'SELECT COUNT(*) AS n FROM user_challenge_progress WHERE user_id = ?',
      [req.params.id]
    ).n;
    const post_count = db.get(
      'SELECT COUNT(*) AS n FROM posts WHERE user_id = ?',
      [req.params.id]
    ).n;
    const cot_count = db.get(
      "SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND post_type = 'cot'",
      [req.params.id]
    ).n;

    // Pillar post counts
    const pillarRows = db.all(
      "SELECT pillar, COUNT(*) AS n FROM posts WHERE user_id = ? GROUP BY pillar",
      [req.params.id]
    );
    // Keyed dynamically off whatever pillar keys posts actually use — not a
    // hardcoded whitelist — so admin-created/renamed pillars (see
    // /api/admin/pillars) are always counted correctly.
    const pillar_counts = {};
    pillarRows.forEach(r => { if (r.pillar) pillar_counts[r.pillar] = r.n; });

    res.json({ ...user, completed_days, post_count, cot_count, pillar_counts });
  });

  // Update own profile (bio, location, social links, name) — self-service only
  app.patch('/api/users/:id', (req, res) => {
    const targetId = Number(req.params.id);
    const requesterId = Number(req.body.user_id);
    if (!requesterId || requesterId !== targetId)
      return res.status(403).json({ error: 'Bạn chỉ có thể chỉnh sửa hồ sơ của chính mình.' });

    const user = db.get('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });

    const { first_name, last_name, bio, location, phone, social_links } = req.body;
    if (first_name !== undefined) {
      if (!String(first_name).trim()) return res.status(400).json({ error: 'Tên không được để trống.' });
      db.run('UPDATE users SET first_name = ? WHERE id = ?', [toTitleCase(first_name), targetId]);
    }
    if (last_name !== undefined)  db.run('UPDATE users SET last_name = ? WHERE id = ?', [toTitleCase(last_name), targetId]);
    if (bio !== undefined)        db.run('UPDATE users SET bio = ? WHERE id = ?', [String(bio).slice(0, 300), targetId]);
    if (location !== undefined)   db.run('UPDATE users SET location = ? WHERE id = ?', [String(location).trim(), targetId]);
    if (phone !== undefined)      db.run('UPDATE users SET phone = ? WHERE id = ?', [String(phone).trim().slice(0, 20), targetId]);
    if (social_links !== undefined) {
      const allowed = ['website', 'facebook', 'instagram', 'x', 'youtube', 'linkedin'];
      const clean = {};
      allowed.forEach(k => { if (social_links[k]) clean[k] = String(social_links[k]).trim().slice(0, 200); });
      db.run('UPDATE users SET social_links = ? WHERE id = ?', [JSON.stringify(clean), targetId]);
    }
    res.json({ success: true });
  });

  // User activity heatmap (last 365 days of XP)
  app.get('/api/users/:id/activity', (req, res) => {
    const rows = db.all(
      `SELECT date(created_at) AS day, SUM(amount) AS xp
       FROM xp_log WHERE user_id = ? AND created_at >= date('now','-365 days')
       GROUP BY date(created_at)`,
      [req.params.id]
    );
    const map = {};
    rows.forEach(r => { map[r.day] = r.xp; });
    res.json({ activity: map });
  });

  // User's commented posts
  app.get('/api/users/:id/comments', (req, res) => {
    const posts = db.all(
      `SELECT DISTINCT p.id, p.title, p.content, p.pillar, p.post_type,
        p.likes_count, p.comments_count, p.created_at,
        u.first_name AS author_first, u.last_name AS author_last,
        (SELECT content FROM comments WHERE post_id = p.id AND user_id = ? ORDER BY created_at DESC LIMIT 1) AS my_comment,
        (SELECT created_at FROM comments WHERE post_id = p.id AND user_id = ? ORDER BY created_at DESC LIMIT 1) AS commented_at
       FROM comments c
       JOIN posts p ON p.id = c.post_id
       JOIN users u ON u.id = p.user_id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC
       LIMIT 20`,
      [req.params.id, req.params.id, req.params.id]
    );
    res.json({ posts });
  });

  // ══════════════════════════════════════════════════════════
  // CHALLENGE SYSTEM (multi-challenge)
  // ══════════════════════════════════════════════════════════

  app.get('/api/challenges', (req, res) => {
    const { user_id } = req.query;
    const list = db.all("SELECT * FROM challenges WHERE status = 'active' ORDER BY created_at DESC");
    list.forEach(c => {
      c.day_count = db.get('SELECT COUNT(*) AS n FROM challenge_days WHERE challenge_id = ?', [c.id]).n;
      c.member_count = db.get(
        "SELECT COUNT(*) AS n FROM challenge_enrollments WHERE challenge_id = ? AND status IN ('approved','started')",
        [c.id]
      ).n;
      if (user_id) {
        c.my_completed = db.get(
          "SELECT COUNT(*) AS n FROM challenge_submissions WHERE challenge_id = ? AND user_id = ? AND status = 'approved'",
          [c.id, Number(user_id)]
        ).n;
        c.enrollment = db.get(
          'SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ?',
          [Number(user_id), c.id]
        ) || null;
      }
    });
    res.json({ challenges: list });
  });

  app.get('/api/challenges/:id', (req, res) => {
    const cid = Number(req.params.id);
    const { user_id } = req.query;
    const challenge = db.get('SELECT * FROM challenges WHERE id = ?', [cid]);
    if (!challenge) return res.status(404).json({ error: 'Challenge không tồn tại.' });
    const days = db.all('SELECT * FROM challenge_days WHERE challenge_id = ? ORDER BY day_number', [cid]);
    const submissions = {};
    let enrollment = null;
    if (user_id) {
      db.all('SELECT * FROM challenge_submissions WHERE challenge_id = ? AND user_id = ?', [cid, Number(user_id)])
        .forEach(s => { submissions[s.day_id] = s; });
      enrollment = db.get(
        'SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ?',
        [Number(user_id), cid]
      ) || null;
    }
    res.json({ challenge, days, submissions, enrollment });
  });

  app.post('/api/challenges/:id/days/:dayId/submit', (req, res) => {
    const { user_id, content } = req.body;
    const challenge_id = Number(req.params.id);
    const day_id = Number(req.params.dayId);
    if (!user_id || !String(content || '').trim())
      return res.status(400).json({ error: 'Vui lòng nhập nội dung bài nộp.' });
    const day = db.get('SELECT * FROM challenge_days WHERE id = ? AND challenge_id = ?', [day_id, challenge_id]);
    if (!day) return res.status(404).json({ error: 'Ngày không tồn tại.' });
    const enrollment = db.get(
      "SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ? AND status = 'approved'",
      [Number(user_id), challenge_id]
    );
    if (!enrollment || !enrollment.started_at)
      return res.status(403).json({ error: 'Bạn chưa bắt đầu thử thách.' });
    const DAY_MS = 24 * 3600 * 1000;
    const startMs = new Date(enrollment.started_at).getTime();
    const closeMs = startMs + day.day_number * DAY_MS;
    const isLate = Date.now() > closeMs ? 1 : 0;
    const existing = db.get('SELECT id, status FROM challenge_submissions WHERE user_id = ? AND day_id = ?', [user_id, day_id]);
    if (existing) {
      if (existing.status === 'pending')  return res.status(409).json({ error: 'Bài đang chờ duyệt.' });
      if (existing.status === 'approved') return res.status(409).json({ error: 'Bài đã được duyệt.' });
      db.run(
        "UPDATE challenge_submissions SET content = ?, status = 'pending', admin_note = NULL, submitted_at = datetime('now','localtime'), is_late = ? WHERE id = ?",
        [content.trim(), isLate, existing.id]
      );
      return res.json({ success: true, action: 'resubmitted' });
    }
    const result = db.run(
      'INSERT INTO challenge_submissions (user_id, challenge_id, day_id, content, is_late) VALUES (?,?,?,?,?)',
      [user_id, challenge_id, day_id, content.trim(), isLate]
    );
    res.status(201).json({ success: true, submission_id: result.lastInsertRowid });
  });

  app.post('/api/challenges/:id/enroll', (req, res) => {
    const { user_id } = req.body;
    const challenge_id = Number(req.params.id);
    if (!user_id) return res.status(400).json({ error: 'Vui lòng đăng nhập.' });
    const challenge = db.get("SELECT id FROM challenges WHERE id = ? AND status = 'active'", [challenge_id]);
    if (!challenge) return res.status(404).json({ error: 'Thử thách không tồn tại.' });
    const existing = db.get(
      'SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ?',
      [Number(user_id), challenge_id]
    );
    if (existing) return res.status(409).json({ error: 'Bạn đã đăng ký thử thách này rồi.', enrollment: existing });
    db.run('INSERT INTO challenge_enrollments (user_id, challenge_id) VALUES (?,?)', [Number(user_id), challenge_id]);
    res.status(201).json({ success: true, status: 'pending' });

    // Enrollment pending email
    const enrollUser = db.get('SELECT first_name, last_name, email FROM users WHERE id = ?', [Number(user_id)]);
    const enrollChallenge = db.get('SELECT title FROM challenges WHERE id = ?', [challenge_id]);
    if (enrollUser && enrollChallenge) {
      sendEmail({
        to: enrollUser.email,
        subject: '✅ Yêu cầu tham gia thử thách đã được nhận',
        html: emailWrap('Yêu cầu của bạn đã được ghi nhận!', `
          <p>Xin chào <strong>${enrollUser.first_name}</strong>,</p>
          <p>Chúng tôi đã nhận được yêu cầu tham gia thử thách của bạn:</p>
          <div class="rule"><strong>${enrollChallenge.title}</strong></div>
          <p>Yêu cầu của bạn đang <span class="badge">Chờ duyệt</span>. Admin sẽ xem xét và phê duyệt trong vòng <strong>24 giờ</strong>.</p>
          <p>Khi được duyệt, bạn sẽ nhận thêm một email xác nhận kèm nội quy tham gia.</p>
          <a class="btn" href="${SITE_URL}/challenge.html">Xem trang thử thách</a>
        `)
      });
    }
  });

  app.post('/api/challenges/:id/start', (req, res) => {
    const { user_id } = req.body;
    const challenge_id = Number(req.params.id);
    if (!user_id) return res.status(400).json({ error: 'Vui lòng đăng nhập.' });
    const enroll = db.get(
      "SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ? AND status = 'approved'",
      [Number(user_id), challenge_id]
    );
    if (!enroll) return res.status(403).json({ error: 'Bạn chưa được duyệt tham gia.' });
    if (enroll.started_at) return res.json({ success: true, already: true });
    db.run("UPDATE challenge_enrollments SET started_at = datetime('now','localtime') WHERE id = ?", [enroll.id]);
    res.json({ success: true });
  });

  // ── Admin challenge routes ─────────────────────────────────

  app.get('/api/admin/challenges', requireAdmin, (_req, res) => {
    const list = db.all('SELECT * FROM challenges ORDER BY created_at DESC');
    list.forEach(c => {
      c.day_count = db.get('SELECT COUNT(*) AS n FROM challenge_days WHERE challenge_id = ?', [c.id]).n;
      c.pending_count = db.get("SELECT COUNT(*) AS n FROM challenge_submissions WHERE challenge_id = ? AND status = 'pending'", [c.id]).n;
    });
    res.json({ challenges: list });
  });

  app.post('/api/admin/challenges', requireAdmin, (req, res) => {
    const { title, description, duration = 21, cover_color = '#0ea5e9', status = 'draft' } = req.body;
    if (!title) return res.status(400).json({ error: 'Tiêu đề là bắt buộc.' });
    const result = db.run(
      'INSERT INTO challenges (title, description, duration, cover_color, status) VALUES (?,?,?,?,?)',
      [title, description || '', Number(duration), cover_color, status]
    );
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  });

  app.patch('/api/admin/challenges/:id', requireAdmin, (req, res) => {
    const { title, description, status, cover_color, duration } = req.body;
    const id = req.params.id;
    if (title !== undefined)       db.run('UPDATE challenges SET title = ? WHERE id = ?', [title, id]);
    if (description !== undefined) db.run('UPDATE challenges SET description = ? WHERE id = ?', [description, id]);
    if (status !== undefined)      db.run('UPDATE challenges SET status = ? WHERE id = ?', [status, id]);
    if (cover_color !== undefined) db.run('UPDATE challenges SET cover_color = ? WHERE id = ?', [cover_color, id]);
    if (duration !== undefined)    db.run('UPDATE challenges SET duration = ? WHERE id = ?', [Number(duration), id]);
    res.json({ success: true });
  });

  app.post('/api/admin/challenges/:id/days', requireAdmin, (req, res) => {
    const { title, intro, description, instructions, xp_reward = 5, duration_hours = 24 } = req.body;
    const challenge_id = Number(req.params.id);
    if (!title) return res.status(400).json({ error: 'Tiêu đề ngày là bắt buộc.' });
    const maxDay = db.get('SELECT COALESCE(MAX(day_number),0) AS m FROM challenge_days WHERE challenge_id = ?', [challenge_id]);
    const day_number = maxDay.m + 1;
    const result = db.run(
      'INSERT INTO challenge_days (challenge_id, day_number, title, intro, description, instructions, xp_reward, duration_hours) VALUES (?,?,?,?,?,?,?,?)',
      [challenge_id, day_number, title, intro || '', description || '', instructions || '', Number(xp_reward), Number(duration_hours)]
    );
    res.status(201).json({ success: true, id: result.lastInsertRowid, day_number });
  });

  app.patch('/api/admin/challenge-days/:id', requireAdmin, (req, res) => {
    const { title, intro, description, instructions, xp_reward, duration_hours, submission_deadline } = req.body;
    const id = req.params.id;
    if (title !== undefined)               db.run('UPDATE challenge_days SET title = ? WHERE id = ?', [title, id]);
    if (intro !== undefined)               db.run('UPDATE challenge_days SET intro = ? WHERE id = ?', [intro, id]);
    if (description !== undefined)         db.run('UPDATE challenge_days SET description = ? WHERE id = ?', [description, id]);
    if (instructions !== undefined)        db.run('UPDATE challenge_days SET instructions = ? WHERE id = ?', [instructions, id]);
    if (xp_reward !== undefined)           db.run('UPDATE challenge_days SET xp_reward = ? WHERE id = ?', [Number(xp_reward), id]);
    if (duration_hours !== undefined)      db.run('UPDATE challenge_days SET duration_hours = ? WHERE id = ?', [Number(duration_hours), id]);
    if (submission_deadline !== undefined) db.run('UPDATE challenge_days SET submission_deadline = ? WHERE id = ?', [submission_deadline || null, id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/challenge-days/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    const subCount = db.get('SELECT COUNT(*) AS n FROM challenge_submissions WHERE day_id = ?', [id]).n;
    if (subCount > 0)
      return res.status(409).json({ error: `Ngày này có ${subCount} bài nộp. Xoá bài nộp trước rồi mới xoá ngày.` });
    db.run('DELETE FROM challenge_days WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.get('/api/admin/submissions', requireAdmin, (req, res) => {
    const { challenge_id = '', status = '', limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT cs.id, cs.status, cs.content, cs.admin_note, cs.submitted_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             cd.day_number, cd.title AS day_title, cd.xp_reward,
             c.title AS challenge_title, c.id AS challenge_id
      FROM challenge_submissions cs
      JOIN users u ON u.id = cs.user_id
      JOIN challenge_days cd ON cd.id = cs.day_id
      JOIN challenges c ON c.id = cs.challenge_id
      WHERE 1=1`;
    const params = [];
    if (challenge_id) { sql += ' AND cs.challenge_id = ?'; params.push(Number(challenge_id)); }
    if (status)       { sql += ' AND cs.status = ?';       params.push(status); }
    sql += ' ORDER BY cs.submitted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const submissions = db.all(sql, params);
    let cntSql = 'SELECT COUNT(*) AS n FROM challenge_submissions WHERE 1=1';
    const cntP = [];
    if (challenge_id) { cntSql += ' AND challenge_id = ?'; cntP.push(Number(challenge_id)); }
    if (status)       { cntSql += ' AND status = ?';       cntP.push(status); }
    const total = db.get(cntSql, cntP).n;
    const pending_count = db.get("SELECT COUNT(*) AS n FROM challenge_submissions WHERE status = 'pending'").n;
    res.json({ submissions, total, pending_count });
  });

  app.get('/api/admin/challenge-progress', requireAdmin, (req, res) => {
    try {
      const { challenge_id } = req.query;
      const challenges = db.all('SELECT id, title FROM challenges ORDER BY id');

      const enrollWhere = challenge_id ? 'WHERE e.challenge_id = ?' : '';
      const enrollParams = challenge_id ? [Number(challenge_id)] : [];
      const enrollments = db.all(`
        SELECT e.id AS enrollment_id, e.user_id, e.challenge_id, e.status AS enroll_status, e.enrolled_at, e.started_at,
               (u.first_name || ' ' || u.last_name) AS name, u.email, u.avatar_url AS avatar,
               c.title AS challenge_title,
               (SELECT COUNT(*) FROM challenge_days cd WHERE cd.challenge_id = c.id) AS total_days
        FROM challenge_enrollments e
        JOIN users u ON e.user_id = u.id
        JOIN challenges c ON e.challenge_id = c.id
        ${enrollWhere}
        ORDER BY e.challenge_id, u.first_name
      `, enrollParams);

      const subWhere = challenge_id ? 'WHERE cs.challenge_id = ?' : '';
      const subParams = challenge_id ? [Number(challenge_id)] : [];
      const submissions = db.all(`
        SELECT cs.user_id, cs.challenge_id, cd.day_number, cs.status, cs.is_late
        FROM challenge_submissions cs
        JOIN challenge_days cd ON cs.day_id = cd.id
        ${subWhere}
      `, subParams);

      const subMap = {};
      for (const s of submissions) {
        const key = `${s.user_id}_${s.challenge_id}`;
        if (!subMap[key]) subMap[key] = {};
        subMap[key][s.day_number] = { status: s.status, is_late: s.is_late };
      }

      const members = enrollments.map(e => {
        const key = `${e.user_id}_${e.challenge_id}`;
        const dayMap = subMap[key] || {};
        const totalDays = e.total_days || 21;
        let approved = 0, pending = 0, revision = 0, late = 0;
        const days = [];
        for (let d = 1; d <= totalDays; d++) {
          const entry = dayMap[d] || {};
          const st = entry.status || 'empty';
          days.push({ day: d, status: st, is_late: entry.is_late || 0 });
          if (st === 'approved') approved++;
          else if (st === 'pending') pending++;
          else if (st === 'needs_revision') revision++;
          if (entry.is_late) late++;
        }
        return {
          enrollment_id: e.enrollment_id,
          user_id: e.user_id,
          name: e.name,
          email: e.email,
          avatar: e.avatar,
          challenge_id: e.challenge_id,
          challenge_title: e.challenge_title,
          enroll_status: e.enroll_status,
          enrolled_at: e.enrolled_at,
          started_at: e.started_at || null,
          total_days: totalDays,
          days,
          stats: { approved, pending, revision, late, empty: totalDays - approved - pending - revision }
        };
      });

      const total = members.length;
      const active = members.filter(m => m.stats.approved > 0 || m.stats.pending > 0).length;
      const completed = members.filter(m => m.stats.approved === m.total_days).length;
      const avg_days = total > 0
        ? Math.round(members.reduce((sum, m) => sum + m.stats.approved, 0) / total)
        : 0;

      res.json({ challenges, members, summary: { total, active, completed, avg_days } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/admin/submissions/:id', requireAdmin, (req, res) => {
    const { action, admin_note } = req.body;
    const id = Number(req.params.id);
    if (!['approve', 'revision'].includes(action))
      return res.status(400).json({ error: 'Action không hợp lệ.' });
    const sub = db.get(
      `SELECT cs.*, cs.user_id, cd.xp_reward, cd.day_number
       FROM challenge_submissions cs JOIN challenge_days cd ON cd.id = cs.day_id WHERE cs.id = ?`, [id]
    );
    if (!sub) return res.status(404).json({ error: 'Submission không tồn tại.' });
    if (action === 'approve') {
      db.run("UPDATE challenge_submissions SET status = 'approved', reviewed_at = datetime('now','localtime'), admin_note = NULL WHERE id = ?", [id]);
      const already = db.get('SELECT id FROM user_challenge_progress WHERE user_id = ? AND day_number = ?', [sub.user_id, sub.day_number]);
      if (!already) {
        db.run('INSERT INTO user_challenge_progress (user_id, day_number) VALUES (?,?)', [sub.user_id, sub.day_number]);
        addXP(sub.user_id, sub.xp_reward, 'challenge', `Hoàn thành Ngày ${sub.day_number} (đã duyệt)`);
      }
    } else {
      db.run(
        "UPDATE challenge_submissions SET status = 'needs_revision', admin_note = ?, reviewed_at = datetime('now','localtime') WHERE id = ?",
        [admin_note || 'Vui lòng chỉnh sửa và nộp lại.', id]
      );
    }
    res.json({ success: true });
  });

  // ── Admin enrollment routes ────────────────────────────────

  app.get('/api/admin/enrollments', requireAdmin, (req, res) => {
    const { challenge_id = '', status = '', limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT ce.id, ce.status, ce.enrolled_at, ce.approved_at, ce.started_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             c.title AS challenge_title, c.id AS challenge_id
      FROM challenge_enrollments ce
      JOIN users u ON u.id = ce.user_id
      JOIN challenges c ON c.id = ce.challenge_id
      WHERE 1=1`;
    const params = [];
    if (challenge_id) { sql += ' AND ce.challenge_id = ?'; params.push(Number(challenge_id)); }
    if (status)       { sql += ' AND ce.status = ?';       params.push(status); }
    sql += ' ORDER BY ce.enrolled_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const enrollments = db.all(sql, params);
    let cntSql = 'SELECT COUNT(*) AS n FROM challenge_enrollments WHERE 1=1';
    const cntP = [];
    if (challenge_id) { cntSql += ' AND challenge_id = ?'; cntP.push(Number(challenge_id)); }
    if (status)       { cntSql += ' AND status = ?';       cntP.push(status); }
    const total = db.get(cntSql, cntP).n;
    const pending_count = db.get("SELECT COUNT(*) AS n FROM challenge_enrollments WHERE status = 'pending'").n;
    res.json({ enrollments, total, pending_count });
  });

  app.patch('/api/admin/enrollments/:id', requireAdmin, (req, res) => {
    const { action } = req.body;
    const id = Number(req.params.id);
    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ error: 'Action không hợp lệ.' });
    const enroll = db.get('SELECT * FROM challenge_enrollments WHERE id = ?', [id]);
    if (!enroll) return res.status(404).json({ error: 'Enrollment không tồn tại.' });
    if (action === 'approve') {
      db.run("UPDATE challenge_enrollments SET status = 'approved', approved_at = datetime('now','localtime') WHERE id = ?", [id]);
      db.run('INSERT INTO notifications (user_id, type, content) VALUES (?,?,?)',
        [enroll.user_id, 'enrollment_approved', 'Yêu cầu tham gia thử thách đã được duyệt! Vào trang thử thách để bắt đầu.']);

      // Approval email with community rules
      const approvedUser = db.get('SELECT first_name, last_name, email FROM users WHERE id = ?', [enroll.user_id]);
      const approvedChallenge = db.get('SELECT title FROM challenges WHERE id = ?', [enroll.challenge_id]);
      if (approvedUser && approvedChallenge) {
        sendEmail({
          to: approvedUser.email,
          subject: '🎉 Chúc mừng! Bạn đã được duyệt tham gia thử thách',
          html: emailWrap('Chào mừng bạn tham gia thử thách!', `
            <p>Xin chào <strong>${approvedUser.first_name}</strong>,</p>
            <p>🎉 Tuyệt vời! Bạn đã được duyệt tham gia:</p>
            <div class="rule"><strong>${approvedChallenge.title}</strong></div>
            <a class="btn" href="${SITE_URL}/challenge.html">Bắt đầu thử thách ngay</a>
            <p style="margin-top:24px"><strong>📋 Nội quy cộng đồng</strong></p>
            <div class="rule">1️⃣ <strong>Cam kết hoàn thành:</strong> Nộp bài đúng hạn mỗi ngày. Mỗi ngày có deadline riêng — hãy kiểm tra trang thử thách.</div>
            <div class="rule">2️⃣ <strong>Nộp bài thật:</strong> Không copy bài của người khác. Screenshot, link, ảnh phải là kết quả thực tế của bạn.</div>
            <div class="rule">3️⃣ <strong>Tương tác tích cực:</strong> Comment, like, chia sẻ bài của thành viên khác. Cộng đồng mạnh khi mọi người cùng nhau.</div>
            <div class="rule">4️⃣ <strong>Tôn trọng nhau:</strong> Không spam, không chỉ trích tiêu cực. Feedback phải mang tính xây dựng.</div>
            <div class="rule">5️⃣ <strong>Chia sẻ học hỏi:</strong> Đăng bài lên Bảng Tin sau khi hoàn thành mỗi ngày — XP sẽ được nhân đôi!</div>
            <p style="color:#10b981;font-weight:600">Chúc bạn hoàn thành trọn vẹn 28 ngày Dưỡng Hóa! 💪</p>
          `)
        });
      }
    } else {
      db.run("UPDATE challenge_enrollments SET status = 'rejected' WHERE id = ?", [id]);
      db.run('INSERT INTO notifications (user_id, type, content) VALUES (?,?,?)',
        [enroll.user_id, 'enrollment_rejected', 'Yêu cầu tham gia thử thách chưa được chấp thuận.']);
    }
    res.json({ success: true });
  });

  // ── Admin space groups ────────────────────────────────────────
  app.get('/api/admin/space-groups', requireAdmin, (_req, res) => {
    const groups = db.all('SELECT * FROM space_groups ORDER BY order_num ASC, created_at ASC');
    const spaces = db.all(`
      SELECT s.*, COUNT(p.id) AS post_count
      FROM spaces s LEFT JOIN posts p ON p.space_id = s.id
      GROUP BY s.id ORDER BY s.order_num ASC, s.created_at ASC
    `);
    const result = groups.map(g => ({ ...g, spaces: spaces.filter(s => s.group_id === g.id) }));
    res.json({ groups: result });
  });

  app.post('/api/admin/space-groups', requireAdmin, (req, res) => {
    const { name, order_num = 0 } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Tên group không được để trống.' });
    const r = db.run('INSERT INTO space_groups (name, order_num) VALUES (?,?)', [name.trim(), Number(order_num) || 0]);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/space-groups/:id', requireAdmin, (req, res) => {
    const { name, order_num } = req.body;
    const g = db.get('SELECT id FROM space_groups WHERE id = ?', [req.params.id]);
    if (!g) return res.status(404).json({ error: 'Group không tồn tại.' });
    if (name !== undefined)      db.run('UPDATE space_groups SET name = ? WHERE id = ?', [name, req.params.id]);
    if (order_num !== undefined) db.run('UPDATE space_groups SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/space-groups/:id', requireAdmin, (req, res) => {
    const spaceIds = db.all('SELECT id FROM spaces WHERE group_id = ?', [req.params.id]).map(s => s.id);
    spaceIds.forEach(id => {
      const topicIds = db.all('SELECT id FROM topics WHERE space_id = ?', [id]).map(t => t.id);
      topicIds.forEach(tid => db.run('UPDATE posts SET topic_id = NULL WHERE topic_id = ?', [tid]));
      db.run('DELETE FROM topics WHERE space_id = ?', [id]);
      db.run('UPDATE posts SET space_id = NULL WHERE space_id = ?', [id]);
    });
    db.run('DELETE FROM spaces WHERE group_id = ?', [req.params.id]);
    db.run('DELETE FROM space_groups WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin spaces ─────────────────────────────────────────────
  app.get('/api/admin/spaces', requireAdmin, (_req, res) => {
    const spaces = db.all(`
      SELECT s.*, COUNT(p.id) AS post_count
      FROM spaces s LEFT JOIN posts p ON p.space_id = s.id
      GROUP BY s.id ORDER BY s.order_num ASC, s.created_at DESC
    `);
    res.json({ spaces });
  });

  app.post('/api/admin/spaces', requireAdmin, (req, res) => {
    const { name, icon = '💬', description = '', visibility = 'public', allow_join_requests = 1, order_num = 0, group_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Tên space không được để trống.' });
    if (!group_id) return res.status(400).json({ error: 'Vui lòng chọn Group cho Space.' });
    const vis = ['public', 'private', 'secret'].includes(visibility) ? visibility : 'public';
    const r = db.run(
      'INSERT INTO spaces (group_id, name, icon, description, visibility, allow_join_requests, order_num) VALUES (?,?,?,?,?,?,?)',
      [group_id, name.trim(), icon || '💬', description || '', vis, allow_join_requests ? 1 : 0, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/spaces/:id', requireAdmin, (req, res) => {
    const { name, icon, description, visibility, allow_join_requests, order_num, group_id } = req.body;
    const s = db.get('SELECT id FROM spaces WHERE id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Space không tồn tại.' });
    if (name !== undefined)        db.run('UPDATE spaces SET name = ? WHERE id = ?', [name, req.params.id]);
    if (icon !== undefined)        db.run('UPDATE spaces SET icon = ? WHERE id = ?', [icon, req.params.id]);
    if (description !== undefined) db.run('UPDATE spaces SET description = ? WHERE id = ?', [description, req.params.id]);
    if (visibility !== undefined)  db.run('UPDATE spaces SET visibility = ? WHERE id = ?', [['public','private','secret'].includes(visibility) ? visibility : 'public', req.params.id]);
    if (allow_join_requests !== undefined) db.run('UPDATE spaces SET allow_join_requests = ? WHERE id = ?', [allow_join_requests ? 1 : 0, req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE spaces SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    if (group_id !== undefined)    db.run('UPDATE spaces SET group_id = ? WHERE id = ?', [group_id, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/spaces/:id', requireAdmin, (req, res) => {
    const topicIds = db.all('SELECT id FROM topics WHERE space_id = ?', [req.params.id]).map(t => t.id);
    topicIds.forEach(id => db.run('UPDATE posts SET topic_id = NULL WHERE topic_id = ?', [id]));
    db.run('DELETE FROM topics WHERE space_id = ?', [req.params.id]);
    db.run('UPDATE posts SET space_id = NULL WHERE space_id = ?', [req.params.id]);
    db.run('DELETE FROM space_members WHERE space_id = ?', [req.params.id]);
    db.run('DELETE FROM spaces WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin topics ─────────────────────────────────────────────
  app.get('/api/admin/topics', requireAdmin, (_req, res) => {
    const topics = db.all(`
      SELECT t.*, s.name AS space_name, s.icon AS space_icon,
             (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id) AS post_count
      FROM topics t JOIN spaces s ON s.id = t.space_id
      ORDER BY s.order_num ASC, t.order_num ASC, t.created_at ASC
    `);
    res.json({ topics });
  });

  app.post('/api/admin/topics', requireAdmin, (req, res) => {
    const { space_id, name, icon = '🏷️', order_num = 0 } = req.body;
    if (!space_id) return res.status(400).json({ error: 'Vui lòng chọn Space cho Topic.' });
    if (!name?.trim()) return res.status(400).json({ error: 'Tên Topic không được để trống.' });
    const r = db.run(
      'INSERT INTO topics (space_id, name, icon, order_num) VALUES (?,?,?,?)',
      [space_id, name.trim(), icon || '🏷️', Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/topics/:id', requireAdmin, (req, res) => {
    const { space_id, name, icon, order_num } = req.body;
    const t = db.get('SELECT id FROM topics WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Topic không tồn tại.' });
    if (space_id !== undefined) db.run('UPDATE topics SET space_id = ? WHERE id = ?', [space_id, req.params.id]);
    if (name !== undefined)     db.run('UPDATE topics SET name = ? WHERE id = ?', [name, req.params.id]);
    if (icon !== undefined)     db.run('UPDATE topics SET icon = ? WHERE id = ?', [icon || '🏷️', req.params.id]);
    if (order_num !== undefined) db.run('UPDATE topics SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/topics/:id', requireAdmin, (req, res) => {
    db.run('UPDATE posts SET topic_id = NULL WHERE topic_id = ?', [req.params.id]);
    db.run('DELETE FROM topics WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin pillars (trụ cột) ────────────────────────────────────
  app.get('/api/admin/pillars', requireAdmin, (_req, res) => {
    const pillars = db.all(`
      SELECT p.*, (SELECT COUNT(*) FROM posts po WHERE po.pillar = p.key) AS post_count
      FROM pillars p ORDER BY p.order_num ASC, p.created_at ASC
    `);
    res.json({ pillars });
  });

  app.post('/api/admin/pillars', requireAdmin, (req, res) => {
    const { label, icon = '🔥', color = '#0ea5e9', order_num = 0 } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'Tên trụ cột không được để trống.' });
    const key = uniquePillarKey(slugify(label));
    const r = db.run(
      'INSERT INTO pillars (key, label, icon, color, order_num) VALUES (?,?,?,?,?)',
      [key, label.trim(), icon || '🔥', color || '#0ea5e9', Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid, key });
  });

  app.patch('/api/admin/pillars/:id', requireAdmin, (req, res) => {
    const { label, icon, color, order_num } = req.body;
    const p = db.get('SELECT id FROM pillars WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Trụ cột không tồn tại.' });
    if (label !== undefined)     db.run('UPDATE pillars SET label = ? WHERE id = ?', [label, req.params.id]);
    if (icon !== undefined)      db.run('UPDATE pillars SET icon = ? WHERE id = ?', [icon || '🔥', req.params.id]);
    if (color !== undefined)     db.run('UPDATE pillars SET color = ? WHERE id = ?', [color || '#0ea5e9', req.params.id]);
    if (order_num !== undefined) db.run('UPDATE pillars SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/pillars/:id', requireAdmin, (req, res) => {
    const pillar = db.get('SELECT key FROM pillars WHERE id = ?', [req.params.id]);
    if (!pillar) return res.status(404).json({ error: 'Trụ cột không tồn tại.' });
    db.run('UPDATE posts SET pillar = NULL WHERE pillar = ?', [pillar.key]);
    db.run('DELETE FROM pillars WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Pillars (public) — used to populate the composer select + filter dropdowns
  app.get('/api/pillars', (_req, res) => {
    const pillars = db.all('SELECT id, key, label, icon, color FROM pillars ORDER BY order_num ASC, created_at ASC');
    res.json({ pillars });
  });

  // ══════════════════════════════════════════════════════════
  // NGŨ HÀNH TOOLS — foods lookup / recipes / meal journal
  // ══════════════════════════════════════════════════════════

  // ── Tra cứu thực phẩm ──────────────────────────────────────
  app.get('/api/foods', (req, res) => {
    const { q = '', element = '', color = '', taste = '', nature = '' } = req.query;
    let sql = 'SELECT id, name, element, color, taste, nature, organ, note FROM foods WHERE 1=1';
    const params = [];
    if (q)       { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
    if (element) { sql += ' AND element = ?'; params.push(element); }
    if (color)   { sql += ' AND color = ?'; params.push(color); }
    if (taste)   { sql += ' AND taste = ?'; params.push(taste); }
    if (nature)  { sql += ' AND nature = ?'; params.push(nature); }
    sql += ' ORDER BY element, order_num ASC, name ASC';
    res.json({ foods: db.all(sql, params) });
  });

  app.get('/api/admin/foods', requireAdmin, (_req, res) => {
    res.json({ foods: db.all('SELECT * FROM foods ORDER BY element, order_num ASC, name ASC') });
  });
  app.post('/api/admin/foods', requireAdmin, (req, res) => {
    const { name, element, color, taste, nature, organ, note, order_num } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Thiếu tên thực phẩm.' });
    const r = db.run(
      'INSERT INTO foods (name, element, color, taste, nature, organ, note, order_num) VALUES (?,?,?,?,?,?,?,?)',
      [name.trim(), element || null, color || null, taste || null, nature || null, organ || null, note || null, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/foods/:id', requireAdmin, (req, res) => {
    const f = db.get('SELECT id FROM foods WHERE id = ?', [req.params.id]);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy.' });
    ['name', 'element', 'color', 'taste', 'nature', 'organ', 'note', 'order_num'].forEach(k => {
      if (req.body[k] !== undefined)
        db.run(`UPDATE foods SET ${k} = ? WHERE id = ?`, [k === 'order_num' ? (Number(req.body[k]) || 0) : (req.body[k] || null), req.params.id]);
    });
    res.json({ success: true });
  });
  app.delete('/api/admin/foods/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM foods WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Thư viện công thức ─────────────────────────────────────
  app.get('/api/recipes', (req, res) => {
    const { q = '', element = '', buoi = '' } = req.query;
    let sql = 'SELECT id, title, element_tags, buoi, summary, dung_khi FROM recipes WHERE 1=1';
    const params = [];
    if (q)       { sql += ' AND (title LIKE ? OR summary LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (element) { sql += " AND (',' || element_tags || ',') LIKE ?"; params.push(`%,${element},%`); }
    if (buoi)    { sql += ' AND buoi = ?'; params.push(buoi); }
    sql += ' ORDER BY order_num ASC, id ASC';
    res.json({ recipes: db.all(sql, params) });
  });
  app.get('/api/recipes/:id', (req, res) => {
    const r = db.get('SELECT * FROM recipes WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy công thức.' });
    res.json({ recipe: r });
  });

  app.get('/api/admin/recipes', requireAdmin, (_req, res) => {
    res.json({ recipes: db.all('SELECT * FROM recipes ORDER BY order_num ASC, id ASC') });
  });
  app.post('/api/admin/recipes', requireAdmin, (req, res) => {
    const { title, element_tags, buoi, summary, ingredients, steps, dung_khi, note, order_num } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Thiếu tên công thức.' });
    const r = db.run(
      'INSERT INTO recipes (title, element_tags, buoi, summary, ingredients, steps, dung_khi, note, order_num) VALUES (?,?,?,?,?,?,?,?,?)',
      [title.trim(), element_tags || null, buoi || null, summary || null, ingredients || null, steps || null, dung_khi || null, note || null, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/recipes/:id', requireAdmin, (req, res) => {
    const rec = db.get('SELECT id FROM recipes WHERE id = ?', [req.params.id]);
    if (!rec) return res.status(404).json({ error: 'Không tìm thấy.' });
    ['title', 'element_tags', 'buoi', 'summary', 'ingredients', 'steps', 'dung_khi', 'note', 'order_num'].forEach(k => {
      if (req.body[k] !== undefined)
        db.run(`UPDATE recipes SET ${k} = ? WHERE id = ?`, [k === 'order_num' ? (Number(req.body[k]) || 0) : (req.body[k] || null), req.params.id]);
    });
    res.json({ success: true });
  });
  app.delete('/api/admin/recipes/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM recipes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Tài liệu PDF (Cẩm nang) ────────────────────────────────
  app.get('/api/camnang-docs', (_req, res) => {
    res.json({ docs: db.all('SELECT id, title, pdf_url, icon, note FROM camnang_docs ORDER BY order_num ASC, id ASC') });
  });
  app.get('/api/camnang-docs/:id', (req, res) => {
    const d = db.get('SELECT * FROM camnang_docs WHERE id = ?', [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu.' });
    res.json({ doc: d });
  });
  app.get('/api/admin/camnang-docs', requireAdmin, (_req, res) => {
    res.json({ docs: db.all('SELECT * FROM camnang_docs ORDER BY order_num ASC, id ASC') });
  });
  app.post('/api/admin/camnang-docs', requireAdmin, (req, res) => {
    const { title, pdf_url, icon, note, order_num } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Thiếu tên tài liệu.' });
    if (!pdf_url?.trim()) return res.status(400).json({ error: 'Thiếu đường dẫn file PDF.' });
    const r = db.run(
      'INSERT INTO camnang_docs (title, pdf_url, icon, note, order_num) VALUES (?,?,?,?,?)',
      [title.trim(), pdf_url.trim(), icon?.trim() || '📄', note || null, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/camnang-docs/:id', requireAdmin, (req, res) => {
    const d = db.get('SELECT id FROM camnang_docs WHERE id = ?', [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy.' });
    ['title', 'pdf_url', 'icon', 'note', 'order_num'].forEach(k => {
      if (req.body[k] !== undefined)
        db.run(`UPDATE camnang_docs SET ${k} = ? WHERE id = ?`, [k === 'order_num' ? (Number(req.body[k]) || 0) : (req.body[k] || null), req.params.id]);
    });
    res.json({ success: true });
  });
  app.delete('/api/admin/camnang-docs/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM camnang_docs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Nhật ký ăn uống ────────────────────────────────────────
  app.get('/api/meal-logs', (req, res) => {
    const { user_id, from = '', to = '' } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    let sql = 'SELECT * FROM meal_logs WHERE user_id = ?';
    const params = [user_id];
    if (from) { sql += ' AND log_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND log_date <= ?'; params.push(to); }
    sql += ' ORDER BY log_date DESC LIMIT 120';
    const logs = db.all(sql, params).map(l => ({
      ...l,
      colors: JSON.parse(l.colors || '[]'),
      tastes: JSON.parse(l.tastes || '[]'),
    }));
    const user = db.get('SELECT streak FROM users WHERE id = ?', [user_id]);
    res.json({ logs, streak: user?.streak || 0 });
  });

  // Hồ sơ cá nhân hoá của khách (thể trạng + lộ trình đã duyệt) — dùng để Agent 2
  // ("An Nhiên") nhận xét đúng theo từng người thay vì lời khuyên chung chung.
  // Dùng chung cho mọi nơi gọi callGoclawAgent2 (nhật ký ăn uống, và sau này là
  // báo cáo hằng ngày trong 377 ngày). Trả về '' nếu khách chưa có lộ trình được duyệt.
  function buildCustomerContext(userId) {
    const roadmap = db.get(
      `SELECT final_content, draft_content, the_trang FROM ttm_roadmaps
       WHERE user_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1`,
      [userId]
    );
    if (!roadmap) return '';
    const content = stripDraftBanner(roadmap.final_content || roadmap.draft_content || '');
    const parts = [];
    if (roadmap.the_trang) parts.push(`Thể trạng: ${roadmap.the_trang}`);
    if (content) parts.push(`Lộ trình thuận tự nhiên đã duyệt cho khách hàng này:\n${content}`);
    if (!parts.length) return '';
    return `[HỒ SƠ CÁ NHÂN HOÁ CỦA KHÁCH HÀNG — dùng để nhận xét/tư vấn đúng theo thể trạng và lộ trình riêng của người này, không đưa lời khuyên chung chung, không lặp lại nguyên văn lộ trình]\n${parts.join('\n\n')}\n`;
  }

  // Builds the plain-text summary sent to Agent 2 — today's entry plus up to
  // 6 prior days for continuity ("bạn duy trì tốt 3 ngày liên tiếp", v.v.)
  function buildMealLogSummary(todayLog, recentLogs) {
    const lines = [`Ngày: ${todayLog.log_date}`];
    if (todayLog.breakfast) lines.push(`Bữa sáng: ${todayLog.breakfast}`);
    if (todayLog.lunch)     lines.push(`Bữa trưa: ${todayLog.lunch}`);
    if (todayLog.dinner)    lines.push(`Bữa tối: ${todayLog.dinner}`);
    lines.push(`Màu sắc đã ăn: ${(JSON.parse(todayLog.colors || '[]')).join(', ') || 'không ghi'}`);
    lines.push(`Vị đã ăn: ${(JSON.parse(todayLog.tastes || '[]')).join(', ') || 'không ghi'}`);
    if (todayLog.note) lines.push(`Cảm nhận/ghi chú của khách: ${todayLog.note}`);
    const prior = (recentLogs || []).filter(r => r.log_date !== todayLog.log_date);
    if (prior.length) {
      lines.push('', 'Các ngày gần đây (để tham khảo xu hướng):');
      prior.forEach(r => {
        const c = JSON.parse(r.colors || '[]').join('/') || '-';
        const t = JSON.parse(r.tastes || '[]').join('/') || '-';
        lines.push(`- ${r.log_date}: màu ${c}, vị ${t}`);
      });
    }
    return lines.join('\n');
  }

  // Runs after the HTTP response is already sent — asks Agent 2 to comment on
  // today's entry, saves the result, and pushes it out over Telegram. Never
  // throws into the caller; any failure here must not affect the meal-log save.
  async function runAgent2Coaching(userId, logId, logDate) {
    try {
      const todayLog = db.get('SELECT * FROM meal_logs WHERE id = ?', [logId]);
      if (!todayLog) return;
      const recentLogs = db.all(
        'SELECT log_date, colors, tastes, breakfast, lunch, dinner FROM meal_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 7',
        [userId]
      );
      const summary = buildMealLogSummary(todayLog, recentLogs);
      const context = buildCustomerContext(userId);
      const input = context ? `${context}\n[BÁO CÁO HÔM NAY]\n${summary}` : summary;
      const result = await callGoclawAgent2(input);
      if (!result.ok) {
        console.error('  [Agent 2] lỗi gọi GoClaw:', result.error);
        return;
      }
      const { flagLevel, flaggedReason, feedback } = parseAgent2Response(result.text);
      db.run(
        'UPDATE meal_logs SET ai_feedback=?, flag_level=?, flagged_reason=? WHERE id=?',
        [feedback, flagLevel, flaggedReason || null, logId]
      );

      const user = db.get('SELECT first_name, telegram_chat_id FROM users WHERE id = ?', [userId]);
      if (user && user.telegram_chat_id && feedback) {
        const sendResult = await sendTelegramMessage(user.telegram_chat_id, feedback);
        if (sendResult.ok) {
          db.run("UPDATE meal_logs SET agent2_notified_at = datetime('now','localtime') WHERE id = ?", [logId]);
        } else {
          console.error('  [Agent 2] gửi Telegram cho khách thất bại:', sendResult.error || sendResult);
        }
      }

      if (flagLevel === 'warning' || flagLevel === 'urgent') {
        const admins = db.all("SELECT telegram_chat_id FROM users WHERE is_admin = 1 AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''");
        const icon = flagLevel === 'urgent' ? '🚨' : '⚠️';
        const alertText = `${icon} <b>Cảnh báo ${flagLevel.toUpperCase()}</b>\nKhách: ${user ? user.first_name : 'user #' + userId}\nNgày: ${logDate}\nLý do: ${flaggedReason || '(không nêu rõ)'}\n\n${feedback}`;
        let anySent = false;
        for (const a of admins) {
          const r = await sendTelegramMessage(a.telegram_chat_id, alertText);
          if (r.ok) anySent = true;
        }
        if (anySent) {
          db.run("UPDATE meal_logs SET admin_notified_at = datetime('now','localtime') WHERE id = ?", [logId]);
        } else if (!admins.length) {
          console.error('  [Agent 2] có cờ cảnh báo nhưng chưa admin nào liên kết Telegram để báo động.');
        }
      }
    } catch (err) {
      console.error('  [Agent 2] lỗi xử lý coaching:', err.message);
    }
  }

  // Bản tổng kết báo cáo 377 ngày gửi Agent 2 — đầy đủ hơn nhật ký ăn uống (thêm nước tiểu,
  // phân, tập luyện, mồ hôi, cảm nhận) để An Nhiên ghi nhận đúng thay đổi sức khỏe từng ngày.
  function buildProgram377ReportSummary(todayReport, recentReports) {
    const lines = [`Ngày báo cáo: ${todayReport.report_date} (ngày thứ ${todayReport.day_number || '?'}/377)`];
    if (todayReport.meal_breakfast) lines.push(`Bữa sáng: ${todayReport.meal_breakfast}`);
    if (todayReport.meal_lunch)     lines.push(`Bữa trưa: ${todayReport.meal_lunch}`);
    if (todayReport.meal_dinner)    lines.push(`Bữa tối: ${todayReport.meal_dinner}`);
    lines.push(`Màu sắc đã ăn: ${(JSON.parse(todayReport.meal_colors || '[]')).join(', ') || 'không ghi'}`);
    lines.push(`Vị đã ăn: ${(JSON.parse(todayReport.meal_tastes || '[]')).join(', ') || 'không ghi'}`);
    if (todayReport.urine_amount || todayReport.urine_color)
      lines.push(`Nước tiểu: ${[todayReport.urine_amount, todayReport.urine_color].filter(Boolean).join(' — ')}`);
    if (todayReport.stool_shape || todayReport.stool_color)
      lines.push(`Phân: ${[todayReport.stool_shape, todayReport.stool_color].filter(Boolean).join(' — ')}`);
    if (todayReport.exercise_type)
      lines.push(`Tập luyện: ${todayReport.exercise_type}${todayReport.exercise_minutes ? ` (${todayReport.exercise_minutes} phút)` : ''}`);
    if (todayReport.sweat_amount || todayReport.sweat_taste)
      lines.push(`Mồ hôi: ${[todayReport.sweat_amount, todayReport.sweat_taste].filter(Boolean).join(' — ')}`);
    if (todayReport.feeling_note) lines.push(`Cảm nhận/biểu hiện cơ thể: ${todayReport.feeling_note}`);
    const prior = (recentReports || []).filter(r => r.report_date !== todayReport.report_date);
    if (prior.length) {
      lines.push('', 'Các ngày gần đây (để tham khảo xu hướng):');
      prior.forEach(r => {
        const c = JSON.parse(r.meal_colors || '[]').join('/') || '-';
        const t = JSON.parse(r.meal_tastes || '[]').join('/') || '-';
        lines.push(`- ${r.report_date}: màu ${c}, vị ${t}, nước tiểu ${r.urine_amount || '-'}/${r.urine_color || '-'}, tập luyện ${r.exercise_type || '-'}`);
      });
    }
    return lines.join('\n');
  }

  // Giống hệt runAgent2Coaching (meal_logs) nhưng ghi vào program377_reports — dùng làm nội
  // dung tab "Kết quả" (thay đổi sức khỏe qua từng ngày, do An Nhiên ghi nhận tự động).
  async function runProgram377Coaching(userId, reportId, reportDate) {
    try {
      const todayReport = db.get('SELECT * FROM program377_reports WHERE id = ?', [reportId]);
      if (!todayReport) return;
      const recentReports = db.all(
        'SELECT report_date, meal_colors, meal_tastes, urine_amount, urine_color, exercise_type FROM program377_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 7',
        [userId]
      );
      const summary = buildProgram377ReportSummary(todayReport, recentReports);
      const context = buildCustomerContext(userId);
      const input = context ? `${context}\n[BÁO CÁO NGÀY THỨ ${todayReport.day_number || '?'}/377]\n${summary}` : summary;
      const result = await callGoclawAgent2(input);
      if (!result.ok) {
        console.error('  [Agent 2 · 377 ngày] lỗi gọi GoClaw:', result.error);
        return;
      }
      const { flagLevel, flaggedReason, feedback } = parseAgent2Response(result.text);
      db.run(
        'UPDATE program377_reports SET ai_feedback=?, flag_level=?, flagged_reason=? WHERE id=?',
        [feedback, flagLevel, flaggedReason || null, reportId]
      );
      // Ngày báo cáo qua 377 ngày cũng được ghi đè sang meal_logs (cùng ngày) để dùng chung
      // streak/XP — đồng bộ luôn nhận xét AI vào đó, tránh trang Nhật ký ăn uống hiển thị mãi
      // "đang xem nhật ký..." vì meal_logs.ai_feedback không bao giờ được điền.
      db.run(
        'UPDATE meal_logs SET ai_feedback=?, flag_level=?, flagged_reason=? WHERE user_id=? AND log_date=?',
        [feedback, flagLevel, flaggedReason || null, userId, reportDate]
      );

      const user = db.get('SELECT first_name, telegram_chat_id FROM users WHERE id = ?', [userId]);
      if (user && user.telegram_chat_id && feedback) {
        const sendResult = await sendTelegramMessage(user.telegram_chat_id, feedback);
        if (sendResult.ok) {
          db.run("UPDATE program377_reports SET agent2_notified_at = datetime('now','localtime') WHERE id = ?", [reportId]);
        } else {
          console.error('  [Agent 2 · 377 ngày] gửi Telegram cho khách thất bại:', sendResult.error || sendResult);
        }
      }

      if (flagLevel === 'warning' || flagLevel === 'urgent') {
        const admins = db.all("SELECT telegram_chat_id FROM users WHERE is_admin = 1 AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''");
        const icon = flagLevel === 'urgent' ? '🚨' : '⚠️';
        const alertText = `${icon} <b>Cảnh báo ${flagLevel.toUpperCase()} — 377 ngày</b>\nKhách: ${user ? user.first_name : 'user #' + userId}\nNgày: ${reportDate}\nLý do: ${flaggedReason || '(không nêu rõ)'}\n\n${feedback}`;
        for (const a of admins) await sendTelegramMessage(a.telegram_chat_id, alertText);
      }
    } catch (err) {
      console.error('  [Agent 2 · 377 ngày] lỗi xử lý coaching:', err.message);
    }
  }

  app.post('/api/meal-logs', (req, res) => {
    const { user_id, log_date, breakfast, lunch, dinner, colors, tastes, note } = req.body;
    if (!user_id || !log_date || !/^\d{4}-\d{2}-\d{2}$/.test(log_date))
      return res.status(400).json({ error: 'Thiếu user_id hoặc ngày không hợp lệ.' });
    const colorsJson = JSON.stringify(Array.isArray(colors) ? colors : []);
    const tastesJson = JSON.stringify(Array.isArray(tastes) ? tastes : []);
    const existing = db.get('SELECT id FROM meal_logs WHERE user_id = ? AND log_date = ?', [user_id, log_date]);
    let logId;
    if (existing) {
      db.run(
        'UPDATE meal_logs SET breakfast=?, lunch=?, dinner=?, colors=?, tastes=?, note=? WHERE id=?',
        [breakfast || null, lunch || null, dinner || null, colorsJson, tastesJson, note || null, existing.id]
      );
      logId = existing.id;
    } else {
      db.run(
        'INSERT INTO meal_logs (user_id, log_date, breakfast, lunch, dinner, colors, tastes, note) VALUES (?,?,?,?,?,?,?,?)',
        [user_id, log_date, breakfast || null, lunch || null, dinner || null, colorsJson, tastesJson, note || null]
      );
      addXP(user_id, 3, 'meal_log', `Ghi nhật ký ăn uống ${log_date}`);
      logId = db.get('SELECT id FROM meal_logs WHERE user_id = ? AND log_date = ?', [user_id, log_date]).id;
    }
    const streak = recomputeStreak(user_id);
    res.json({ success: true, streak, new_entry: !existing });

    // Fire-and-forget: don't make the customer wait on the AI/Telegram round-trip.
    runAgent2Coaching(user_id, logId, log_date);
  });

  // ── Admin: Nhật ký ăn uống (view/moderate every member's meal logs) ──
  app.get('/api/admin/meal-logs', requireAdmin, (req, res) => {
    const { search = '', from = '', to = '', user_id = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;
    let sql = `SELECT m.*, u.first_name, u.last_name, u.email
               FROM meal_logs m JOIN users u ON u.id = m.user_id
               WHERE (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
    const params = [like, like, like];
    if (user_id) { sql += ' AND m.user_id = ?'; params.push(user_id); }
    if (from) { sql += ' AND m.log_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND m.log_date <= ?'; params.push(to); }
    sql += ' ORDER BY m.log_date DESC, m.id DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const logs = db.all(sql, params).map(l => ({
      ...l,
      colors: JSON.parse(l.colors || '[]'),
      tastes: JSON.parse(l.tastes || '[]'),
    }));

    let cntSql = `SELECT COUNT(*) AS n FROM meal_logs m JOIN users u ON u.id = m.user_id
                  WHERE (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
    const cntP = [like, like, like];
    if (user_id) { cntSql += ' AND m.user_id = ?'; cntP.push(user_id); }
    if (from) { cntSql += ' AND m.log_date >= ?'; cntP.push(from); }
    if (to)   { cntSql += ' AND m.log_date <= ?'; cntP.push(to); }
    const total = db.get(cntSql, cntP).n;

    res.json({ logs, total });
  });
  app.delete('/api/admin/meal-logs/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM meal_logs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Chương trình 377 ngày ──────────────────────────────────────────
  const PROGRAM377_TOPICS = [
    { key: 'dinh_duong_ngu_hanh',     label: 'Dinh dưỡng ngũ hành theo cơ địa Hàn/Nhiệt' },
    { key: 'chuyen_hoa_suc_khoe_goc', label: 'Chuyển hóa sức khỏe gốc — Lục phủ Ngũ tạng' },
    { key: 'khai_thong_kinh_lac',     label: 'Khai thông kinh lạc — Tác động cột sống' },
    { key: 'chu_ky_sinh_hoc',         label: 'Chu kỳ sinh học & tái tạo tế bào' },
    { key: 'phong_thuy_nha_o',        label: 'Điều hòa phong thủy nhà ở' },
    { key: 'phong_thuy_tai_chinh',    label: 'Phong thủy tài chính cá nhân & gia đình' },
    { key: 'chuyen_hoa_moi_quan_he',  label: 'Chuyển hóa mối quan hệ — Năm vòng tròn lỗi đạo' },
    { key: 'tu_duy_tam_thuc',         label: 'Làm chủ tư duy — Năm vòng tròn kiểm soát' },
    { key: 'lap_trinh_van_menh',      label: 'Lập trình vận mệnh' },
    { key: 'kinh_dich_than_tam',      label: 'Ứng dụng Kinh Dịch — cân bằng Thân-Tâm' },
  ];

  // "Ngày thứ mấy" của user tính theo lịch thật (date('now','localtime')) kể từ start_date —
  // mở khóa đúng lúc qua 0h, không lệch theo giờ họ bấm tham gia (khác cơ chế thử thách 21 ngày).
  function program377DayNumberToday(startDate) {
    if (!startDate) return 0;
    const row = db.get(
      "SELECT CAST(julianday(date('now','localtime')) - julianday(?) AS INTEGER) + 1 AS n",
      [startDate]
    );
    return row ? Math.max(row.n, 0) : 0;
  }

  app.get('/api/program377/status', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'Thiếu user_id' });
    const enrollment = db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]);
    if (!enrollment) return res.json({ enrollment: null });
    const dayNumberToday = enrollment.status === 'approved'
      ? Math.min(program377DayNumberToday(enrollment.start_date), 377)
      : 0;
    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const todayReport = db.get('SELECT * FROM program377_reports WHERE user_id = ? AND report_date = ?', [userId, todayStr]);
    res.json({
      enrollment: { status: enrollment.status, startDate: enrollment.start_date, adminNote: enrollment.admin_note },
      dayNumberToday,
      totalDays: 377,
      todayReport: todayReport
        ? { ...todayReport, meal_colors: JSON.parse(todayReport.meal_colors || '[]'), meal_tastes: JSON.parse(todayReport.meal_tastes || '[]') }
        : null,
    });
  });

  app.post('/api/program377/enroll', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id' });
    const existing = db.get('SELECT id FROM program377_enrollments WHERE user_id = ?', [user_id]);
    if (existing) return res.status(409).json({ error: 'Bạn đã đăng ký chương trình này rồi.' });
    db.run('INSERT INTO program377_enrollments (user_id, status) VALUES (?, ?)', [user_id, 'pending']);
    res.status(201).json({ ok: true });
  });

  app.get('/api/program377/days', (req, res) => {
    const userId = req.query.user_id;
    const enrollment = userId ? db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]) : null;
    const dayNumberToday = enrollment && enrollment.status === 'approved'
      ? Math.min(program377DayNumberToday(enrollment.start_date), 377)
      : 0;
    const days = db.all('SELECT id, day_number, topic_key, title, xp_reward FROM program377_days ORDER BY day_number ASC');
    res.json({
      days: days.map(d => {
        const unlocked = d.day_number <= dayNumberToday;
        // Ngày chưa mở khóa: không trả tiêu đề/chủ đề thật, tránh lộ nội dung trước khi tới ngày.
        return unlocked ? { ...d, unlocked } : { id: d.id, day_number: d.day_number, topic_key: null, title: null, xp_reward: d.xp_reward, unlocked };
      }),
      dayNumberToday,
    });
  });

  app.get('/api/program377/day/:dayNumber', (req, res) => {
    const userId = req.query.user_id;
    const dayNumber = Number(req.params.dayNumber);
    const enrollment = userId ? db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]) : null;
    if (!enrollment || enrollment.status !== 'approved')
      return res.status(403).json({ error: 'Bạn chưa được duyệt tham gia chương trình.' });
    const dayNumberToday = Math.min(program377DayNumberToday(enrollment.start_date), 377);
    if (!dayNumber || dayNumber > dayNumberToday)
      return res.status(403).json({ error: 'Ngày này chưa được mở khóa.' });
    const day = db.get('SELECT * FROM program377_days WHERE day_number = ?', [dayNumber]);
    if (!day) return res.status(404).json({ error: 'Nội dung ngày này chưa được soạn.' });
    res.json({ day });
  });

  app.get('/api/program377/reports', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'Thiếu user_id' });
    const limit = Number(req.query.limit) || 30;
    const reports = db.all(
      'SELECT * FROM program377_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT ?',
      [userId, limit]
    ).map(r => ({ ...r, meal_colors: JSON.parse(r.meal_colors || '[]'), meal_tastes: JSON.parse(r.meal_tastes || '[]') }));
    res.json({ reports });
  });

  app.post('/api/program377/reports', (req, res) => {
    const {
      user_id, report_date,
      meal_breakfast, meal_lunch, meal_dinner, meal_colors, meal_tastes,
      urine_amount, urine_color, stool_shape, stool_color,
      exercise_type, exercise_minutes, sweat_amount, sweat_taste, feeling_note,
    } = req.body;
    if (!user_id || !report_date || !/^\d{4}-\d{2}-\d{2}$/.test(report_date))
      return res.status(400).json({ error: 'Thiếu user_id hoặc ngày không hợp lệ.' });

    const enrollment = db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [user_id]);
    if (!enrollment || enrollment.status !== 'approved')
      return res.status(403).json({ error: 'Bạn chưa được duyệt tham gia chương trình.' });

    const dayToday = program377DayNumberToday(enrollment.start_date);
    if (dayToday < 1) return res.status(403).json({ error: 'Chương trình của bạn chưa bắt đầu.' });

    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const yesterdayStr = db.get("SELECT date('now','localtime','-1 day') AS d").d;
    if (report_date !== todayStr && report_date !== yesterdayStr)
      return res.status(400).json({ error: 'Chỉ được báo cáo cho hôm nay hoặc hôm qua.' });

    const nowHour = Number(db.get("SELECT strftime('%H','now','localtime') AS h").h);
    const isLate = (report_date < todayStr) || (report_date === todayStr && nowHour >= 23) ? 1 : 0;
    const dayNumber = report_date === todayStr ? dayToday : dayToday - 1;

    const colorsJson = JSON.stringify(Array.isArray(meal_colors) ? meal_colors : []);
    const tastesJson = JSON.stringify(Array.isArray(meal_tastes) ? meal_tastes : []);

    const existing = db.get('SELECT id FROM program377_reports WHERE user_id = ? AND report_date = ?', [user_id, report_date]);
    const fields = [
      meal_breakfast || null, meal_lunch || null, meal_dinner || null, colorsJson, tastesJson,
      urine_amount || null, urine_color || null, stool_shape || null, stool_color || null,
      exercise_type || null, exercise_minutes ? Number(exercise_minutes) : null,
      sweat_amount || null, sweat_taste || null, feeling_note || null, isLate, dayNumber,
    ];
    let reportId;
    if (existing) {
      db.run(
        `UPDATE program377_reports SET
           meal_breakfast=?, meal_lunch=?, meal_dinner=?, meal_colors=?, meal_tastes=?,
           urine_amount=?, urine_color=?, stool_shape=?, stool_color=?,
           exercise_type=?, exercise_minutes=?, sweat_amount=?, sweat_taste=?, feeling_note=?,
           is_late=?, day_number=?, updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [...fields, existing.id]
      );
      reportId = existing.id;
    } else {
      db.run(
        `INSERT INTO program377_reports (
           user_id, report_date, meal_breakfast, meal_lunch, meal_dinner, meal_colors, meal_tastes,
           urine_amount, urine_color, stool_shape, stool_color,
           exercise_type, exercise_minutes, sweat_amount, sweat_taste, feeling_note, is_late, day_number
         ) VALUES (?, ?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?)`,
        [user_id, report_date, ...fields]
      );
      reportId = db.get('SELECT id FROM program377_reports WHERE user_id = ? AND report_date = ?', [user_id, report_date]).id;
    }

    // Ghi đè trực tiếp sang meal_logs để dùng chung streak/XP/leaderboard — gọi thẳng DB, không
    // qua route /api/meal-logs (tránh gọi AI/Telegram của meal_logs 2 lần cho cùng 1 lần báo cáo).
    const mealExisting = db.get('SELECT id FROM meal_logs WHERE user_id = ? AND log_date = ?', [user_id, report_date]);
    if (mealExisting) {
      db.run(
        'UPDATE meal_logs SET breakfast=?, lunch=?, dinner=?, colors=?, tastes=? WHERE id=?',
        [meal_breakfast || null, meal_lunch || null, meal_dinner || null, colorsJson, tastesJson, mealExisting.id]
      );
    } else {
      db.run(
        'INSERT INTO meal_logs (user_id, log_date, breakfast, lunch, dinner, colors, tastes) VALUES (?,?,?,?,?,?,?)',
        [user_id, report_date, meal_breakfast || null, meal_lunch || null, meal_dinner || null, colorsJson, tastesJson]
      );
      addXP(user_id, 3, 'meal_log', `Ghi nhật ký ăn uống ${report_date}`);
    }
    recomputeStreak(user_id);

    res.json({ ok: true, reportId, isLate: !!isLate });

    // Fire-and-forget: không bắt khách chờ vòng gọi AI/Telegram.
    runProgram377Coaching(user_id, reportId, report_date);
  });

  app.get('/api/program377/sessions', (req, res) => {
    let sql = 'SELECT * FROM program377_sessions';
    if (req.query.upcoming) sql += " WHERE session_date >= date('now','localtime')";
    sql += ' ORDER BY session_date ASC';
    res.json({ sessions: db.all(sql) });
  });

  // ── Admin: Chương trình 377 ngày ────────────────────────────────
  app.get('/api/admin/program377/topics', requireAdmin, (_req, res) => {
    res.json({ topics: PROGRAM377_TOPICS });
  });

  app.get('/api/admin/program377/days', requireAdmin, (_req, res) => {
    res.json({ days: db.all('SELECT * FROM program377_days ORDER BY day_number ASC') });
  });

  // Trang khách nhúng video_url thẳng vào <iframe>, nên URL phải là dạng embed được — chuẩn hóa
  // các dạng YouTube phổ biến (watch?v=, youtu.be/, /live/, /shorts/) admin hay dán nhầm, tránh
  // bị chặn nhúng (X-Frame-Options) như link watch/live gốc.
  function normalizeEmbedVideoUrl(raw) {
    if (!raw) return null;
    const srcMatch = String(raw).match(/\bsrc=["']([^"']+)["']/i);
    const url = (srcMatch ? srcMatch[1] : String(raw).trim());
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/embed/')) return u.toString();
      if (u.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed${u.pathname}`;
      const pathMatch = u.pathname.match(/^\/(live|shorts)\/([^/]+)/);
      if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && pathMatch) {
        return `https://www.youtube-nocookie.com/embed/${pathMatch[2]}`;
      }
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
      return url;
    } catch { return url; }
  }

  app.post('/api/admin/program377/days', requireAdmin, (req, res) => {
    const { day_number, topic_key, title, body_html, video_url, exercise_title, exercise_body, xp_reward } = req.body;
    if (!day_number || !title?.trim()) return res.status(400).json({ error: 'Thiếu số ngày hoặc tiêu đề.' });
    const existing = db.get('SELECT id FROM program377_days WHERE day_number = ?', [day_number]);
    if (existing) return res.status(409).json({ error: `Ngày ${day_number} đã có nội dung — vui lòng sửa thay vì thêm mới.` });
    const r = db.run(
      'INSERT INTO program377_days (day_number, topic_key, title, body_html, video_url, exercise_title, exercise_body, xp_reward) VALUES (?,?,?,?,?,?,?,?)',
      [Number(day_number), topic_key || null, title.trim(), body_html || '', normalizeEmbedVideoUrl(video_url), exercise_title || null, exercise_body || null, Number(xp_reward) || 0]
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/program377/days/:id', requireAdmin, (req, res) => {
    const { day_number, topic_key, title, body_html, video_url, exercise_title, exercise_body, xp_reward } = req.body;
    if (!day_number || !title?.trim()) return res.status(400).json({ error: 'Thiếu số ngày hoặc tiêu đề.' });
    db.run(
      'UPDATE program377_days SET day_number=?, topic_key=?, title=?, body_html=?, video_url=?, exercise_title=?, exercise_body=?, xp_reward=? WHERE id=?',
      [Number(day_number), topic_key || null, title.trim(), body_html || '', normalizeEmbedVideoUrl(video_url), exercise_title || null, exercise_body || null, Number(xp_reward) || 0, req.params.id]
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/program377/days/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM program377_days WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.get('/api/admin/program377/enrollments', requireAdmin, (req, res) => {
    const status = req.query.status || 'pending';
    const rows = db.all(
      `SELECT e.*, u.first_name, u.last_name, u.email
       FROM program377_enrollments e JOIN users u ON u.id = e.user_id
       WHERE e.status = ? ORDER BY e.enrolled_at DESC`,
      [status]
    );
    res.json({ enrollments: rows });
  });

  app.post('/api/admin/program377/enrollments/:id/approve', requireAdmin, (req, res) => {
    const enrollment = db.get('SELECT id FROM program377_enrollments WHERE id = ?', [req.params.id]);
    if (!enrollment) return res.status(404).json({ error: 'Không tìm thấy đăng ký.' });
    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const startDate = req.body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.start_date) ? req.body.start_date : todayStr;
    db.run(
      "UPDATE program377_enrollments SET status = 'approved', start_date = ?, approved_at = datetime('now','localtime'), approved_by = ? WHERE id = ?",
      [startDate, req.adminUserId || null, req.params.id]
    );
    res.json({ ok: true });
  });

  app.post('/api/admin/program377/enrollments/:id/reject', requireAdmin, (req, res) => {
    db.run(
      "UPDATE program377_enrollments SET status = 'rejected', admin_note = ? WHERE id = ?",
      [req.body.admin_note || null, req.params.id]
    );
    res.json({ ok: true });
  });

  app.get('/api/admin/program377/reports', requireAdmin, (req, res) => {
    const { user_id = '', from = '', to = '', limit = 50, offset = 0 } = req.query;
    let sql = `SELECT r.*, u.first_name, u.last_name, u.email
               FROM program377_reports r JOIN users u ON u.id = r.user_id WHERE 1=1`;
    const params = [];
    if (user_id) { sql += ' AND r.user_id = ?'; params.push(user_id); }
    if (from) { sql += ' AND r.report_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND r.report_date <= ?'; params.push(to); }
    sql += ' ORDER BY r.report_date DESC, r.id DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const reports = db.all(sql, params).map(r => ({ ...r, meal_colors: JSON.parse(r.meal_colors || '[]'), meal_tastes: JSON.parse(r.meal_tastes || '[]') }));
    res.json({ reports });
  });

  app.get('/api/admin/program377/sessions', requireAdmin, (_req, res) => {
    res.json({ sessions: db.all('SELECT * FROM program377_sessions ORDER BY session_date ASC') });
  });

  app.post('/api/admin/program377/sessions', requireAdmin, (req, res) => {
    const { session_date, title, session_type, link_url, description } = req.body;
    if (!session_date || !title?.trim()) return res.status(400).json({ error: 'Thiếu ngày hoặc tiêu đề.' });
    const r = db.run(
      'INSERT INTO program377_sessions (session_date, title, session_type, link_url, description, created_by) VALUES (?,?,?,?,?,?)',
      [session_date, title.trim(), session_type || 'zoom', link_url || null, description || null, req.adminUserId || null]
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/program377/sessions/:id', requireAdmin, (req, res) => {
    const { session_date, title, session_type, link_url, description } = req.body;
    db.run(
      'UPDATE program377_sessions SET session_date=?, title=?, session_type=?, link_url=?, description=? WHERE id=?',
      [session_date, title?.trim(), session_type || 'zoom', link_url || null, description || null, req.params.id]
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/program377/sessions/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM program377_sessions WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // ── Telegram account linking (Agent 2 coaching) ──────────────
  // Generates a short-lived code the user sends to the bot as "/start <code>"
  // to link their web account to a Telegram chat_id (see the webhook below).
  app.get('/api/telegram/link-code/:userId', (req, res) => {
    const user = db.get('SELECT id, telegram_chat_id FROM users WHERE id = ?', [req.params.userId]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    if (user.telegram_chat_id) return res.json({ alreadyLinked: true, botLink: TELEGRAM_BOT_USERNAME ? `https://t.me/${TELEGRAM_BOT_USERNAME}` : null });
    if (!TELEGRAM_BOT_USERNAME) return res.status(500).json({ error: 'Chưa cấu hình TELEGRAM_BOT_USERNAME trong .env' });

    const code = crypto.randomBytes(6).toString('hex'); // 12 hex chars
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.run('UPDATE users SET telegram_link_code = ?, telegram_link_code_expires_at = ? WHERE id = ?',
      [code, expiresAt, user.id]);
    res.json({ code, deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}` });
  });

  // Inbound Telegram webhook — intentionally minimal: only handles "/start <code>"
  // for account linking. No free-chat handling (customers report via nhat-ky.html,
  // not by chatting with the bot — see plan doc for the reasoning).
  app.post('/api/telegram/webhook', async (req, res) => {
    res.json({ ok: true }); // ack Telegram immediately regardless of outcome below
    try {
      const msg = req.body && req.body.message;
      const text = msg && msg.text;
      const chatId = msg && msg.chat && msg.chat.id;
      if (!text || !chatId) return;

      const m = text.trim().match(/^\/start\s+([a-f0-9]{12})$/i);
      if (!m) {
        await sendTelegramMessage(chatId, 'Xin chào 👋 Vui lòng lấy link liên kết từ trang hồ sơ trên website để kết nối tài khoản.');
        return;
      }
      const code = m[1];
      const user = db.get(
        "SELECT id, first_name FROM users WHERE telegram_link_code = ? AND telegram_link_code_expires_at > datetime('now','localtime')",
        [code]
      );
      if (!user) {
        await sendTelegramMessage(chatId, '⚠️ Link đã hết hạn hoặc không hợp lệ. Vào lại trang hồ sơ để lấy link mới nhé.');
        return;
      }
      db.run(
        "UPDATE users SET telegram_chat_id = ?, telegram_link_code = NULL, telegram_link_code_expires_at = NULL WHERE id = ?",
        [String(chatId), user.id]
      );
      await sendTelegramMessage(chatId, `✅ Đã liên kết tài khoản thành công, ${user.first_name}! Từ giờ mình sẽ nhắc bạn ăn uống đúng giờ và nhận xét sau mỗi lần bạn ghi nhật ký nhé.`);
    } catch (err) {
      console.error('  [Telegram webhook] lỗi:', err.message);
    }
  });

  // ── Admin: space members (approve join requests / invite / remove) ──
  app.get('/api/admin/spaces/:id/members', requireAdmin, (req, res) => {
    const members = db.all(`
      SELECT sm.id, sm.status, sm.created_at, u.id AS user_id, u.first_name, u.last_name, u.email
      FROM space_members sm JOIN users u ON u.id = sm.user_id
      WHERE sm.space_id = ?
      ORDER BY sm.status ASC, sm.created_at ASC
    `, [req.params.id]);
    res.json({ members });
  });

  app.post('/api/admin/spaces/:id/members', requireAdmin, (req, res) => {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Vui lòng nhập email thành viên.' });
    const user = db.get('SELECT id FROM users WHERE email = ?', [email.trim()]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thành viên với email này.' });
    const existing = db.get('SELECT id FROM space_members WHERE space_id = ? AND user_id = ?', [req.params.id, user.id]);
    if (existing) {
      db.run("UPDATE space_members SET status = 'approved' WHERE id = ?", [existing.id]);
    } else {
      db.run('INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,?)', [req.params.id, user.id, 'approved']);
    }
    res.status(201).json({ success: true });
  });

  app.patch('/api/admin/space-members/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!['approved', 'pending'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    db.run('UPDATE space_members SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/space-members/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM space_members WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin courses ──────────────────────────────────────────
  app.get('/api/admin/courses', requireAdmin, (_req, res) => {
    const courses = db.all(`
      SELECT c.*, s.name AS space_name, g.name AS group_name, COUNT(DISTINCT cl.id) AS lesson_count,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'pending') AS pending_enrollments,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'approved') AS enrolled_count
      FROM courses c
      LEFT JOIN course_lessons cl ON cl.course_id = c.id
      LEFT JOIN spaces s ON s.id = c.space_id
      LEFT JOIN space_groups g ON g.id = c.group_id
      GROUP BY c.id ORDER BY c.order_num ASC, c.created_at DESC
    `);
    res.json({ courses });
  });

  // Keeps a private course's checkout in sync with a linked "product" row, so it can
  // be sold through the existing marketplace checkout/SePay pipeline. Public courses
  // don't need a checkout, so their linked product (if any) is soft-disabled instead.
  function syncCourseProduct(courseId) {
    const course = db.get('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return;
    const existingProduct = db.get('SELECT id FROM products WHERE course_id = ?', [courseId]);
    if (course.visibility === 'private') {
      if (existingProduct) {
        db.run(
          "UPDATE products SET title = ?, description = ?, price = ?, compare_price = ?, cover_color = ?, category = 'course', status = 'published' WHERE id = ?",
          [course.title, course.description || '', Number(course.price) || 0, Number(course.compare_price) || 0, course.cover_color, existingProduct.id]
        );
      } else {
        const sellerId = db.get('SELECT id FROM users ORDER BY id ASC LIMIT 1')?.id || 1;
        db.run(
          "INSERT INTO products (seller_id, title, description, price, compare_price, category, cover_color, status, course_id) VALUES (?,?,?,?,?,'course',?,'published',?)",
          [sellerId, course.title, course.description || '', Number(course.price) || 0, Number(course.compare_price) || 0, course.cover_color, courseId]
        );
      }
    } else if (existingProduct) {
      db.run("UPDATE products SET status = 'draft' WHERE id = ?", [existingProduct.id]);
    }
  }

  app.post('/api/admin/courses', requireAdmin, (req, res) => {
    const { title, description, cover_color = '#6366f1', instructor, status = 'draft', order_num = 0, space_id = null, group_id = null, visibility = 'public', price = 0, compare_price = 0 } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên khóa học không được để trống.' });
    const vis = ['public', 'private'].includes(visibility) ? visibility : 'public';
    const r = db.run(
      'INSERT INTO courses (title, description, cover_color, instructor, status, order_num, space_id, group_id, visibility, price, compare_price) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [title.trim(), description || '', cover_color, instructor || '', status, Number(order_num), space_id || null, group_id || null, vis, Number(price) || 0, Number(compare_price) || 0]
    );
    syncCourseProduct(r.lastInsertRowid);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/courses/:id', requireAdmin, (req, res) => {
    const { title, description, cover_color, instructor, status, order_num, space_id, group_id, visibility, price, compare_price } = req.body;
    const c = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    if (title !== undefined)       db.run('UPDATE courses SET title = ? WHERE id = ?', [title, req.params.id]);
    if (description !== undefined) db.run('UPDATE courses SET description = ? WHERE id = ?', [description, req.params.id]);
    if (cover_color !== undefined) db.run('UPDATE courses SET cover_color = ? WHERE id = ?', [cover_color, req.params.id]);
    if (instructor !== undefined)  db.run('UPDATE courses SET instructor = ? WHERE id = ?', [instructor, req.params.id]);
    if (status !== undefined)      db.run('UPDATE courses SET status = ? WHERE id = ?', [status, req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE courses SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    if (space_id !== undefined)    db.run('UPDATE courses SET space_id = ? WHERE id = ?', [space_id || null, req.params.id]);
    if (group_id !== undefined)    db.run('UPDATE courses SET group_id = ? WHERE id = ?', [group_id || null, req.params.id]);
    if (visibility !== undefined)  db.run('UPDATE courses SET visibility = ? WHERE id = ?', [['public', 'private'].includes(visibility) ? visibility : 'public', req.params.id]);
    if (price !== undefined)       db.run('UPDATE courses SET price = ? WHERE id = ?', [Number(price) || 0, req.params.id]);
    if (compare_price !== undefined) db.run('UPDATE courses SET compare_price = ? WHERE id = ?', [Number(compare_price) || 0, req.params.id]);
    syncCourseProduct(req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/admin/courses/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_lessons WHERE course_id = ?', [req.params.id]);
    db.run('DELETE FROM course_enrollments WHERE course_id = ?', [req.params.id]);
    db.run("UPDATE products SET status = 'draft', course_id = NULL WHERE course_id = ?", [req.params.id]);
    db.run('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin: course enrollments (approve enroll requests / add / remove) ──
  app.get('/api/admin/courses/:id/enrollments', requireAdmin, (req, res) => {
    const enrollments = db.all(`
      SELECT ce.id, ce.status, ce.created_at, u.id AS user_id, u.first_name, u.last_name, u.email
      FROM course_enrollments ce JOIN users u ON u.id = ce.user_id
      WHERE ce.course_id = ?
      ORDER BY ce.status ASC, ce.created_at ASC
    `, [req.params.id]);
    res.json({ enrollments });
  });

  app.post('/api/admin/courses/:id/enrollments', requireAdmin, (req, res) => {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Vui lòng nhập email học viên.' });
    const user = db.get('SELECT id FROM users WHERE email = ?', [email.trim()]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thành viên với email này.' });
    const existing = db.get('SELECT id FROM course_enrollments WHERE course_id = ? AND user_id = ?', [req.params.id, user.id]);
    if (existing) {
      db.run("UPDATE course_enrollments SET status = 'approved' WHERE id = ?", [existing.id]);
    } else {
      db.run('INSERT INTO course_enrollments (course_id, user_id, status) VALUES (?,?,?)', [req.params.id, user.id, 'approved']);
    }
    res.status(201).json({ success: true });
  });

  app.patch('/api/admin/course-enrollments/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!['approved', 'pending'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    db.run('UPDATE course_enrollments SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/course-enrollments/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_enrollments WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Course modules — group lessons into chapters
  app.get('/api/admin/courses/:id/modules', requireAdmin, (req, res) => {
    const modules = db.all('SELECT * FROM course_modules WHERE course_id = ? ORDER BY order_num ASC, id ASC', [req.params.id]);
    res.json({ modules });
  });
  app.post('/api/admin/courses/:id/modules', requireAdmin, (req, res) => {
    const { title, order_num = 0 } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên module không được để trống.' });
    const course = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const r = db.run('INSERT INTO course_modules (course_id, title, order_num) VALUES (?,?,?)',
      [req.params.id, title.trim(), Number(order_num) || 0]);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/modules/:id', requireAdmin, (req, res) => {
    const m = db.get('SELECT id FROM course_modules WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ error: 'Không tìm thấy module.' });
    const { title, order_num } = req.body;
    if (title !== undefined) db.run('UPDATE course_modules SET title = ? WHERE id = ?', [title, req.params.id]);
    if (order_num !== undefined) db.run('UPDATE course_modules SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });
  app.delete('/api/admin/modules/:id', requireAdmin, (req, res) => {
    db.run('UPDATE course_lessons SET module_id = NULL WHERE module_id = ?', [req.params.id]);
    db.run('DELETE FROM course_modules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Course lessons
  app.get('/api/admin/courses/:id/lessons', requireAdmin, (req, res) => {
    const lessons = db.all(
      'SELECT * FROM course_lessons WHERE course_id = ? ORDER BY order_num ASC, id ASC',
      [req.params.id]
    );
    res.json({ lessons });
  });

  app.post('/api/admin/courses/:id/lessons', requireAdmin, (req, res) => {
    const {
      title, content, video_url, duration_min = 0, order_num = 0, status = 'published', module_id = null,
      exercise_enabled = 0, exercise_type = 'text', exercise_prompt = '', exercise_rubric = '',
      exercise_max_score = 100, exercise_pass_score = 70, exercise_xp_reward = 0,
    } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên bài học không được để trống.' });
    const course = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const r = db.run(
      `INSERT INTO course_lessons
        (course_id, module_id, title, content, video_url, duration_min, order_num, status,
         exercise_enabled, exercise_type, exercise_prompt, exercise_rubric, exercise_max_score, exercise_pass_score, exercise_xp_reward)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.id, module_id || null, title.trim(), content || '', video_url || '', Number(duration_min), Number(order_num), status === 'draft' ? 'draft' : 'published',
       exercise_enabled ? 1 : 0, exercise_type === 'quiz' ? 'quiz' : 'text', exercise_prompt || '', exercise_rubric || '', Number(exercise_max_score) || 100, Number(exercise_pass_score) || 70, Number(exercise_xp_reward) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/lessons/:id', requireAdmin, (req, res) => {
    const {
      title, content, video_url, duration_min, order_num, status, module_id,
      exercise_enabled, exercise_type, exercise_prompt, exercise_rubric, exercise_max_score, exercise_pass_score, exercise_xp_reward,
    } = req.body;
    const l = db.get('SELECT id FROM course_lessons WHERE id = ?', [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Bài học không tồn tại.' });
    if (title !== undefined)       db.run('UPDATE course_lessons SET title = ? WHERE id = ?', [title, req.params.id]);
    if (content !== undefined)     db.run('UPDATE course_lessons SET content = ? WHERE id = ?', [content, req.params.id]);
    if (video_url !== undefined)   db.run('UPDATE course_lessons SET video_url = ? WHERE id = ?', [video_url, req.params.id]);
    if (duration_min !== undefined) db.run('UPDATE course_lessons SET duration_min = ? WHERE id = ?', [Number(duration_min), req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE course_lessons SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    if (status !== undefined)      db.run('UPDATE course_lessons SET status = ? WHERE id = ?', [status === 'draft' ? 'draft' : 'published', req.params.id]);
    if (module_id !== undefined)   db.run('UPDATE course_lessons SET module_id = ? WHERE id = ?', [module_id || null, req.params.id]);
    if (exercise_enabled !== undefined)   db.run('UPDATE course_lessons SET exercise_enabled = ? WHERE id = ?', [exercise_enabled ? 1 : 0, req.params.id]);
    if (exercise_type !== undefined)      db.run('UPDATE course_lessons SET exercise_type = ? WHERE id = ?', [exercise_type === 'quiz' ? 'quiz' : 'text', req.params.id]);
    if (exercise_prompt !== undefined)    db.run('UPDATE course_lessons SET exercise_prompt = ? WHERE id = ?', [exercise_prompt, req.params.id]);
    if (exercise_rubric !== undefined)    db.run('UPDATE course_lessons SET exercise_rubric = ? WHERE id = ?', [exercise_rubric, req.params.id]);
    if (exercise_max_score !== undefined) db.run('UPDATE course_lessons SET exercise_max_score = ? WHERE id = ?', [Number(exercise_max_score) || 100, req.params.id]);
    if (exercise_pass_score !== undefined) db.run('UPDATE course_lessons SET exercise_pass_score = ? WHERE id = ?', [Number(exercise_pass_score) || 70, req.params.id]);
    if (exercise_xp_reward !== undefined) db.run('UPDATE course_lessons SET exercise_xp_reward = ? WHERE id = ?', [Number(exercise_xp_reward) || 0, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/lessons/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_lessons WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  app.get('/api/admin/lessons/:id/questions', requireAdmin, (req, res) => {
    const questions = db.all(
      'SELECT * FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC',
      [req.params.id]
    ).map(q => ({ ...q, options: JSON.parse(q.options) }));
    res.json({ questions });
  });

  app.post('/api/admin/lessons/:id/questions', requireAdmin, (req, res) => {
    const { question_text, options, correct_index, explanation = '', order_num = 0 } = req.body;
    if (!question_text?.trim()) return res.status(400).json({ error: 'Nội dung câu hỏi không được để trống.' });
    if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'Cần ít nhất 2 đáp án.' });
    if (correct_index === undefined || correct_index < 0 || correct_index >= options.length)
      return res.status(400).json({ error: 'Vui lòng chọn đáp án đúng.' });
    const lesson = db.get('SELECT id FROM course_lessons WHERE id = ?', [req.params.id]);
    if (!lesson) return res.status(404).json({ error: 'Bài học không tồn tại.' });
    const r = db.run(
      'INSERT INTO lesson_exercise_questions (lesson_id, question_text, options, correct_index, explanation, order_num) VALUES (?,?,?,?,?,?)',
      [req.params.id, question_text.trim(), JSON.stringify(options.map(o => String(o).trim())), Number(correct_index), explanation || '', Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/questions/:id', requireAdmin, (req, res) => {
    const { question_text, options, correct_index, explanation, order_num } = req.body;
    const q = db.get('SELECT id FROM lesson_exercise_questions WHERE id = ?', [req.params.id]);
    if (!q) return res.status(404).json({ error: 'Câu hỏi không tồn tại.' });
    if (question_text !== undefined) db.run('UPDATE lesson_exercise_questions SET question_text = ? WHERE id = ?', [question_text, req.params.id]);
    if (options !== undefined)       db.run('UPDATE lesson_exercise_questions SET options = ? WHERE id = ?', [JSON.stringify(options.map(o => String(o).trim())), req.params.id]);
    if (correct_index !== undefined) db.run('UPDATE lesson_exercise_questions SET correct_index = ? WHERE id = ?', [Number(correct_index), req.params.id]);
    if (explanation !== undefined)   db.run('UPDATE lesson_exercise_questions SET explanation = ? WHERE id = ?', [explanation, req.params.id]);
    if (order_num !== undefined)     db.run('UPDATE lesson_exercise_questions SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/questions/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM lesson_exercise_questions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  app.get('/api/admin/lesson-exercise-submissions', requireAdmin, (req, res) => {
    const { course_id = '', lesson_id = '', passed = '', limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT les.id, les.answer_text, les.score, les.max_score, les.pass_score, les.passed,
             les.issues, les.hints, les.xp_awarded, les.status, les.teacher_note, les.submitted_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             cl.id AS lesson_id, cl.title AS lesson_title, cl.exercise_rubric, cl.exercise_type,
             c.id AS course_id, c.title AS course_title
      FROM lesson_exercise_submissions les
      JOIN users u ON u.id = les.user_id
      JOIN course_lessons cl ON cl.id = les.lesson_id
      JOIN courses c ON c.id = les.course_id
      WHERE 1=1`;
    const params = [];
    if (course_id) { sql += ' AND les.course_id = ?'; params.push(Number(course_id)); }
    if (lesson_id) { sql += ' AND les.lesson_id = ?'; params.push(Number(lesson_id)); }
    if (passed !== '') { sql += ' AND les.passed = ?'; params.push(Number(passed)); }
    sql += ' ORDER BY les.submitted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const questionsCache = {};
    const submissions = db.all(sql, params).map(s => {
      const base = { ...s, issues: JSON.parse(s.issues || '[]'), hints: JSON.parse(s.hints || '[]') };
      if (s.exercise_type === 'quiz') {
        if (!questionsCache[s.lesson_id]) {
          questionsCache[s.lesson_id] = db.all(
            'SELECT * FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC',
            [s.lesson_id]
          );
        }
        const answers = JSON.parse(s.answer_text || '{}');
        base.quiz_review = questionsCache[s.lesson_id].map(q => {
          const options = JSON.parse(q.options);
          const picked = answers[q.id];
          return {
            question_text: q.question_text,
            picked_option: picked !== undefined ? options[picked] : null,
            correct_option: options[q.correct_index],
            is_correct: picked === q.correct_index,
          };
        });
      }
      return base;
    });
    let cntSql = 'SELECT COUNT(*) AS n FROM lesson_exercise_submissions WHERE 1=1';
    const cntP = [];
    if (course_id) { cntSql += ' AND course_id = ?'; cntP.push(Number(course_id)); }
    if (lesson_id) { cntSql += ' AND lesson_id = ?'; cntP.push(Number(lesson_id)); }
    if (passed !== '') { cntSql += ' AND passed = ?'; cntP.push(Number(passed)); }
    const total = db.get(cntSql, cntP).n;
    res.json({ submissions, total });
  });

  // Teacher intervention on an already-graded lesson exercise submission:
  // request_resubmit unlocks one more attempt (student's next submit UPDATEs this row);
  // finalize sets a manual score/note and permanently locks the submission — no further action possible.
  app.patch('/api/admin/lesson-exercise-submissions/:id', requireAdmin, (req, res) => {
    const { action, note = '', score } = req.body;
    const sub = db.get('SELECT * FROM lesson_exercise_submissions WHERE id = ?', [req.params.id]);
    if (!sub) return res.status(404).json({ error: 'Bài nộp không tồn tại.' });
    if (sub.status === 'finalized') return res.status(400).json({ error: 'Bài tập này đã kết thúc, không thể thao tác thêm.' });

    if (action === 'request_resubmit') {
      db.run('UPDATE lesson_exercise_submissions SET status = ?, teacher_note = ? WHERE id = ?', ['needs_resubmit', note, req.params.id]);
    } else if (action === 'finalize') {
      const s = Number(score);
      if (!Number.isFinite(s) || s < 0 || s > sub.max_score) return res.status(400).json({ error: 'Điểm không hợp lệ.' });
      const passed = s >= sub.pass_score ? 1 : 0;
      const alreadyAwarded = sub.xp_awarded > 0;
      let xp_awarded = sub.xp_awarded;
      if (passed && !alreadyAwarded) {
        const lesson = db.get('SELECT title, exercise_xp_reward FROM course_lessons WHERE id = ?', [sub.lesson_id]);
        xp_awarded = lesson?.exercise_xp_reward || 0;
        if (xp_awarded > 0) addXP(sub.user_id, xp_awarded, 'lesson_exercise', `Giáo viên chấm lại: ${lesson.title}`);
      }
      db.run(
        `UPDATE lesson_exercise_submissions SET status = 'finalized', score = ?, passed = ?, teacher_note = ?, xp_awarded = ? WHERE id = ?`,
        [s, passed, note, xp_awarded, req.params.id]
      );
    } else {
      return res.status(400).json({ error: 'Hành động không hợp lệ.' });
    }

    const updated = db.get('SELECT * FROM lesson_exercise_submissions WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      submission: { ...updated, issues: JSON.parse(updated.issues || '[]'), hints: JSON.parse(updated.hints || '[]') },
    });
  });

  // ── Admin settings ────────────────────────────────────────
  app.patch('/api/admin/settings', requireAdmin, (req, res) => {
    const allowed = [
      'announcement_enabled', 'announcement_text', 'announcement_icon',
      'late_reminder_enabled',
      'calendar_embed_url', 'about_intro', 'about_media',
      'community_name',
      'challenge_hero_icon', 'challenge_hero_title', 'challenge_hero_desc',
      'mp_store_name', 'mp_store_desc',
      'mp_bank_name', 'mp_bank_account_name', 'mp_bank_account_number',
      'home_tagline', 'home_heading_line1', 'home_heading_highlight', 'home_heading_line2',
      'home_desc', 'home_stat1_value', 'home_stat1_label', 'home_stat2_value', 'home_stat2_label',
      'home_stat3_value', 'home_stat3_label', 'home_tags',
      'courses_hero_icon', 'courses_hero_title', 'courses_hero_desc',
      'assistant_enabled', 'assistant_daily_limit',
      'p377_letter_html', 'p377_topics_overview',
    ];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'Không có trường hợp lệ.' });
    updates.forEach(([key, value]) => {
      db.run('INSERT INTO site_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
    });
    res.json({ success: true });
  });

  // Trợ lý Ngũ Hành — lịch sử hỏi đáp để admin đánh giá chất lượng câu trả lời
  app.get('/api/admin/assistant-logs', requireAdmin, (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const logs = db.all(`
      SELECT l.id, l.user_id, l.question, l.answer, l.created_at,
             u.first_name, u.last_name, u.email
      FROM assistant_logs l JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const total = db.get('SELECT COUNT(*) AS n FROM assistant_logs').n;
    const today = db.get("SELECT date('now','localtime') AS d").d;
    const asked_today = db.get(
      'SELECT COALESCE(SUM(count),0) AS n FROM assistant_usage WHERE usage_date = ?', [today]
    ).n;
    res.json({ logs, total, asked_today });
  });

  // AI providers — kept out of site_settings/admin/settings on purpose since
  // GET /api/settings is public and returns that whole table unfiltered.
  const AI_PROVIDER_TYPES = ['openrouter', 'google_ai_studio'];

  app.get('/api/admin/ai-providers', requireAdmin, (req, res) => {
    const rows = db.all('SELECT * FROM ai_providers ORDER BY created_at ASC');
    res.json({
      providers: rows.map(r => ({
        id: r.id, name: r.name, provider_type: r.provider_type, model: r.model,
        masked: maskKey(r.api_key), is_active: !!r.is_active, created_at: r.created_at,
      })),
    });
  });

  app.post('/api/admin/ai-providers', requireAdmin, (req, res) => {
    const { name, provider_type, api_key, model } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Vui lòng nhập tên.' });
    if (!AI_PROVIDER_TYPES.includes(provider_type)) return res.status(400).json({ error: 'Nhà cung cấp không hợp lệ.' });
    if (!api_key?.trim()) return res.status(400).json({ error: 'Vui lòng nhập API key.' });
    const isFirst = db.get('SELECT COUNT(*) AS n FROM ai_providers').n === 0;
    const r = db.run(
      'INSERT INTO ai_providers (name, provider_type, api_key, model, is_active) VALUES (?,?,?,?,?)',
      [name.trim(), provider_type, api_key.trim(), (model || '').trim() || null, isFirst ? 1 : 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/ai-providers/:id', requireAdmin, (req, res) => {
    const { name, provider_type, api_key, model } = req.body;
    const t = db.get('SELECT id FROM ai_providers WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy.' });
    if (provider_type !== undefined && !AI_PROVIDER_TYPES.includes(provider_type)) return res.status(400).json({ error: 'Nhà cung cấp không hợp lệ.' });
    if (name !== undefined)          db.run('UPDATE ai_providers SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    if (provider_type !== undefined) db.run('UPDATE ai_providers SET provider_type = ? WHERE id = ?', [provider_type, req.params.id]);
    if (model !== undefined)         db.run('UPDATE ai_providers SET model = ? WHERE id = ?', [(model || '').trim() || null, req.params.id]);
    if (api_key?.trim())             db.run('UPDATE ai_providers SET api_key = ? WHERE id = ?', [api_key.trim(), req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/ai-providers/:id', requireAdmin, (req, res) => {
    const t = db.get('SELECT is_active FROM ai_providers WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy.' });
    db.run('DELETE FROM ai_providers WHERE id = ?', [req.params.id]);
    if (t.is_active) {
      const next = db.get('SELECT id FROM ai_providers ORDER BY created_at DESC LIMIT 1');
      if (next) db.run('UPDATE ai_providers SET is_active = 1 WHERE id = ?', [next.id]);
    }
    res.json({ success: true });
  });

  app.post('/api/admin/ai-providers/:id/activate', requireAdmin, (req, res) => {
    const t = db.get('SELECT id FROM ai_providers WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy.' });
    db.run('UPDATE ai_providers SET is_active = 0');
    db.run('UPDATE ai_providers SET is_active = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Notifications (user) ──────────────────────────────────
  app.get('/api/notifications', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const notifications = db.all(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [user_id]
    );
    const unread = notifications.filter(n => !n.is_read).length;
    res.json({ notifications, unread });
  });

  app.patch('/api/notifications/:id/read', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, user_id]);
    res.json({ success: true });
  });

  app.post('/api/notifications/read-all', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [user_id]);
    res.json({ success: true });
  });

  // ── Admin notifications ────────────────────────────────────
  app.get('/api/admin/notifications', requireAdmin, (_req, res) => {
    const notifs = db.all(`
      SELECT type, title, content, link,
             MAX(created_at) AS created_at,
             COUNT(*) AS sent_count
      FROM notifications
      WHERE sent_by_admin = 1
      GROUP BY title, content, type, link
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(notifs);
  });

  app.post('/api/admin/notifications', requireAdmin, (req, res) => {
    const { user_id, type, title, content, link } = req.body;
    if (!type || !title || !content) return res.status(400).json({ error: 'Thiếu type, title hoặc content.' });

    if (user_id === 'all') {
      const users = db.all("SELECT id FROM users WHERE status = 'active'");
      for (const u of users) {
        db.run(
          'INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
          [u.id, type, title, content, link || null]
        );
      }
      res.json({ success: true, sent: users.length });
    } else {
      const uid = Number(user_id);
      if (!uid) return res.status(400).json({ error: 'user_id không hợp lệ.' });
      const user = db.get('SELECT id FROM users WHERE id = ?', [uid]);
      if (!user) return res.status(404).json({ error: 'Không tìm thấy user.' });
      db.run(
        'INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
        [uid, type, title, content, link || null]
      );
      res.json({ success: true, sent: 1 });
    }
  });

  // ══════════════════════════════════════════════════════════
  // MARKETPLACE ROUTES
  // ══════════════════════════════════════════════════════════

  // List products (public)
  app.get('/api/products', (req, res) => {
    const { category, sort, q } = req.query;
    // Course-checkout products are sold from the course page, not the general marketplace.
    let where = "p.status = 'published' AND p.course_id IS NULL";
    const params = [];
    if (category && category !== 'all') { where += ' AND p.category = ?'; params.push(category); }
    if (q) { where += ' AND (p.title LIKE ? OR p.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    const orderMap = { newest: 'p.created_at DESC', popular: 'p.sales_count DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC' };
    const orderBy = orderMap[sort] || 'p.created_at DESC';
    const products = db.all(`
      SELECT p.id, p.title, p.description, p.price, p.compare_price, p.detail_url, p.is_featured,
             p.category, p.cover_color,
             p.sales_count, p.created_at,
             u.first_name, u.last_name, u.xp
      FROM products p
      JOIN users u ON u.id = p.seller_id
      WHERE ${where}
      ORDER BY ${orderBy}
    `, params);
    const total = db.get("SELECT COUNT(*) AS n FROM products WHERE status = 'published' AND course_id IS NULL").n;
    res.json({ products, total });
  });

  // Product detail (public)
  app.get('/api/products/:id', (req, res) => {
    const product = db.get(`
      SELECT p.*, u.first_name, u.last_name, u.xp, u.level
      FROM products p
      JOIN users u ON u.id = p.seller_id
      WHERE p.id = ? AND p.status = 'published'
    `, [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    res.json(product);
  });

  // Create product (user) — status = pending_review, chờ admin duyệt
  app.post('/api/products', (req, res) => {
    const { user_id, title, description, long_description, price, category, cover_color } = req.body;
    if (!user_id || !title || price === undefined)
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc.' });
    const seller = db.get('SELECT id, first_name, last_name, email FROM users WHERE id = ? AND status = ?', [user_id, 'active']);
    if (!seller) return res.status(403).json({ error: 'Tài khoản không hợp lệ.' });
    const result = db.run(
      "INSERT INTO products (seller_id, title, description, long_description, price, category, cover_color, status) VALUES (?,?,?,?,?,?,?,'pending_review')",
      [user_id, title, description || '', long_description || '', Number(price), category || 'other', cover_color || '#0ea5e9']
    );
    const product = db.get('SELECT * FROM products WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, product });

    const amtFmt = Number(price) === 0 ? 'Miễn phí' : Number(price).toLocaleString('vi-VN') + 'đ';
    // Email xác nhận cho người bán
    sendEmail({
      to: seller.email,
      subject: '⏳ Sản phẩm đã gửi — đang chờ admin duyệt',
      html: emailWrap('Sản phẩm đang chờ duyệt', `
        <p>Xin chào <strong>${seller.first_name}</strong>,</p>
        <p>Sản phẩm của bạn đã được gửi thành công và đang chờ admin xem xét:</p>
        <div class="rule">
          🛍️ <strong>${title}</strong><br>
          💰 Giá: <strong>${amtFmt}</strong>
        </div>
        <p>Admin sẽ duyệt trong vòng <strong>24 giờ</strong>. Bạn sẽ nhận email ngay khi có kết quả.</p>
        <a class="btn" href="${SITE_URL}/marketplace.html">Xem Marketplace</a>
      `)
    });
    // Thông báo cho admin
    sendEmail({
      to: ADMIN_EMAIL,
      subject: `🆕 Sản phẩm mới chờ duyệt: ${title}`,
      html: emailWrap('Có sản phẩm mới cần duyệt', `
        <p>Thành viên vừa đăng sản phẩm mới:</p>
        <div class="rule">
          🛍️ <strong>${title}</strong><br>
          👤 Người bán: <strong>${seller.first_name} ${seller.last_name}</strong> (${seller.email})<br>
          💰 Giá: <strong>${amtFmt}</strong><br>
          🆔 ID sản phẩm: #${product.id}
        </div>
        <a class="btn" href="${SITE_URL}/admin.html">Duyệt trong Admin Panel</a>
      `)
    });
  });

  // Place order (user)
  app.post('/api/orders', (req, res) => {
    const { product_id, buyer_id, payment_method, note } = req.body;
    if (!product_id || !buyer_id)
      return res.status(400).json({ error: 'Thiếu thông tin đặt hàng.' });
    const product = db.get("SELECT * FROM products WHERE id = ? AND status = 'published'", [product_id]);
    if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    const buyer = db.get('SELECT id FROM users WHERE id = ? AND status = ?', [buyer_id, 'active']);
    if (!buyer) return res.status(403).json({ error: 'Tài khoản không hợp lệ.' });
    const result = db.run(
      'INSERT INTO orders (product_id, buyer_id, amount, payment_method, note) VALUES (?,?,?,?,?)',
      [product_id, buyer_id, product.price, payment_method || 'bank', note || '']
    );
    db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [product_id]);
    const order = db.get('SELECT * FROM orders WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, order });

    // 15-min reminder email if still pending after 15 minutes
    const orderId  = order.id;
    const buyerRow = db.get('SELECT first_name, last_name, email FROM users WHERE id = ?', [buyer_id]);
    const qrUrl    = `https://qr.sepay.vn/img?bank=BIDV&acc=96247NGUYEN&template=compact&amount=${product.price}&des=${SEPAY_MEMO_PREFIX}%20${product_id}%20${buyer_id}`;
    const amountFmt = Number(product.price).toLocaleString('vi-VN') + 'đ';

    if (buyerRow) {
      setTimeout(() => {
        const current = db.get('SELECT status, mail_15m FROM orders WHERE id = ?', [orderId]);
        if (!current || current.status === 'completed' || current.mail_15m) return;
        db.run('UPDATE orders SET mail_15m = 1 WHERE id = ?', [orderId]);
        sendEmail({
          to: buyerRow.email,
          subject: '⏰ Đơn hàng của bạn chưa được thanh toán',
          html: emailWrap('Nhắc nhở: Hoàn tất thanh toán', `
            <p>Xin chào <strong>${buyerRow.first_name}</strong>,</p>
            <p>Đơn hàng <strong>${product.title}</strong> (${amountFmt}) của bạn vẫn đang chờ thanh toán.</p>
            <p>Vui lòng chuyển khoản đến:</p>
            <div class="rule">
              🏦 <strong>BIDV</strong> — STK: <strong>96247NGUYEN</strong><br>
              Chủ TK: <strong>TỪ CHÍ NGUYỆN</strong><br>
              Số tiền: <strong>${amountFmt}</strong><br>
              Nội dung: <strong>${SEPAY_MEMO_PREFIX} ${product_id} ${buyer_id}</strong>
            </div>
            <p>Quét mã QR để thanh toán nhanh:</p>
            <p><img src="${qrUrl}" alt="QR Code" style="width:180px;border-radius:8px;border:1px solid #e2e8f0"></p>
            <a class="btn" href="${SITE_URL}/checkout.html?id=${product_id}">Xem lại đơn hàng</a>
            <p style="color:#94a3b8;font-size:13px">Đơn hàng sẽ tự động hủy nếu không nhận được thanh toán trong 48 giờ.</p>
          `)
        });
      }, 15 * 60 * 1000);
    }
  });

  // My orders (buyer)
  app.get('/api/my/orders', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const orders = db.all(`
      SELECT o.id, o.amount, o.payment_method, o.status, o.created_at,
             p.title, p.cover_color, p.category,
             u.first_name AS seller_first, u.last_name AS seller_last
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users u ON u.id = p.seller_id
      WHERE o.buyer_id = ?
      ORDER BY o.created_at DESC
    `, [user_id]);
    res.json(orders);
  });

  // My products (seller)
  app.get('/api/my/products', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const products = db.all(
      'SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC',
      [user_id]
    );
    res.json(products);
  });

  // Admin — list all products (course-checkout products are managed from the course page, not here)
  app.get('/api/admin/products', requireAdmin, (_req, res) => {
    const products = db.all(`
      SELECT p.*, u.first_name, u.last_name, u.email
      FROM products p
      JOIN users u ON u.id = p.seller_id
      WHERE p.course_id IS NULL
      ORDER BY p.created_at DESC
    `);
    res.json(products);
  });

  // Admin — create product
  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const { title, description, long_description, price, compare_price, detail_url, is_featured, category, cover_color, status, seller_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Thiếu tên sản phẩm.' });
    const sid = seller_id || db.get('SELECT id FROM users ORDER BY id ASC LIMIT 1')?.id || 1;
    const result = db.run(
      'INSERT INTO products (seller_id, title, description, long_description, price, compare_price, detail_url, is_featured, category, cover_color, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [sid, title, description || '', long_description || '', Number(price) || 0, Number(compare_price) || 0,
       detail_url || null, is_featured ? 1 : 0, category || 'other', cover_color || '#0ea5e9', status || 'published']
    );
    const product = db.get('SELECT * FROM products WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, product });
  });

  // Admin — update product
  app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
    const { status, title, description, long_description, price, compare_price, detail_url, is_featured, category, cover_color } = req.body;
    const fields = []; const params = [];
    if (status !== undefined)           { fields.push('status = ?');           params.push(status); }
    if (title !== undefined)            { fields.push('title = ?');            params.push(title); }
    if (description !== undefined)      { fields.push('description = ?');      params.push(description); }
    if (long_description !== undefined) { fields.push('long_description = ?'); params.push(long_description); }
    if (price !== undefined)            { fields.push('price = ?');            params.push(Number(price)); }
    if (compare_price !== undefined)    { fields.push('compare_price = ?');    params.push(Number(compare_price) || 0); }
    if (detail_url !== undefined)       { fields.push('detail_url = ?');       params.push(detail_url || null); }
    if (is_featured !== undefined)      { fields.push('is_featured = ?');      params.push(is_featured ? 1 : 0); }
    if (category !== undefined)         { fields.push('category = ?');         params.push(category); }
    if (cover_color !== undefined)      { fields.push('cover_color = ?');      params.push(cover_color); }
    if (!fields.length) return res.status(400).json({ error: 'Không có trường cần cập nhật.' });
    const productId = Number(req.params.id);
    const prevProduct = db.get('SELECT status FROM products WHERE id = ?', [productId]);
    params.push(productId);
    db.run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });

    // Gửi email khi admin thay đổi status sản phẩm
    if (status && prevProduct && prevProduct.status !== status) {
      const prod = db.get(`
        SELECT p.title, p.price, u.first_name, u.last_name, u.email
        FROM products p JOIN users u ON u.id = p.seller_id
        WHERE p.id = ?
      `, [productId]);
      if (prod) {
        const amtFmt = Number(prod.price) === 0 ? 'Miễn phí' : Number(prod.price).toLocaleString('vi-VN') + 'đ';
        if (status === 'published') {
          sendEmail({
            to: prod.email,
            subject: '✅ Sản phẩm của bạn đã được duyệt!',
            html: emailWrap('Sản phẩm đã được duyệt', `
              <p>Xin chào <strong>${prod.first_name}</strong>,</p>
              <p>Tuyệt vời! Sản phẩm của bạn đã được admin duyệt và hiện đang hiển thị trên Marketplace:</p>
              <div class="rule">
                🛍️ <strong>${prod.title}</strong><br>
                💰 Giá: <strong>${amtFmt}</strong>
              </div>
              <a class="btn" href="${SITE_URL}/marketplace.html">Xem trên Marketplace</a>
            `)
          });
        } else if (status === 'rejected') {
          sendEmail({
            to: prod.email,
            subject: '❌ Sản phẩm chưa được duyệt',
            html: emailWrap('Sản phẩm chưa được duyệt', `
              <p>Xin chào <strong>${prod.first_name}</strong>,</p>
              <p>Rất tiếc, sản phẩm dưới đây chưa đáp ứng tiêu chí duyệt của chúng tôi:</p>
              <div class="rule">🛍️ <strong>${prod.title}</strong></div>
              <p>Vui lòng liên hệ admin để biết lý do và chỉnh sửa lại trước khi đăng lại.</p>
              <a class="btn" href="${SITE_URL}/marketplace.html">Về Marketplace</a>
            `)
          });
        }
      }
    }
  });

  // Admin — delete product
  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Admin — list all orders
  app.get('/api/admin/orders', requireAdmin, (_req, res) => {
    const orders = db.all(`
      SELECT o.id, o.amount, o.payment_method, o.status, o.created_at,
             p.title AS product_title,
             ub.first_name AS buyer_first, ub.last_name AS buyer_last, ub.email AS buyer_email,
             us.first_name AS seller_first, us.last_name AS seller_last
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users ub ON ub.id = o.buyer_id
      JOIN users us ON us.id = p.seller_id
      ORDER BY o.created_at DESC
    `);
    res.json(orders);
  });

  // Admin — update order status
  app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    const orderId = Number(req.params.id);
    const prev = db.get('SELECT status FROM orders WHERE id = ?', [orderId]);
    db.run('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    res.json({ success: true });

    if (!prev || prev.status === status) return;

    // Fetch full order info for email
    const info = db.get(`
      SELECT o.amount, o.buyer_id, p.title AS product_title, p.id AS product_id,
             u.first_name, u.last_name, u.email AS buyer_email
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users u ON u.id = o.buyer_id
      WHERE o.id = ?
    `, [orderId]);
    if (!info) return;

    const amtFmt = Number(info.amount).toLocaleString('vi-VN') + 'đ';

    if (status === 'completed') {
      autoEnrollFromProductPurchase(info.product_id, info.buyer_id);
      sendPaymentConfirmedEmails(orderId);
    } else if (status === 'cancelled') {
      sendEmail({
        to: info.buyer_email,
        subject: '❌ Đơn hàng của bạn đã bị hủy',
        html: emailWrap('Đơn hàng đã bị hủy', `
          <p>Xin chào <strong>${info.first_name}</strong>,</p>
          <p>Rất tiếc, đơn hàng dưới đây đã bị hủy:</p>
          <div class="rule">
            🛍️ Sản phẩm: <strong>${info.product_title}</strong><br>
            💰 Số tiền: <strong>${amtFmt}</strong><br>
            🆔 Mã đơn: #${orderId}
          </div>
          <p>Nếu bạn đã chuyển khoản, vui lòng liên hệ admin để được hoàn tiền hoặc hỗ trợ.</p>
          <a class="btn" href="${SITE_URL}/marketplace.html">Xem Marketplace</a>
        `)
      });
    }
  });

  // Buyer — manual claim (đã chuyển khoản, chờ admin xác nhận)
  app.post('/api/orders/:id/claim', (req, res) => {
    const { user_id } = req.body;
    const orderId = Number(req.params.id);
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const order = db.get(
      "SELECT o.*, p.title AS product_title, u.first_name, u.last_name, u.email FROM orders o JOIN products p ON p.id=o.product_id JOIN users u ON u.id=o.buyer_id WHERE o.id=? AND o.buyer_id=?",
      [orderId, user_id]
    );
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
    if (order.status === 'completed') return res.json({ success: true, already: true });

    db.run("UPDATE orders SET status = 'claimed' WHERE id = ?", [orderId]);
    res.json({ success: true });

    const amtFmt = Number(order.amount).toLocaleString('vi-VN') + 'đ';
    sendEmail({
      to: order.email,
      subject: '⏳ Đã nhận yêu cầu — đang chờ xác nhận thanh toán',
      html: emailWrap('Yêu cầu của bạn đã được ghi nhận', `
        <p>Xin chào <strong>${order.first_name}</strong>,</p>
        <p>Chúng tôi đã nhận được xác nhận chuyển khoản của bạn cho đơn hàng:</p>
        <div class="rule">
          🛍️ Sản phẩm: <strong>${order.product_title}</strong><br>
          💰 Số tiền: <strong>${amtFmt}</strong><br>
          🆔 Mã đơn: #${orderId}
        </div>
        <p>Admin sẽ kiểm tra và xác nhận thanh toán trong vòng <strong>1–4 giờ</strong> (giờ hành chính). Bạn sẽ nhận thêm email sau khi được xác nhận.</p>
        <p style="color:#94a3b8;font-size:13px">Nếu có thắc mắc, hãy liên hệ qua ${COMMUNITY_NAME}.</p>
      `)
    });
    // Notify admin
    sendEmail({
      to: ADMIN_EMAIL,
      subject: `🔔 Đơn #${orderId} — khách xác nhận đã chuyển khoản`,
      html: emailWrap(`Khách xác nhận đơn #${orderId}`, `
        <p>Khách hàng vừa bấm "Tôi đã chuyển khoản":</p>
        <div class="rule">
          👤 <strong>${order.first_name} ${order.last_name}</strong> (${order.email})<br>
          🛍️ ${order.product_title}<br>
          💰 ${amtFmt}<br>
          🆔 Đơn #${orderId}
        </div>
        <a class="btn" href="${SITE_URL}/admin.html">Xác nhận trong Admin Panel</a>
      `)
    });
  });

  // ── Order status (buyer polling) ──────────────────────────
  app.get('/api/orders/:id', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const order = db.get(
      'SELECT id, status, payment_method, amount FROM orders WHERE id = ? AND buyer_id = ?',
      [req.params.id, user_id]
    );
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
    res.json(order);
  });

  // ── Payment confirmed emails (called by webhook + GSheet polling) ──
  function sendPaymentConfirmedEmails(orderId) {
    try {
      const orderInfo = db.get(`
        SELECT o.amount, p.title AS product_title,
               u.first_name, u.last_name, u.email AS buyer_email
        FROM orders o
        JOIN products p ON p.id = o.product_id
        JOIN users u ON u.id = o.buyer_id
        WHERE o.id = ?
      `, [orderId]);
      if (!orderInfo) return;

      const amtFmt = Number(orderInfo.amount).toLocaleString('vi-VN') + 'đ';

      // Email to buyer
      sendEmail({
        to: orderInfo.buyer_email,
        subject: '✅ Thanh toán thành công — cảm ơn bạn!',
        html: emailWrap('Thanh toán thành công!', `
          <p>Xin chào <strong>${orderInfo.first_name}</strong>,</p>
          <p>Chúng tôi đã xác nhận nhận được thanh toán của bạn. Cảm ơn bạn rất nhiều! 🎉</p>
          <div class="rule">
            🛍️ Sản phẩm: <strong>${orderInfo.product_title}</strong><br>
            💰 Số tiền: <strong>${amtFmt}</strong><br>
            📦 Trạng thái: <span class="green">Đã xác nhận</span>
          </div>
          <p>Người bán sẽ liên hệ với bạn trong vòng <strong>24 giờ</strong> để hướng dẫn nhận sản phẩm.</p>
          <a class="btn" href="${SITE_URL}/feed.html">Về trang cộng đồng</a>
        `)
      });

      // Notification email to admin
      sendEmail({
        to: ADMIN_EMAIL,
        subject: `💰 Đơn hàng #${orderId} đã được thanh toán`,
        html: emailWrap(`Đơn hàng #${orderId} hoàn tất`, `
          <p>Đơn hàng mới vừa được xác nhận thanh toán:</p>
          <div class="rule">
            📦 Sản phẩm: <strong>${orderInfo.product_title}</strong><br>
            👤 Người mua: <strong>${orderInfo.first_name} ${orderInfo.last_name}</strong> (${orderInfo.buyer_email})<br>
            💰 Số tiền: <strong>${amtFmt}</strong><br>
            🆔 Đơn hàng: #${orderId}
          </div>
          <a class="btn" href="${SITE_URL}/admin.html">Xem trong Admin Panel</a>
        `)
      });
    } catch (err) {
      console.error('[Email] sendPaymentConfirmedEmails error:', err.message);
    }
  }

  // ── SePay webhook ──────────────────────────────────────────
  app.post('/api/webhook/sepay', (req, res) => {
    const apikey = req.headers['apikey'] || req.headers['x-api-key'] || req.body?.apikey;
    if (apikey !== SEPAY_KEY) {
      console.warn('SePay webhook: unauthorized request');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { content, transferAmount, transferType } = req.body;
    console.log(`SePay webhook received: type=${transferType} amount=${transferAmount} content="${content}"`);

    if (transferType !== 'in') return res.json({ success: true });

    // Parse "{PREFIX} {product_id} {buyer_id}" from nội dung chuyển khoản
    const match = String(content || '').match(new RegExp(SEPAY_MEMO_PREFIX + '\\s+(\\d+)\\s+(\\d+)', 'i'));
    if (!match) {
      console.log('SePay: content không khớp định dạng memo');
      return res.json({ success: false, message: 'Nội dung không khớp.' });
    }

    const productId = parseInt(match[1]);
    const buyerId   = parseInt(match[2]);

    const order = db.get(`
      SELECT o.id, o.amount FROM orders o
      WHERE o.product_id = ? AND o.buyer_id = ? AND o.status = 'pending'
      ORDER BY o.created_at DESC LIMIT 1
    `, [productId, buyerId]);

    if (!order) {
      console.log(`SePay: không tìm thấy đơn pending — product=${productId} buyer=${buyerId}`);
      return res.json({ success: false, message: 'Không tìm thấy đơn hàng pending.' });
    }

    if (transferAmount < order.amount) {
      console.log(`SePay: số tiền không đủ — nhận ${transferAmount}, cần ${order.amount}`);
      return res.json({ success: false, message: `Số tiền không đủ.` });
    }

    db.run('UPDATE orders SET status = ? WHERE id = ?', ['completed', order.id]);
    db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [productId]);
    autoEnrollFromProductPurchase(productId, buyerId);
    console.log(`✅ SePay: Order #${order.id} completed — ${transferAmount}₫`);
    res.json({ success: true });

    sendPaymentConfirmedEmails(order.id);
  });

  // ── Google Sheet polling (auto-confirm khi SePay ghi vào Sheet) ──
  const processedRows = new Set();

  async function pollGoogleSheet() {
    try {
      const csv = await fetchText(
        `https://docs.google.com/spreadsheets/d/${GSHEET_ID}/export?format=csv&gid=0`
      );
      const lines = csv.split('\n').filter(l => l.trim());
      if (lines.length < 2) return; // Chỉ có header, chưa có dữ liệu

      for (let i = 1; i < lines.length; i++) {
        const rowKey = lines[i].trim();
        if (!rowKey || processedRows.has(rowKey)) continue;

        const cells  = parseCSVRow(lines[i]);
        const rowStr = cells.join(' ');

        // Tìm pattern {PREFIX} {product_id} {buyer_id} trong bất kỳ cột nào
        const match = rowStr.match(new RegExp(SEPAY_MEMO_PREFIX + '[\\s_]+(\\d+)[\\s_]+(\\d+)', 'i'));
        if (!match) { processedRows.add(rowKey); continue; }

        const [, productId, buyerId] = match;

        // Tìm số tiền lớn nhất trong dòng (lọc ra các số > 1000)
        let amount = 0;
        for (const cell of cells) {
          const n = parseFloat(cell.replace(/[^\d]/g, ''));
          if (n > 1000 && n > amount) amount = n;
        }

        const order = db.get(`
          SELECT o.id, o.amount FROM orders o
          WHERE o.product_id = ? AND o.buyer_id = ? AND o.status = 'pending'
          ORDER BY o.created_at DESC LIMIT 1
        `, [productId, buyerId]);

        processedRows.add(rowKey);
        if (!order) continue;
        if (amount > 0 && amount < order.amount) {
          console.log(`⚠️  GSheet: Số tiền không đủ — nhận ${amount}, cần ${order.amount}`);
          continue;
        }

        db.run('UPDATE orders SET status = ? WHERE id = ?', ['completed', order.id]);
        db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [productId]);
        autoEnrollFromProductPurchase(Number(productId), Number(buyerId));
        console.log(`✅ GSheet: Đơn #${order.id} xác nhận tự động (${amount}₫)`);
        sendPaymentConfirmedEmails(order.id);
      }
    } catch (_) { /* silent — sheet chưa public hoặc mất mạng */ }
  }

  // Poll mỗi 5 giây
  setInterval(pollGoogleSheet, 5000);

  // ── Abandoned cart drip emails (1d / 2d / 4d) ──────────────
  setInterval(() => {
    const now = Date.now();
    const pending = db.all(`
      SELECT o.id, o.product_id, o.buyer_id, o.amount, o.created_at,
             o.mail_1d, o.mail_2d, o.mail_4d,
             p.title AS product_title,
             u.first_name, u.last_name, u.email
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users u ON u.id = o.buyer_id
      WHERE o.status = 'pending'
    `);
    for (const row of pending) {
      const age = now - new Date(row.created_at).getTime();
      const D1 = 24 * 3600 * 1000;
      const amtFmt = Number(row.amount).toLocaleString('vi-VN') + 'đ';
      const qrUrl = `https://qr.sepay.vn/img?bank=BIDV&acc=96247NGUYEN&template=compact&amount=${row.amount}&des=${SEPAY_MEMO_PREFIX}%20${row.product_id}%20${row.buyer_id}`;

      const drips = [
        { flag: 'mail_1d', col: 'mail_1d', min: D1,     max: 2 * D1, day: 1,
          subject: '🛒 Bạn còn quên gì không? Đơn hàng chưa được thanh toán',
          intro: 'Hôm qua bạn đã đặt hàng nhưng chưa hoàn tất thanh toán.' },
        { flag: 'mail_2d', col: 'mail_2d', min: 2 * D1, max: 4 * D1, day: 2,
          subject: '⚠️ Nhắc lần 2: Đơn hàng sắp hết hạn',
          intro: '2 ngày trước bạn đã đặt hàng nhưng chưa thanh toán. Đơn sẽ hết hạn sau 2 ngày nữa.' },
        { flag: 'mail_4d', col: 'mail_4d', min: 4 * D1, max: Infinity, day: 4,
          subject: '🔔 Cơ hội cuối cùng — Đơn hàng sẽ bị hủy hôm nay',
          intro: 'Đây là email nhắc nhở cuối cùng. Nếu không thanh toán, đơn hàng sẽ tự động bị hủy.' },
      ];

      for (const drip of drips) {
        if (age >= drip.min && age < drip.max && !row[drip.flag]) {
          db.run(`UPDATE orders SET ${drip.col} = 1 WHERE id = ?`, [row.id]);
          sendEmail({
            to: row.email,
            subject: drip.subject,
            html: emailWrap('Đơn hàng chưa thanh toán', `
              <p>Xin chào <strong>${row.first_name}</strong>,</p>
              <p>${drip.intro}</p>
              <div class="rule">
                🛍️ <strong>${row.product_title}</strong><br>
                💰 Số tiền: <strong>${amtFmt}</strong>
              </div>
              <p>Chuyển khoản để hoàn tất:</p>
              <div class="rule">
                🏦 <strong>BIDV</strong> — STK: <strong>96247NGUYEN</strong><br>
                Chủ TK: <strong>TỪ CHÍ NGUYỆN</strong><br>
                Số tiền: <strong>${amtFmt}</strong><br>
                Nội dung: <strong>${SEPAY_MEMO_PREFIX} ${row.product_id} ${row.buyer_id}</strong>
              </div>
              <p><img src="${qrUrl}" alt="QR" style="width:160px;border-radius:8px;border:1px solid #e2e8f0"></p>
              <a class="btn" href="${SITE_URL}/checkout.html?id=${row.product_id}">Hoàn tất thanh toán</a>
            `)
          });
        }
      }
    }
  }, 30 * 60 * 1000); // check every 30 min

  // ── Late submission reminder cron (every hour) ──────────────
  setInterval(async () => {
    const lrSetting = db.get("SELECT value FROM site_settings WHERE key='late_reminder_enabled'");
    if (!lrSetting || lrSetting.value !== '1') return;

    const DAY_MS = 24 * 3600 * 1000;
    const now = Date.now();
    // Find all active enrollments
    const enrollments = db.all(
      "SELECT e.*, u.email, u.first_name, c.title AS challenge_title FROM challenge_enrollments e JOIN users u ON u.id = e.user_id JOIN challenges c ON c.id = e.challenge_id WHERE e.status = 'approved' AND e.started_at IS NOT NULL"
    );
    for (const e of enrollments) {
      const startMs = new Date(e.started_at).getTime();
      // Get all days for this challenge
      const days = db.all('SELECT * FROM challenge_days WHERE challenge_id = ? ORDER BY day_number', [e.challenge_id]);
      for (const day of days) {
        const closeMs = startMs + day.day_number * DAY_MS;
        // Only process days whose deadline has passed
        if (now <= closeMs) continue;
        // Check if already submitted
        const sub = db.get(
          "SELECT id FROM challenge_submissions WHERE user_id = ? AND day_id = ? AND status != 'rejected'",
          [e.user_id, day.id]
        );
        if (sub) continue; // already submitted (pending/approved/revision)
        // Check if we already sent a reminder today
        const reminder = db.get('SELECT * FROM late_reminders WHERE user_id = ? AND day_id = ?', [e.user_id, day.id]);
        const lastSentMs = reminder ? new Date(reminder.last_sent_at).getTime() : 0;
        const hoursSinceLast = (now - lastSentMs) / (3600 * 1000);
        if (reminder && hoursSinceLast < 20) continue; // send at most once per ~day
        // Compose email
        const isFirst = !reminder;
        const subject = isFirst
          ? `⚠️ Ngày ${day.day_number} thử thách chưa hoàn thành — ${e.challenge_title}`
          : `🔔 Nhắc nhở: Ngày ${day.day_number} vẫn đang chờ bạn nộp bài`;
        const bodyIntro = isFirst
          ? `<p>Xin chào <strong>${e.first_name}</strong>,</p>
             <p>Thử thách ngày thứ <strong>${day.day_number}</strong> đã hết hạn mà chưa thấy bài nộp từ bạn. Mặc dù thử thách <strong>không còn được tính là hoàn thành đúng hạn</strong>, bạn <strong>vẫn phải nộp bài</strong> để mở khóa ngày tiếp theo.</p>`
          : `<p>Xin chào <strong>${e.first_name}</strong>,</p>
             <p>Bạn vẫn chưa nộp bài ngày thứ <strong>${day.day_number}</strong>. Hãy hoàn thành để tiếp tục hành trình nhé!</p>`;
        await sendEmail({
          to: e.email,
          subject,
          html: emailWrap(isFirst ? 'Thử thách chưa hoàn thành đúng hạn' : 'Nhắc nhở nộp bài', `
            ${bodyIntro}
            <div class="rule">
              📅 <strong>${e.challenge_title}</strong><br>
              Ngày ${day.day_number}: <strong>${day.title}</strong>
            </div>
            <p>Dù trễ hạn, bài nộp của bạn vẫn được chấp nhận. Ngày tiếp theo sẽ mở sau khi bài được duyệt.</p>
            <a class="btn" href="${SITE_URL}/challenge-day-detail.html?challenge_id=${e.challenge_id}&day_id=${day.id}">Nộp bài ngay</a>
          `)
        });
        // Update late_reminders table
        if (reminder) {
          db.run(
            "UPDATE late_reminders SET last_sent_at = datetime('now','localtime'), sent_count = sent_count + 1 WHERE id = ?",
            [reminder.id]
          );
        } else {
          db.run(
            'INSERT INTO late_reminders (user_id, challenge_id, day_id) VALUES (?,?,?)',
            [e.user_id, e.challenge_id, day.id]
          );
        }
      }
    }
  }, 60 * 60 * 1000); // check every hour

  // ── Agent 2: daily meal-log reminder (Telegram push) ─────────
  // Nudges users who've linked Telegram but haven't logged today's meals yet,
  // once the evening cutoff has passed. Mirrors the late_reminders cadence
  // pattern above but via meal_log_reminders (max 1 send/day/user).
  const MEAL_REMINDER_MESSAGES = [
    '🍽️ Hôm nay bạn đã ghi nhật ký ăn uống chưa? Đừng để bụng đói mà quên luôn nha!',
    '👋 Ghé qua ghi lại bữa ăn hôm nay nhé — vài giây thôi mà mình theo dõi sức khỏe bạn tốt hơn nhiều đó!',
    '🌿 Nhắc nhẹ: nhật ký ăn uống hôm nay vẫn đang chờ bạn ghi lại nè.',
  ];
  setInterval(async () => {
    if (!TELEGRAM_BOT_TOKEN) return;
    const now = new Date();
    if (now.getHours() < 20) return; // only nudge from 20:00 local onward
    const today = now.toISOString().slice(0, 10);

    const candidates = db.all(
      `SELECT id, first_name FROM users
       WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
         AND id NOT IN (SELECT user_id FROM meal_logs WHERE log_date = ?)`,
      [today]
    );
    for (const u of candidates) {
      const already = db.get('SELECT id FROM meal_log_reminders WHERE user_id = ? AND reminder_date = ?', [u.id, today]);
      if (already) continue;
      const user = db.get('SELECT telegram_chat_id FROM users WHERE id = ?', [u.id]);
      const text = MEAL_REMINDER_MESSAGES[Math.floor(Math.random() * MEAL_REMINDER_MESSAGES.length)];
      await sendTelegramMessage(user.telegram_chat_id, text);
      db.run('INSERT INTO meal_log_reminders (user_id, reminder_date) VALUES (?,?)', [u.id, today]);
    }
  }, 60 * 60 * 1000); // check every hour

  // ── CRM ────────────────────────────────────────────────────
  // Seed default email templates on first run
  function seedEmailTemplates() {
    const existing = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    if (existing) return;
    const defaults = [
      { id:1, name:'Email chào mừng', subject:`Chào mừng đến với ${COMMUNITY_NAME}! 🎉`, category:'welcome',
        body:`<h2>Chào mừng {{first_name}} đến với ${COMMUNITY_NAME}! 🎉</h2>
<p>Bạn đã chính thức gia nhập cộng đồng <strong>${COMMUNITY_NAME}</strong> — nơi mọi người cùng học cách ăn uống theo Ngũ Hành để thanh lọc và cân bằng cơ thể.</p>
<p><strong>Bắt đầu ngay:</strong></p>
<ul>
  <li>🔥 <a href="${SITE_URL}/challenge.html">Đăng ký Thử thách 28 ngày</a></li>
  <li>💬 <a href="${SITE_URL}/feed.html">Chia sẻ bài đầu tiên trên Bảng tin</a></li>
  <li>🛍️ <a href="${SITE_URL}/marketplace.html">Khám phá Chợ combo & tài liệu</a></li>
</ul>
<p>Hẹn gặp bạn trong cộng đồng!<br><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-01' },
      { id:2, name:'Xác nhận đăng ký thử thách', subject:'Bạn đã đăng ký Thử thách 28 ngày! 🔥', category:'challenge',
        body:`<h2>Bạn đã đăng ký Thử thách 28 ngày! 🔥</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Chúc mừng! Bạn đã chính thức đăng ký <strong>Thử thách 28 Ngày</strong>.</p>
<p>📅 Bắt đầu: <strong>{{start_date}}</strong><br>
✅ Mỗi ngày hoàn thành 1 nhiệm vụ<br>
⭐ Nhận XP và phần thưởng khi hoàn thành</p>
<p><a href="${SITE_URL}/challenge.html">Xem chi tiết thử thách →</a></p>
<p>Chúng tôi sẽ gửi nhắc nhở mỗi ngày lúc 19:00.<br><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-05' },
      { id:3, name:'Nhắc nhở hoàn thành ngày', subject:'Đừng quên nhiệm vụ hôm nay — Ngày {{day_number}} 📅', category:'reminder',
        body:`<h2>Đừng quên nhiệm vụ hôm nay! 📅</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Hôm nay là <strong>Ngày {{day_number}}</strong> trong hành trình 28 ngày của bạn.</p>
<p>🎯 Nhiệm vụ: <strong>{{task_title}}</strong></p>
<p>Hoàn thành trước nửa đêm để không mất streak!<br>Streak hiện tại: 🔥 <strong>{{streak}} ngày</strong></p>
<p><a href="${SITE_URL}/challenge.html">Hoàn thành ngay →</a></p>
<p><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-10' },
      { id:4, name:'Chúc mừng hoàn thành 28 ngày', subject:'🏆 Bạn đã hoàn thành Thử thách 28 ngày!', category:'completion',
        body:`<h2>🏆 Bạn đã chinh phục 28 ngày!</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Bạn đã hoàn thành <strong>Thử thách 28 Ngày</strong>! Chỉ có <strong>{{completion_pct}}%</strong> người đăng ký đạt được điều này.</p>
<p>🌟 +{{xp_earned}} XP<br>🏆 Huy hiệu "Streak Master"<br>🎁 Giảm 20% cho khoá học nâng cao</p>
<p><a href="${SITE_URL}/leaderboard.html">Xem bảng xếp hạng →</a></p>
<p><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-15' },
      { id:5, name:'Giới thiệu sản phẩm — Email 1', subject:'Khám phá combo Dưỡng Hóa 🌿', category:'sales',
        body:`<h2>Khám phá combo Dưỡng Hóa 🌿</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Bộ tài liệu <strong>{{product_name}}</strong> giúp bạn bắt đầu hành trình ăn uống cân bằng ngay hôm nay.</p>
<p><strong>Bao gồm:</strong></p>
<ul>
  <li>{{feature_1}}</li>
  <li>{{feature_2}}</li>
  <li>{{feature_3}}</li>
</ul>
<p>Giá: <strong>{{price}}</strong> — Hoàn tiền 7 ngày nếu không hài lòng.</p>
<p><a href="${SITE_URL}/marketplace.html">Xem chi tiết →</a></p>
<p><strong>Ban điều hành</strong></p>`, updated_at:'2025-05-01' },
      { id:6, name:'Bán hàng — Social Proof', subject:'Cộng đồng nói gì về sản phẩm này? 💬', category:'sales',
        body:`<h2>Cộng đồng nói gì? 💬</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Sau khi ra mắt <strong>{{product_name}}</strong>, chúng tôi nhận được rất nhiều phản hồi tích cực:</p>
<blockquote>"{{testimonial_1}}" — <strong>{{user_1}}</strong></blockquote>
<blockquote>"{{testimonial_2}}" — <strong>{{user_2}}</strong></blockquote>
<p><a href="${SITE_URL}/marketplace.html">Mua ngay →</a></p>`, updated_at:'2025-05-02' },
      { id:7, name:'Bán hàng — Last Chance', subject:'⏰ Còn 24 giờ — Ưu đãi sắp kết thúc!', category:'sales',
        body:`<h2>⏰ Còn 24 giờ!</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Chương trình ưu đãi cho <strong>{{product_name}}</strong> kết thúc lúc 23:59 ngày <strong>{{deadline}}</strong>.</p>
<p style="text-align:center;font-size:28px;font-weight:bold;color:#ef4444">{{discount_pct}}% OFF</p>
<p>Còn {{hours_left}} giờ — {{spots_left}} suất cuối cùng.</p>
<p><a href="${SITE_URL}/marketplace.html">Mua ngay →</a></p>`, updated_at:'2025-05-03' },
      { id:8, name:'Tái kích hoạt — Nhớ bạn', subject:'Chúng tôi nhớ bạn! Có nhiều điều mới 👋', category:'reengagement',
        body:`<h2>Chúng tôi nhớ bạn! 👋</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Đã {{days_inactive}} ngày kể từ lần cuối bạn ghé ${COMMUNITY_NAME}. Cộng đồng có nhiều điều mới:</p>
<ul>
  <li>🔥 Thử thách mới: <strong>{{new_challenge}}</strong></li>
  <li>💬 {{new_posts}} bài đăng từ cộng đồng</li>
  <li>🛍️ {{new_products}} sản phẩm mới tại Chợ</li>
</ul>
<p><a href="${SITE_URL}/feed.html">Quay lại cộng đồng →</a></p>`, updated_at:'2025-05-10' },
      { id:9, name:'Tái kích hoạt — Phần thưởng', subject:'🎁 Phần thưởng đặc biệt dành riêng cho bạn', category:'reengagement',
        body:`<h2>🎁 Phần thưởng đặc biệt!</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Để chào đón bạn quay lại, chúng tôi tặng:</p>
<p style="text-align:center;font-size:32px;font-weight:bold;color:#8b5cf6">+50 XP</p>
<p>Bonus khi hoàn thành nhiệm vụ đầu tiên sau khi quay lại. Có hiệu lực trong 7 ngày.</p>
<p><a href="${SITE_URL}/challenge.html">Nhận phần thưởng →</a></p>`, updated_at:'2025-05-10' },
      { id:10, name:'Newsletter hàng tuần', subject:`Tổng hợp tuần tại ${COMMUNITY_NAME} — {{week}}`, category:'newsletter',
        body:`<h2>📰 Tổng hợp tuần {{week}}</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p><strong>Bài nổi bật tuần này:</strong></p>
<p>📌 <strong>{{post_1_title}}</strong><br>{{post_1_excerpt}}</p>
<p>📌 <strong>{{post_2_title}}</strong><br>{{post_2_excerpt}}</p>
<p><a href="${SITE_URL}/feed.html">Xem thêm →</a></p>`, updated_at:'2025-05-20' },
      { id:11, name:'Thông báo sản phẩm mới', subject:'🚀 Ra mắt: {{product_name}} — Xem ngay!', category:'sales',
        body:`<h2>🚀 Ra mắt: {{product_name}}</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Chúng tôi vừa ra mắt <strong>{{product_name}}</strong> — được thiết kế đặc biệt cho ${COMMUNITY_NAME}.</p>
<p style="text-align:center;font-size:28px;font-weight:bold;color:#10b981">{{launch_price}}</p>
<p><strike>{{regular_price}}</strike> — Ưu đãi kết thúc sau {{launch_hours}} giờ.</p>
<p><a href="${SITE_URL}/marketplace.html">Xem & mua ngay →</a></p>`, updated_at:'2025-05-22' },
      { id:12, name:'Nhắc nhở hoàn thiện hồ sơ', subject:'Hồ sơ chưa hoàn chỉnh — cập nhật ngay', category:'reminder',
        body:`<h2>Hồ sơ chưa hoàn chỉnh 📋</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Hồ sơ đầy đủ giúp bạn được cộng đồng tin tưởng hơn.</p>
<p><strong>Còn thiếu:</strong></p>
<ul>
  <li>📷 Ảnh đại diện</li>
  <li>📝 Bio / Giới thiệu bản thân</li>
  <li>🌐 Website / LinkedIn</li>
</ul>
<p>Chỉ mất 2 phút!</p>
<p><a href="${SITE_URL}/profile.html">Cập nhật hồ sơ →</a></p>`, updated_at:'2025-05-23' },
    ];
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(defaults)]);
    console.log('✅ Seeded 12 email templates');
  }
  seedEmailTemplates();

  app.get('/api/admin/crm/stats', requireAdmin, (_req, res) => {
    const totalUsers   = db.get("SELECT COUNT(*) as n FROM users WHERE status='active'").n;
    const googleUsers  = db.get("SELECT COUNT(*) as n FROM users WHERE google_id IS NOT NULL").n;
    const emailUsers   = db.get("SELECT COUNT(*) as n FROM users WHERE password_hash IS NOT NULL").n;
    const enrolled     = db.get("SELECT COUNT(DISTINCT user_id) as n FROM challenge_enrollments WHERE status='approved'").n;
    const buyers       = db.get("SELECT COUNT(DISTINCT buyer_id) as n FROM orders WHERE status='completed'").n;
    const submitted    = db.get("SELECT COUNT(DISTINCT user_id) as n FROM challenge_submissions").n;
    const notifSent    = db.get("SELECT COUNT(*) as n FROM notifications WHERE sent_by_admin=1").n;
    const remindersSent= db.get("SELECT COUNT(*) as n FROM late_reminders").n;
    const orderMails   = db.get("SELECT COALESCE(SUM(mail_15m+mail_1d+mail_2d+mail_4d),0) as n FROM orders").n;
    const emailsSent   = notifSent + remindersSent + orderMails;

    res.json({
      active_contacts: totalUsers,
      emails_sent: emailsSent,
      lists: [
        { id:1, name:'Tất cả thành viên (active)', desc:'Toàn bộ tài khoản đang hoạt động', count:totalUsers, tag:'all' },
        { id:2, name:'Đăng nhập Google', desc:'Tài khoản liên kết Google OAuth', count:googleUsers, tag:'google' },
        { id:3, name:'Đăng nhập Email/Password', desc:'Tài khoản đăng ký bằng email', count:emailUsers, tag:'email' },
        { id:4, name:'Tham gia thử thách', desc:'Đã được duyệt tham gia ít nhất 1 thử thách', count:enrolled, tag:'challenge' },
        { id:5, name:'Đã nộp bài', desc:'Đã nộp ít nhất 1 bài trong thử thách', count:submitted, tag:'submitted' },
        { id:6, name:'Đã mua sản phẩm', desc:'Có ít nhất 1 đơn hàng hoàn thành', count:buyers, tag:'buyer' },
      ],
      tags: [
        { name:'google-user',         count:googleUsers,   color:'#4285f4' },
        { name:'email-user',          count:emailUsers,    color:'#0ea5e9' },
        { name:'challenge-enrolled',  count:enrolled,      color:'#f59e0b' },
        { name:'submitted-work',      count:submitted,     color:'#10b981' },
        { name:'buyer',               count:buyers,        color:'#ec4899' },
        { name:'received-reminder',   count:remindersSent, color:'#8b5cf6' },
      ],
      sequences: [
        { id:1, name:'Chào mừng thành viên mới',     trigger:'Khi đăng ký tài khoản',             icon:'👋', color:'#dbeafe', emails:1, sent:totalUsers,    status:'active' },
        { id:2, name:'Xác nhận đăng ký thử thách',   trigger:'Khi đăng ký challenge được duyệt',   icon:'🔥', color:'#fef3c7', emails:1, sent:enrolled,     status:'active' },
        { id:3, name:'Nhắc nhở hoàn thành ngày',     trigger:'Mỗi giờ (scheduler)',                icon:'⏰', color:'#d1fae5', emails:1, sent:remindersSent, status: (db.get("SELECT value FROM site_settings WHERE key='late_reminder_enabled'") || {}).value === '1' ? 'active' : 'paused', toggleable: true },
        { id:4, name:'Email theo dõi đơn hàng',      trigger:'Sau mua: 15 phút / 1 ngày / 2 ngày / 4 ngày', icon:'📦', color:'#fce7f3', emails:4, sent:orderMails, status:'active' },
        { id:5, name:'Thông báo admin (broadcast)',  trigger:'Thủ công từ admin panel',             icon:'📢', color:'#ede9fe', emails:1, sent:notifSent,     status:'active' },
      ],
    });
  });

  app.get('/api/admin/crm/templates', requireAdmin, (_req, res) => {
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    res.json(tpls);
  });

  app.post('/api/admin/crm/templates', requireAdmin, (req, res) => {
    const { name, subject, category, body } = req.body;
    if (!name || !subject) return res.status(400).json({ error: 'Thiếu tên và subject.' });
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    const maxId = tpls.reduce((m, t) => Math.max(m, t.id || 0), 0);
    const tpl = { id: maxId + 1, name, subject, category: category || 'other', body: body || '', updated_at: new Date().toISOString().slice(0,10) };
    tpls.push(tpl);
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(tpls)]);
    res.json({ ok: true, template: tpl });
  });

  app.patch('/api/admin/crm/templates/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { name, subject, category, body } = req.body;
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    const idx = tpls.findIndex(t => t.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Template không tồn tại.' });
    tpls[idx] = { ...tpls[idx], name, subject, category, body, updated_at: new Date().toISOString().slice(0,10) };
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(tpls)]);
    res.json({ ok: true, template: tpls[idx] });
  });

  app.delete('/api/admin/crm/templates/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    tpls = tpls.filter(t => t.id !== id);
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(tpls)]);
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════════════════════
  // TRỢ LÝ NGŨ HÀNH — hỏi đáp ăn uống dưỡng sinh
  // ══════════════════════════════════════════════════════════
  // Tính năng AI thứ 3 (cạnh chấm bài tập + chatbot intake), dùng chung callAiChat().
  // Không streaming, không RAG — kho kiến thức nhỏ, nhồi thẳng vào system prompt mỗi request.

  const ASSISTANT_SYSTEM = `Bạn là "Trợ lý Ngũ Hành" của cộng đồng Ăn Uống Ngũ Hành — đồng hành cùng thành viên trong việc ăn uống dưỡng sinh theo Âm Dương Ngũ Hành (ngũ sắc – ngũ vị – tạng phủ – mùa – khung giờ).

NHIỆM VỤ: trả lời các câu hỏi thực tế về ăn uống hằng ngày, ví dụ:
- "Vị chua thì nên ăn gì?" → gợi ý thực phẩm/món theo vị + hành + tạng, và NÊN ĂN VÀO BUỔI NÀO.
- "Sáng nay nên ăn món gì?" → dựa vào quy trình 3 buổi + thể trạng của họ.
- "Tôi có bí đỏ, nên nấu món gì và ăn khi nào?" → từ nguyên liệu họ có, gợi ý cách chế biến theo Ngũ Hành + thời điểm ăn hợp lý.

NGUYÊN TẮC BẮT BUỘC:
• Toàn bộ trả lời bằng tiếng Việt, xưng "mình/bạn", ấm áp như người bạn am hiểu — không phải bác sĩ hay cỗ máy.
• Chỉ trả lời trong phạm vi ăn uống – dưỡng sinh – Ngũ Hành. Câu hỏi ngoài phạm vi (thời tiết, chính trị, lập trình, chuyện phiếm...) → lịch sự từ chối và kéo về chủ đề ăn uống.
• Khi gợi ý món/thực phẩm, LUÔN kèm "ăn vào buổi nào / khung giờ nào" và lý do ngắn gọn theo Ngũ Hành (vị → hành → tạng).
• Ưu tiên gợi ý các thực phẩm và công thức có trong KHO bên dưới. Được phép bổ sung kiến thức Ngũ Hành phổ thông, nhưng không bịa ra công thức phức tạp thiếu căn cứ.
• Nếu có "Hồ sơ dưỡng sinh" hoặc nhật ký ăn uống của thành viên, hãy cá nhân hoá lời khuyên (thiên hàn/nhiệt, tạng cần chú ý, vị/màu đang thiếu).
• TUYỆT ĐỐI KHÔNG chẩn đoán bệnh hay kê đơn thuốc. Đây là hướng dẫn ăn uống dưỡng sinh, không thay thế việc khám chữa bệnh.
• Nếu người dùng mô tả triệu chứng nặng (đau dữ dội, chảy máu, khó thở, sụt cân nhanh, ho ra máu...) → khuyên đi khám bác sĩ ngay, không tư vấn ăn uống thay thế.
• Trả lời gọn, đi thẳng vào việc: 3–8 câu hoặc một danh sách ngắn. Không lan man.
• Khi phù hợp, kết thúc bằng 1 câu nhắc nhẹ: đây là gợi ý dưỡng sinh, hãy lắng nghe cơ thể mình.`;

  const ASSISTANT_RULES = `

═══ QUY TẮC NGŨ HÀNH CỐT LÕI ═══
NGŨ VỊ → HÀNH → TẠNG → MÙA → MÀU:
• Chua → Mộc → Gan/Mật → Xuân → Xanh
• Đắng → Hỏa → Tim/Ruột non → Hạ → Đỏ
• Ngọt (đường tốt: mật mía, mật ong, nước mía) → Thổ → Tỳ/Vị → giao mùa → Vàng
• Cay → Kim → Phổi/Đại tràng → Thu → Trắng
• Mặn (vừa đủ) → Thủy → Thận/Bàng quang → Đông → Đen
• Chát → chống oxy hoá, giữ tươi trẻ (quả sung, chuối xanh, lựu, trà, vang chát)

TƯƠNG SINH: Mộc→Hỏa→Thổ→Kim→Thủy→Mộc (mẹ nuôi con).
TƯƠNG KHẮC: Mộc khắc Thổ, Thổ khắc Thủy, Thủy khắc Hỏa, Hỏa khắc Kim, Kim khắc Mộc.
VỊ QUÁ NHIỀU HẠI TẠNG BỊ KHẮC: cay quá hại Gan, mặn quá hại Tim, chua quá hại Tỳ, đắng quá hại Phổi, ngọt quá hại Thận. Luôn cân bằng — VD dùng vị chua thì thêm chút vị ngọt tốt để không xót bao tử.

HÀN – NHIỆT:
• Thể hàn (tay chân lạnh, sợ lạnh, thích nước ấm, nhịp tim thấp) → ăn món tính ấm/nhiệt, vị cay ấm: gừng, sả, tỏi, tiêu, quế. Tránh đồ sống lạnh.
• Thể nhiệt (nóng trong, sợ nóng, hay khát, nhịp tim/huyết áp cao) → ăn món tính mát/hàn, vị đắng hàn: tim sen, rau má, khổ qua, cháo bổ âm. Hạn chế cay nóng, chiên rán.
• Cay chia 2: cay nhiệt (gừng, tỏi, tiêu, quế — làm ấm) vs cay hàn (bạc hà, húng chanh — mát).
• Đắng chia 2: đắng nhiệt (cà phê, cacao — tăng nhịp tim, hợp huyết áp thấp) vs đắng hàn (tim sen, khổ qua — hạ nhịp tim, hợp huyết áp cao).
• Nhìn màu đoán tính: rau quả màu nhạt phần nhiều hàn/mát; màu thẫm thường ấm/nóng.

NGUYÊN TẮC BỮA ĂN: đủ 5 màu + 5 vị; không đủ cả thì ưu tiên VỊ. Nhai kỹ ("ăn như uống"). Ăn theo mùa — tăng cường vị/màu của Hành ứng với mùa hiện tại.`;

  // PROTOCOL_SOP là HTML — chuyển sang text thuần cho prompt
  function protocolToText(html) {
    return html
      .replace(/<\/(tr|h3|blockquote|table|thead|tbody)>/g, '\n')
      .replace(/<\/(td|th)>/g, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }
  const ASSISTANT_PROTOCOL = `

═══ QUY TRÌNH 1 NGÀY 3 BUỔI (khung giờ chuẩn của chương trình) ═══
${protocolToText(PROTOCOL_SOP)}`;

  // Cổng truy cập: admin, hoặc đã ghi danh challenge, hoặc đã có đơn hàng hoàn tất
  function hasProgramAccess(userId) {
    if (!userId) return false;
    const u = db.get('SELECT is_admin FROM users WHERE id = ?', [userId]);
    if (!u) return false;
    if (u.is_admin) return true;
    const enr = db.get(
      "SELECT 1 FROM challenge_enrollments WHERE user_id = ? AND status IN ('approved','started') LIMIT 1",
      [userId]
    );
    if (enr) return true;
    return !!db.get("SELECT 1 FROM orders WHERE buyer_id = ? AND status = 'completed' LIMIT 1", [userId]);
  }

  function assistantEnabled() {
    const row = db.get("SELECT value FROM site_settings WHERE key = 'assistant_enabled'");
    return !row || row.value !== '0';   // mặc định BẬT
  }
  function assistantDailyLimit() {
    const row = db.get("SELECT value FROM site_settings WHERE key = 'assistant_daily_limit'");
    const n = row ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 30;
  }
  function assistantUsageToday(userId) {
    const today = db.get("SELECT date('now','localtime') AS d").d;
    const row = db.get('SELECT count FROM assistant_usage WHERE user_id = ? AND usage_date = ?', [userId, today]);
    return row ? row.count : 0;
  }
  function bumpAssistantUsage(userId) {
    const today = db.get("SELECT date('now','localtime') AS d").d;
    db.run(
      `INSERT INTO assistant_usage (user_id, usage_date, count) VALUES (?,?,1)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET count = count + 1`,
      [userId, today]
    );
  }

  // Dựng khối kiến thức nền theo từng request
  function buildAssistantContext(userId) {
    const foods = db.all('SELECT name, element, color, taste, nature, organ, note FROM foods ORDER BY element, order_num, name');
    const foodLines = foods.map(f =>
      `- ${f.name} | hành ${f.element || '?'} | màu ${f.color || '?'} | vị ${f.taste || '?'} | tính ${f.nature || '?'} | tạng ${f.organ || '?'}${f.note ? ' — ' + f.note : ''}`
    ).join('\n');

    const recipes = db.all('SELECT title, element_tags, buoi, summary, ingredients, steps, dung_khi, note FROM recipes ORDER BY order_num, id');
    const recipeBlocks = recipes.map(r =>
      `### ${r.title}\n- Hành: ${r.element_tags || '?'} · Buổi: ${r.buoi || 'cả ngày'}\n- Tóm tắt: ${r.summary || ''}\n- Nguyên liệu: ${r.ingredients || ''}\n- Cách làm: ${r.steps || ''}\n- Dùng khi: ${r.dung_khi || ''}${r.note ? '\n- Lưu ý: ' + r.note : ''}`
    ).join('\n\n');

    let personal = '';
    const u = db.get('SELECT intake_profile FROM users WHERE id = ?', [userId]);
    if (u && u.intake_profile) {
      personal += `\n\n═══ HỒ SƠ DƯỠNG SINH CỦA THÀNH VIÊN NÀY ═══\n${u.intake_profile}`;
    }
    const logs = db.all(
      'SELECT log_date, colors, tastes, breakfast, lunch, dinner FROM meal_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 7',
      [userId]
    );
    if (logs.length) {
      const logLines = logs.map(l => {
        let colors = '—', tastes = '—';
        try { colors = (JSON.parse(l.colors || '[]') || []).join(', ') || '—'; } catch {}
        try { tastes = (JSON.parse(l.tastes || '[]') || []).join(', ') || '—'; } catch {}
        return `- ${l.log_date}: màu [${colors}], vị [${tastes}]${l.breakfast ? ' · sáng: ' + l.breakfast : ''}${l.lunch ? ' · trưa: ' + l.lunch : ''}${l.dinner ? ' · tối: ' + l.dinner : ''}`;
      }).join('\n');
      personal += `\n\n═══ NHẬT KÝ ĂN UỐNG 7 NGÀY GẦN NHẤT ═══\n${logLines}`;
    }

    return `\n\n═══ KHO THỰC PHẨM NGŨ HÀNH (${foods.length} món — ưu tiên gợi ý trong danh sách này) ═══\n${foodLines}\n\n═══ THƯ VIỆN CÔNG THỨC (${recipes.length} món) ═══\n${recipeBlocks}${personal}`;
  }

  app.post('/api/assistant/chat', async (req, res) => {
    const { user_id, messages } = req.body;
    if (!user_id || !Array.isArray(messages) || !messages.length)
      return res.status(400).json({ error: 'Thiếu user_id hoặc messages.' });

    const user = db.get('SELECT id, is_admin FROM users WHERE id = ?', [user_id]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    const isAdmin = !!user.is_admin;

    if (!assistantEnabled() && !isAdmin)
      return res.status(503).json({ error: 'Trợ lý Ngũ Hành đang tạm khoá. Quay lại sau nhé!' });

    if (!isAdmin && !hasProgramAccess(user_id))
      return res.status(403).json({ error: 'Trợ lý Ngũ Hành dành cho thành viên đã tham gia chương trình 28 ngày Dưỡng Hóa.' });

    const limit = assistantDailyLimit();
    if (!isAdmin && assistantUsageToday(user_id) >= limit)
      return res.status(429).json({ error: `Bạn đã dùng hết ${limit} lượt hỏi hôm nay. Hẹn gặp lại ngày mai nhé!`, remaining: 0 });

    // Giữ 12 lượt gần nhất để giới hạn token; toàn bộ kiến thức nằm ở system prompt
    const convo = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!convo.length || convo[convo.length - 1].role !== 'user')
      return res.status(400).json({ error: 'Chưa có câu hỏi.' });

    const systemContent = ASSISTANT_SYSTEM + ASSISTANT_RULES + ASSISTANT_PROTOCOL + buildAssistantContext(user_id);

    try {
      const result = await callAiChat({
        messages: [{ role: 'system', content: systemContent }, ...convo],
        maxTokens: 1200,
      });
      if (!result.ok) return res.status(503).json({ error: result.error || 'Trợ lý đang bận, thử lại sau nhé.' });

      const reply = (result.text || '').trim() || 'Mình chưa rõ ý bạn lắm, bạn nói cụ thể hơn được không?';

      if (!isAdmin) bumpAssistantUsage(user_id);
      const lastQ = [...convo].reverse().find(m => m.role === 'user');
      db.run('INSERT INTO assistant_logs (user_id, question, answer) VALUES (?,?,?)',
        [user_id, (lastQ ? lastQ.content : '').slice(0, 2000), reply.slice(0, 4000)]);

      const remaining = isAdmin ? null : Math.max(0, limit - assistantUsageToday(user_id));
      res.json({ reply, remaining });
    } catch (err) {
      console.error('[Assistant] Error:', err.message);
      res.status(500).json({ error: 'Lỗi server. Thử lại sau nhé.' });
    }
  });

  // ── Intake Chat ───────────────────────────────────────────
  const INTAKE_OPENING = `Điều gì về sức khỏe hoặc cơ thể đang khiến bạn chưa hài lòng nhất lúc này? Cứ nói thật — mệt mỏi, tiêu hóa, giấc ngủ, cân nặng, hay điều gì khác cũng được.`;

  const INTAKE_SYSTEM = `Bạn là người đồng hành cho "Thử thách 28 ngày Dưỡng Hóa – Mở Khóa Cơ Thể" — chương trình ăn uống theo Âm Dương Ngũ Hành (ngũ sắc – ngũ vị – tạng phủ – mùa) để thanh lọc, đào thải độc tố và cân bằng cơ thể một cách tự nhiên, không dùng thuốc.

Nhiệm vụ: Trò chuyện tự nhiên để hiểu thể trạng và mục tiêu của một người — họ đang gặp gì, thiên hàn hay nhiệt, tiêu hóa/giấc ngủ ra sao — rồi tổng hợp thành hồ sơ cá nhân hóa chỉ ra Hành nào cần BỔ, Hành nào cần TẢ, và họ nên chú ý điều gì trong 28 ngày.

═══ NGUYÊN TẮC BẮT BUỘC ═══
• Mỗi lượt CHỈ hỏi DUY NHẤT 1 câu — tuyệt đối không hỏi 2 câu cùng lúc
• Luôn phản chiếu điều họ vừa chia sẻ trước khi hỏi tiếp
• Giọng điệu: như người bạn quan tâm, không phải bác sĩ hay form khảo sát
• Câu trả lời mơ hồ → đào sâu tại chỗ
• Tổng cộng 8–11 lượt hỏi, không nhiều hơn
• Toàn bộ bằng tiếng Việt, xưng "mình/bạn"
• KHÔNG hỏi tên, email, thông tin cá nhân
• TUYỆT ĐỐI KHÔNG chẩn đoán bệnh hay kê đơn thuốc. Đây là hướng dẫn ăn uống dưỡng sinh, không thay thế khám chữa bệnh. Nếu người dùng mô tả triệu chứng nặng (đau dữ dội, chảy máu, sụt cân nhanh...) → khuyên đi khám bác sĩ.

═══ 5 CHẶNG KHÁM PHÁ ═══

CHẶNG 1 — VẤN ĐỀ CHÍNH (1–2 lượt)
Câu mở đầu đã gửi: hỏi điều họ chưa hài lòng về sức khỏe.
Đào sâu: nó ảnh hưởng cuộc sống hằng ngày thế nào, kéo dài bao lâu rồi.

CHẶNG 2 — THỂ TRẠNG HÀN / NHIỆT (2–3 lượt)
Hỏi các dấu hiệu để đoán họ thiên hàn hay nhiệt:
- Tay chân thường ấm hay lạnh? Sợ nóng hay sợ lạnh hơn?
- Hay khát nước, thích uống nước mát hay nước ấm?
- Da, môi, lưỡi: khô/đỏ hay nhợt/ẩm?
- Nếu có: chỉ số huyết áp / nhịp tim gần nhất họ nhớ.
Mục tiêu: kết luận thiên HÀN, thiên NHIỆT, hay tương đối cân bằng.

CHẶNG 3 — TIÊU HÓA & TẠNG PHỦ (2 lượt)
- Đi vệ sinh: đều không, phân thế nào (táo/lỏng/bình thường)?
- Ăn xong hay đầy bụng, ợ hơi, chậm tiêu không?
- Có hay: ho/nghẹt mũi (Phổi–Kim), cáu gắt/mỏi mắt (Gan–Mộc), hồi hộp/mất ngủ (Tim–Hỏa), đau lưng/tiểu đêm (Thận–Thủy), chán ăn/mệt mỏi (Tỳ–Thổ)?

CHẶNG 4 — THÓI QUEN ĂN UỐNG HIỆN TẠI (1–2 lượt)
- Một ngày ăn mấy bữa, hay bỏ bữa nào?
- Thường thiếu vị/màu nào (ít rau xanh? ít đồ chua? nhiều đồ ngọt/mặn?)
- Có ăn chay, dị ứng, hay kiêng gì không?

CHẶNG 5 — MỤC TIÊU & THỜI GIAN (1–2 lượt)
a) "Sau 28 ngày, bạn muốn thấy thay đổi rõ nhất ở đâu?" → trạng thái cụ thể
b) "Mỗi sáng bạn dậy được lúc mấy giờ, có thời gian cho quy trình buổi sáng (uống nước, vận động 30 phút) không?"

═══ KHI ĐỦ THÔNG TIN ═══
1. Viết 2–3 câu nhận xét chân thật, ấm áp về thể trạng của họ
2. Ngay sau đó xuất markdown profile theo đúng format dưới, bắt đầu ===PROFILE_START=== và kết thúc ===PROFILE_END===

===PROFILE_START===
# Hồ Sơ Dưỡng Sinh — Thành viên
*Tạo: [ngày/tháng/năm hôm nay]*

## Vấn đề chính
[1–2 câu — điều họ muốn cải thiện nhất]

## Thể trạng
**Xu hướng:** [Thiên Hàn / Thiên Nhiệt / Tương đối cân bằng] — [1 câu lý do dựa trên dấu hiệu họ kể]

## Tạng phủ cần chú ý
[Liệt kê 1–2 Hành/tạng nổi bật theo triệu chứng, VD: "Hành Mộc (Gan/Mật) — hay cáu gắt, mỏi mắt" · "Hành Thổ (Tỳ/Vị) — chậm tiêu, đầy bụng"]

## Định hướng Ngũ Hành 28 ngày
**Nên BỔ (tăng cường):** [Hành + vị + màu cụ thể, VD "Hành Thủy — vị mặn nhẹ, màu đen: mè đen, đậu đen, rong biển"]
**Nên TẢ / hạn chế:** [vị/món nên giảm, VD "giảm đồ ngọt tinh luyện, đồ chiên nóng"]
**Nếu thiên Hàn:** thêm vị cay ấm (gừng, sả, tỏi), tránh đồ sống lạnh
**Nếu thiên Nhiệt:** thêm vị đắng hàn (tim sen, rau má, khổ qua), cháo bổ âm

## Điều chỉnh quy trình 3 buổi
- **Sáng:** [gợi ý theo thể trạng]
- **Trưa:** [gợi ý]
- **Tối:** [gợi ý]
- **08:00–09:00 café/cacao vs trà tim sen:** [chọn theo huyết áp/nhịp tim họ kể, nếu không rõ → khuyên đo huyết áp tuần 1]

## Tuần cần chú ý nhất
[VD "Tuần 2 (Đào thải) — với người tiêu hóa yếu, uống trà thải độc liều nhẹ, theo dõi kỹ"]

## Lưu ý riêng
[Thẳng thắn: dị ứng, đang uống thuốc, cần hỏi bác sĩ trước, v.v. Luôn nhắc: đây là hướng dẫn dưỡng sinh, không thay khám chữa bệnh.]
===PROFILE_END===`;

  app.post('/api/intake/chat', async (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    // First load — return opening message without calling AI
    if (messages.length === 0) {
      return res.json({ reply: INTAKE_OPENING, isComplete: false, profile: null });
    }

    // Prepend opening message so AI knows the full context
    const fullMessages = [
      { role: 'system', content: INTAKE_SYSTEM },
      { role: 'assistant', content: INTAKE_OPENING },
      ...messages
    ];

    // Safety net: after ~8 user turns, force the AI to wrap up and emit the profile block
    const userTurns = messages.filter(m => m.role === 'user').length;
    const alreadyHasProfile = messages.some(m => m.role === 'assistant' && String(m.content || '').includes('===PROFILE_START==='));
    const todayVi = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (userTurns >= 8 && !alreadyHasProfile) {
      fullMessages.push({
        role: 'system',
        content: `Đã đủ thông tin để tổng hợp. Ở LƯỢT NÀY: viết 2–3 câu nhận xét ấm áp về thể trạng của họ, rồi NGAY SAU ĐÓ xuất "Hồ Sơ Dưỡng Sinh" đầy đủ theo đúng format, bắt đầu bằng ===PROFILE_START=== và kết thúc bằng ===PROFILE_END===. Dòng ngày tạo ghi đúng: *Tạo: ${todayVi}*. KHÔNG hỏi thêm câu nào nữa.`,
      });
    }

    try {
      const result = await callAiChat({ messages: fullMessages, maxTokens: 1500 });
      if (!result.ok) return res.status(503).json({ error: result.error });

      const raw = result.text;

      const profileStart = raw.indexOf('===PROFILE_START===');
      const profileEnd   = raw.indexOf('===PROFILE_END===');
      const isComplete   = profileStart !== -1 && profileEnd !== -1;

      let reply   = raw;
      let profile = null;

      if (isComplete) {
        reply   = raw.slice(0, profileStart).trim();
        profile = raw.slice(profileStart + '===PROFILE_START==='.length, profileEnd).trim();
        // the model doesn't know the real date — fix the "*Tạo: …*" line
        profile = profile.replace(/^\*Tạo:.*\*$/m, `*Tạo: ${todayVi}*`);
      }

      res.json({ reply, isComplete, profile });
    } catch (err) {
      console.error('[Intake] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/intake/save', (req, res) => {
    const { userId, profile } = req.body;
    if (!userId || !profile) return res.status(400).json({ error: 'userId and profile required' });

    const user = db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.run(
      "UPDATE users SET intake_profile = ?, intake_done_at = datetime('now','localtime') WHERE id = ?",
      [profile.trim(), userId]
    );
    console.log(`[Intake] Saved profile for user ${userId}`);
    res.json({ ok: true });
  });

  app.get('/api/intake/profile/:userId', (req, res) => {
    const user = db.get(
      'SELECT id, first_name, last_name, intake_profile, intake_done_at FROM users WHERE id = ?',
      [req.params.userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      userId: user.id,
      name: `${user.first_name} ${user.last_name}`.trim(),
      profile: user.intake_profile || null,
      doneAt: user.intake_done_at || null
    });
  });

  // Removes the "⚠️ Bản nháp — chờ duyệt" banner (and any leading blank line
  // after it) that Agent 1 always prepends to drafts. Only meaningful during
  // admin review — must never reach the customer-facing final content, even
  // if the admin approved without manually editing the draft.
  function stripDraftBanner(text) {
    return (text || '').replace(/^\s*⚠️[^\n]*\n+/, '').trim();
  }

  // ── Thân-Tâm-Mệnh intake → Agent 1 (GoClaw) → duyệt Admin ────
  app.post('/api/ttm/intake/save', async (req, res) => {
    const { userId, answers, summaryText } = req.body;
    if (!userId || !answers || !summaryText) {
      return res.status(400).json({ error: 'userId, answers, summaryText required' });
    }

    const user = db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const intakeId = db.run(
      'INSERT INTO ttm_intake_responses (user_id, answers_json, summary_text) VALUES (?, ?, ?)',
      [userId, JSON.stringify(answers), summaryText]
    ).lastInsertRowid;

    db.run("UPDATE users SET ttm_intake_done_at = datetime('now','localtime') WHERE id = ?", [userId]);

    const agentResult = await callGoclawAgent1(summaryText);
    let draftContent, theTrang = null;
    if (agentResult.ok) {
      const parsed = parseAgent1Response(agentResult.text);
      draftContent = parsed.content;
      theTrang = parsed.theTrang;
    } else {
      draftContent = `[Lỗi tạo bản nháp tự động: ${agentResult.error}]\n\nVui lòng bấm "Tạo lại bản nháp" trong Admin, hoặc soạn thủ công dựa trên bản tổng kết bên dưới.`;
    }

    const roadmapId = db.run(
      'INSERT INTO ttm_roadmaps (user_id, intake_id, draft_content, status, the_trang) VALUES (?, ?, ?, ?, ?)',
      [userId, intakeId, draftContent, 'pending_approval', theTrang]
    ).lastInsertRowid;

    if (!agentResult.ok) console.error(`[TTM] Agent 1 call failed for user ${userId}:`, agentResult.error);
    console.log(`[TTM] Intake saved for user ${userId}, roadmap #${roadmapId} pending_approval`);

    res.json({ ok: true, intakeId, roadmapId, agentOk: agentResult.ok });
  });

  // Admin: regenerate a draft (e.g. after fixing GOCLAW_WEBHOOK_* config)
  app.post('/api/admin/ttm/roadmaps/:id/regenerate', requireAdmin, async (req, res) => {
    const roadmap = db.get('SELECT r.*, i.summary_text FROM ttm_roadmaps r JOIN ttm_intake_responses i ON i.id = r.intake_id WHERE r.id = ?', [req.params.id]);
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });

    const agentResult = await callGoclawAgent1(roadmap.summary_text);
    if (!agentResult.ok) return res.status(502).json({ error: agentResult.error });

    const parsed = parseAgent1Response(agentResult.text);
    db.run('UPDATE ttm_roadmaps SET draft_content = ?, the_trang = ? WHERE id = ?', [parsed.content, parsed.theTrang, req.params.id]);
    res.json({ ok: true, theTrang: parsed.theTrang });
  });

  // Khách xem lộ trình đã được Ngô Lâm duyệt (mới nhất)
  app.get('/api/ttm/roadmap/:userId', (req, res) => {
    const roadmap = db.get(
      `SELECT r.id, r.draft_content, r.final_content, r.status, r.reviewed_at, r.created_at, r.the_trang,
              u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
       FROM ttm_roadmaps r LEFT JOIN users u ON u.id = r.reviewed_by
       WHERE r.user_id = ? AND r.status = 'approved'
       ORDER BY r.reviewed_at DESC LIMIT 1`,
      [req.params.userId]
    );
    if (!roadmap) return res.json({ roadmap: null });
    res.json({
      roadmap: {
        id: roadmap.id,
        content: stripDraftBanner(roadmap.final_content || roadmap.draft_content),
        reviewedAt: roadmap.reviewed_at,
        createdAt: roadmap.created_at,
        reviewedByName: roadmap.reviewer_first_name ? `${roadmap.reviewer_first_name} ${roadmap.reviewer_last_name || ''}`.trim() : null,
        theTrang: roadmap.the_trang || null,
      }
    });
  });

  // Khách xem lại hồ sơ khảo sát Thân-Tâm-Mệnh của chính mình (mới nhất)
  app.get('/api/ttm/intake/:userId', (req, res) => {
    const intake = db.get(
      `SELECT id, summary_text, submitted_at FROM ttm_intake_responses
       WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1`,
      [req.params.userId]
    );
    if (!intake) return res.json({ intake: null });
    res.json({
      intake: {
        id: intake.id,
        summaryText: intake.summary_text,
        submittedAt: intake.submitted_at,
      }
    });
  });

  // Nguồn sự thật cho cờ "đã làm intake chưa" — feed.html gọi endpoint này
  // thay vì chỉ tin vào localStorage (có thể lệch do cache cũ/nhiều tab).
  app.get('/api/ttm/intake-status/:userId', (req, res) => {
    const user = db.get('SELECT ttm_intake_done_at FROM users WHERE id = ?', [req.params.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ done: !!user.ttm_intake_done_at, doneAt: user.ttm_intake_done_at || null });
  });

  // Khách xem hồ sơ ảnh (3 ảnh dáng người + video kiểm tra ngồi-đứng) của chính mình
  app.get('/api/ttm/photos/:userId', (req, res) => {
    const row = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [req.params.userId]);
    if (!row) return res.json({ photos: null });
    res.json({
      photos: {
        front: row.front_url, back: row.back_url, side: row.side_url, video: row.video_url,
        updatedAt: row.updated_at,
      }
    });
  });

  // Khách upload/thay hồ sơ ảnh — multipart/form-data, field: front/back/side/video (mỗi field optional,
  // chỉ field nào gửi lên mới được cập nhật, các field khác giữ nguyên giá trị cũ).
  // File được lưu tạm trên đĩa, đẩy lên thư mục Drive riêng của user, rồi xoá bản tạm — không giữ file
  // lâu dài trên VPS.
  app.post('/api/ttm/photos/:userId', (req, res) => {
    ttmPhotoUpload.fields([
      { name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 },
      { name: 'side', maxCount: 1 }, { name: 'video', maxCount: 1 },
    ])(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload thất bại.' });

      const userId = req.params.userId;
      const tmpFiles = ['front', 'back', 'side', 'video']
        .map(f => req.files?.[f]?.[0]).filter(Boolean);
      const cleanupTmp = () => tmpFiles.forEach(f => fs.unlink(f.path, () => {}));
      const DRIVE_FILE_NAME = { front: 'Anh-mat-truoc', back: 'Anh-mat-sau', side: 'Anh-chup-ngang', video: 'Video-ngoi-dung' };

      try {
        const user = db.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) { cleanupTmp(); return res.status(404).json({ error: 'User not found' }); }

        const existing = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [userId]);
        if (tmpFiles.length) {
          const drive = getDriveClient();
          const folderId = await ensureUserDriveFolder(drive, userId);

          for (const field of ['front', 'back', 'side', 'video']) {
            const file = req.files?.[field]?.[0];
            if (!file) continue;
            const ext = path.extname(file.originalname || '') || (field === 'video' ? '.mp4' : '.jpg');
            const { displayUrl } = await uploadToUserDrive(
              drive, file.path, `${DRIVE_FILE_NAME[field]}${ext}`, file.mimetype, folderId, field === 'video'
            );
            const oldUrl = existing?.[`${field}_url`];
            if (oldUrl) deleteDriveFileByUrl(drive, oldUrl).catch(() => {});
            db.run(
              `INSERT INTO ttm_body_photos (user_id, ${field}_url) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET ${field}_url = excluded.${field}_url, updated_at = datetime('now','localtime')`,
              [userId, displayUrl]
            );
          }
        }

        cleanupTmp();
        const row = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [userId]);
        res.json({
          ok: true,
          photos: { front: row.front_url, back: row.back_url, side: row.side_url, video: row.video_url },
        });
      } catch (e) {
        cleanupTmp();
        console.error('[TTM] Drive upload failed:', e.message);
        res.status(502).json({ error: 'Tải lên Google Drive thất bại: ' + e.message });
      }
    });
  });

  // ── Google Drive OAuth (kết nối 1 lần qua Admin > Cài đặt > Google Drive) ──
  app.get('/api/admin/drive-oauth/status', requireAdmin, (req, res) => {
    const refreshToken = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_refresh_token'")?.value;
    const email = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_email'")?.value;
    const connectedAt = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_connected_at'")?.value;
    res.json({ connected: !!refreshToken, email: email || null, connectedAt: connectedAt || null });
  });

  app.get('/api/admin/drive-oauth/start', (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(401).send('Unauthorized');
    try {
      const oauth2Client = newDriveOAuthClient();
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // luôn hỏi lại để chắc chắn nhận được refresh_token (lần sau Google có thể không trả lại)
        scope: GOOGLE_DRIVE_SCOPES,
      });
      res.redirect(url);
    } catch (e) {
      res.status(500).send('Lỗi cấu hình OAuth: ' + e.message);
    }
  });

  app.get('/api/admin/drive-oauth/callback', async (req, res) => {
    try {
      if (req.query.error) throw new Error(req.query.error);
      const oauth2Client = newDriveOAuthClient();
      const { tokens } = await oauth2Client.getToken(req.query.code);
      if (!tokens.refresh_token) {
        throw new Error('Không nhận được refresh_token. Vào myaccount.google.com/permissions gỡ quyền truy cập cũ của app này rồi thử kết nối lại.');
      }
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const me = await oauth2.userinfo.get();

      const upsertSecret = (key, value) => db.run(
        `INSERT INTO admin_secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value]
      );
      upsertSecret('google_drive_refresh_token', tokens.refresh_token);
      upsertSecret('google_drive_email', me.data.email || '');
      upsertSecret('google_drive_connected_at', new Date().toISOString());

      res.send('<h2>✅ Đã kết nối Google Drive thành công!</h2><p>Tài khoản: ' + (me.data.email || '') + '</p><p>Bạn có thể đóng tab này.</p>');
    } catch (e) {
      res.status(500).send('<h3>❌ Lỗi kết nối Google Drive</h3><p>' + (e.message || 'Unknown error') + '</p>');
    }
  });

  // Admin: xem hồ sơ ảnh của 1 học viên (dùng trong modal duyệt lộ trình)
  app.get('/api/admin/ttm/photos/:userId', requireAdmin, (req, res) => {
    const row = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [req.params.userId]);
    if (!row) return res.json({ photos: null });
    res.json({
      photos: {
        front: row.front_url, back: row.back_url, side: row.side_url, video: row.video_url,
        updatedAt: row.updated_at,
      }
    });
  });

  // Admin: hồ sơ 360° của 1 thành viên — dùng cho trang "Profile thành viên"
  // (Lộ trình: khảo sát/ảnh/lộ trình · Học tập: theo space group · Nhật ký ăn uống · Cộng đồng: bài viết/bình luận)
  app.get('/api/admin/member-profile/:userId', requireAdmin, (req, res) => {
    const userId = req.params.userId;
    const user = db.get(
      `SELECT id, first_name, last_name, email, phone, avatar_url, level, xp, streak, status,
              is_admin, created_at, last_active_at, ttm_intake_done_at
       FROM users WHERE id = ?`, [userId]
    );
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });

    const intake = db.get(
      'SELECT summary_text, submitted_at FROM ttm_intake_responses WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
      [userId]
    );
    const photoRow = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [userId]);
    const roadmapRow = db.get(
      `SELECT r.*, u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
       FROM ttm_roadmaps r LEFT JOIN users u ON u.id = r.reviewed_by
       WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 1`,
      [userId]
    );

    const groups = db.all('SELECT id, name FROM space_groups ORDER BY order_num ASC, id ASC').map(g => {
      const spaces = db.all('SELECT id, name FROM spaces WHERE group_id = ? ORDER BY id ASC', [g.id]).map(s => {
        const membership = db.get('SELECT status FROM space_members WHERE space_id = ? AND user_id = ?', [s.id, userId]);
        const courses = db.all('SELECT id, title FROM courses WHERE space_id = ? ORDER BY order_num ASC, id ASC', [s.id]).map(c => {
          const totalLessons = db.get("SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ? AND status = 'published'", [c.id]).n;
          const passedLessons = db.get(
            'SELECT COUNT(*) AS n FROM lesson_exercise_submissions WHERE course_id = ? AND user_id = ? AND passed = 1',
            [c.id, userId]
          ).n;
          const enroll = db.get('SELECT status FROM course_enrollments WHERE course_id = ? AND user_id = ?', [c.id, userId]);
          return { id: c.id, title: c.title, enrollStatus: enroll?.status || null, totalLessons, passedLessons };
        });
        return { id: s.id, name: s.name, memberStatus: membership?.status || null, courses };
      });
      return { id: g.id, name: g.name, spaces };
    });

    const posts = db.all(
      'SELECT id, title, content, pillar, post_type, likes_count, comments_count, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
    const comments = db.all(
      `SELECT c.id, c.content, c.created_at, c.post_id,
              p.title AS post_title, p.content AS post_content, p.pillar AS post_pillar,
              p.post_type AS post_post_type, p.likes_count AS post_likes_count,
              p.comments_count AS post_comments_count, p.created_at AS post_created_at
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 50`,
      [userId]
    );

    const p377Enrollment = db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]);
    const p377Reports = db.all(
      'SELECT * FROM program377_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 100',
      [userId]
    ).map(r => ({ ...r, meal_colors: JSON.parse(r.meal_colors || '[]'), meal_tastes: JSON.parse(r.meal_tastes || '[]') }));

    res.json({
      user: {
        id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email,
        phone: user.phone, avatarUrl: user.avatar_url, level: user.level, xp: user.xp, streak: user.streak,
        status: user.status, isAdmin: !!user.is_admin, createdAt: user.created_at,
        lastActiveAt: user.last_active_at, ttmIntakeDoneAt: user.ttm_intake_done_at,
      },
      ttm: {
        intake: intake ? { summaryText: intake.summary_text, submittedAt: intake.submitted_at } : null,
        photos: photoRow ? {
          front: photoRow.front_url, back: photoRow.back_url, side: photoRow.side_url, video: photoRow.video_url,
          updatedAt: photoRow.updated_at,
        } : null,
        roadmap: roadmapRow ? {
          content: stripDraftBanner(roadmapRow.final_content || roadmapRow.draft_content),
          status: roadmapRow.status, adminNote: roadmapRow.admin_note,
          reviewedAt: roadmapRow.reviewed_at, createdAt: roadmapRow.created_at,
          reviewedByName: roadmapRow.reviewer_first_name ? `${roadmapRow.reviewer_first_name} ${roadmapRow.reviewer_last_name || ''}`.trim() : null,
          theTrang: roadmapRow.the_trang || null,
        } : null,
      },
      learning: { groups },
      community: { posts, comments },
      program377: {
        enrollment: p377Enrollment ? {
          status: p377Enrollment.status,
          startDate: p377Enrollment.start_date,
          adminNote: p377Enrollment.admin_note,
          dayNumberToday: p377Enrollment.status === 'approved'
            ? Math.min(program377DayNumberToday(p377Enrollment.start_date), 377)
            : 0,
        } : null,
        reports: p377Reports,
      },
    });
  });

  // Admin: danh sách lộ trình theo trạng thái (mặc định pending_approval)
  app.get('/api/admin/ttm/roadmaps', requireAdmin, (req, res) => {
    const status = req.query.status || 'pending_approval';
    const rows = db.all(
      `SELECT r.id, r.user_id, r.intake_id, r.draft_content, r.status, r.admin_note,
              r.final_content, r.reviewed_at, r.created_at, r.the_trang,
              u.first_name, u.last_name, u.email,
              i.summary_text, i.submitted_at
       FROM ttm_roadmaps r
       JOIN users u ON u.id = r.user_id
       JOIN ttm_intake_responses i ON i.id = r.intake_id
       WHERE r.status = ?
       ORDER BY r.created_at DESC`,
      [status]
    );
    res.json({
      roadmaps: rows.map(r => ({
        id: r.id,
        userId: r.user_id,
        userName: `${r.first_name} ${r.last_name}`.trim(),
        userEmail: r.email,
        draftContent: r.draft_content,
        finalContent: r.final_content,
        status: r.status,
        adminNote: r.admin_note,
        summaryText: r.summary_text,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        createdAt: r.created_at,
        theTrang: r.the_trang || null,
      })),
      pending_count: db.get(
        `SELECT COUNT(*) AS n FROM ttm_roadmaps r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending_approval'`
      ).n,
    });
  });

  // Admin: duyệt / từ chối 1 lộ trình
  app.patch('/api/admin/ttm/roadmaps/:id', requireAdmin, (req, res) => {
    const { action, final_content, admin_note, the_trang } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action phải là approve hoặc reject' });
    }
    const roadmap = db.get('SELECT id FROM ttm_roadmaps WHERE id = ?', [req.params.id]);
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });
    const theTrang = THE_TRANG_VALUES.includes(the_trang) ? the_trang : null;

    if (action === 'approve') {
      const cleaned = stripDraftBanner((final_content || '').trim());
      db.run(
        "UPDATE ttm_roadmaps SET status = 'approved', final_content = ?, admin_note = ?, the_trang = ?, reviewed_at = datetime('now','localtime'), reviewed_by = ? WHERE id = ?",
        [cleaned || null, admin_note || null, theTrang, req.adminUserId || null, req.params.id]
      );
    } else {
      db.run(
        "UPDATE ttm_roadmaps SET status = 'rejected', admin_note = ?, the_trang = ?, reviewed_at = datetime('now','localtime'), reviewed_by = ? WHERE id = ?",
        [admin_note || null, theTrang, req.adminUserId || null, req.params.id]
      );
    }
    res.json({ ok: true });
  });

  // ── Start ──────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`\n✅  ${COMMUNITY_NAME} API`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin.html`);
    console.log(`   Admin key : ${ADMIN_KEY}`);
    console.log(`\n🔔  SePay Webhook`);
    console.log(`   SePay Key : ${SEPAY_KEY}`);
    console.log(`   Webhook   : ${SITE_URL}/api/webhook/sepay`);
    console.log(`\n📧  Email (Resend)`);
    console.log(`   Status    : ${resendClient ? '✅ Active' : '⚠️  No RESEND_API_KEY — emails disabled'}`);
    console.log(`   From      : ${FROM_EMAIL}`);
    console.log(`   Admin     : ${ADMIN_EMAIL}\n`);
  });
})();
