/* ============================================================
   app.js — Sidebar toggle, mobile nav, tab switching, utils
   ============================================================ */

// Mobile sidebar
function openSidebar() {
  document.getElementById('mob-sidebar')?.classList.add('open');
  document.getElementById('mob-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('mob-sidebar')?.classList.remove('open');
  document.getElementById('mob-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

function openMainMenu() {
  document.getElementById('mob-mainmenu')?.classList.add('open');
  document.getElementById('mob-mainmenu-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMainMenu() {
  document.getElementById('mob-mainmenu')?.classList.remove('open');
  document.getElementById('mob-mainmenu-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Dynamic community branding ─────────────────────────────
(function applyCommunityBranding() {
  const DEFAULT_NAME = 'Ăn Uống Ngũ Hành';
  const CACHE_KEY = 'communitySettingsCache';
  let _titleObserver = null;

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeCache(s) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // Replace the fallback name with the real community name — guarded so it can't loop
  // when `name` itself contains DEFAULT_NAME (e.g. "Cộng đồng Ăn Uống Ngũ Hành").
  function replaceInTitle(name) {
    if (name === DEFAULT_NAME) return;
    if (document.title.includes(name)) return;           // already branded
    if (!document.title.includes(DEFAULT_NAME)) return;  // nothing to replace
    const next = document.title.split(DEFAULT_NAME).join(name);
    if (next === document.title) return;
    // pause the observer while we set the title so our own write doesn't re-trigger it
    if (_titleObserver) _titleObserver.disconnect();
    document.title = next;
    if (_titleObserver) _titleObserver.observe(document.querySelector('title'), { childList: true });
  }

  function apply(s) {
    const tagline = (s.home_tagline || '').trim();
    const taglineEl = document.getElementById('pageTagline');
    if (tagline && taglineEl) taglineEl.textContent = tagline;

    const name = (s.community_name || '').trim();
    if (!name || name === DEFAULT_NAME) return;

    const titleEl = document.querySelector('title');
    if (titleEl && !_titleObserver) {
      _titleObserver = new MutationObserver(() => replaceInTitle(name));
      _titleObserver.observe(titleEl, { childList: true });
    }
    replaceInTitle(name);

    document.querySelectorAll('.sidebar-logo-text, .form-logo-name, .mob-brand-name, #aboutCommunityName, .co-logo-text, .logo-text, .login-logo-name, .header-name').forEach(el => {
      el.textContent = name;
    });
  }

  // Render from last-known settings immediately (no fetch wait) so the brand
  // name/tagline don't visibly flash from the default → real value on every
  // page navigation; then refresh in the background and re-apply if changed.
  const cached = readCache();
  if (cached) apply(cached);

  fetch('/api/settings').then(r => r.json()).then(s => {
    if (JSON.stringify(s) !== JSON.stringify(cached)) apply(s);
    writeCache(s);
  }).catch(() => {});
})();

// ── Global topbar search ─────────────────────────────────────
(function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  const panel = document.getElementById('globalSearchResults');
  if (!input || !panel) return;

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderResults(data) {
    const posts = data.posts || [], users = data.users || [], products = data.products || [];
    if (!posts.length && !users.length && !products.length) {
      panel.innerHTML = '<div class="gsr-empty">Không tìm thấy kết quả nào.</div>';
      return;
    }
    let html = '';
    if (posts.length) {
      html += '<div class="gsr-group-title">Bài viết</div>' + posts.map(p => `
        <a class="gsr-item" href="feed.html?post_id=${p.id}">
          <div class="gsr-item-icon">📝</div>
          <div class="gsr-item-text">
            <div class="gsr-item-title">${esc(p.title)}</div>
            <div class="gsr-item-sub">${esc(p.first_name)} ${esc(p.last_name)}</div>
          </div>
        </a>`).join('');
    }
    if (users.length) {
      html += '<div class="gsr-group-title">Thành viên</div>' + users.map(u => `
        <a class="gsr-item" href="profile.html?id=${u.id}">
          <div class="gsr-item-icon">${esc((u.first_name || '?')[0])}</div>
          <div class="gsr-item-text">
            <div class="gsr-item-title">${esc(u.first_name)} ${esc(u.last_name)}</div>
            <div class="gsr-item-sub">Lv.${u.level || 1} · ${u.xp || 0} XP</div>
          </div>
        </a>`).join('');
    }
    if (products.length) {
      html += '<div class="gsr-group-title">Sản phẩm</div>' + products.map(p => `
        <a class="gsr-item" href="marketplace.html?product_id=${p.id}">
          <div class="gsr-item-icon" style="background:${p.cover_color || 'var(--color-primary)'}">🛍️</div>
          <div class="gsr-item-text">
            <div class="gsr-item-title">${esc(p.title)}</div>
            <div class="gsr-item-sub">${Number(p.price || 0).toLocaleString('vi-VN')}₫</div>
          </div>
        </a>`).join('');
    }
    panel.innerHTML = html;
  }

  async function runSearch(q) {
    panel.innerHTML = '<div class="gsr-loading">Đang tìm...</div>';
    panel.classList.add('open');
    try {
      const data = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
      renderResults(data);
    } catch (e) {
      panel.innerHTML = '<div class="gsr-empty">Lỗi kết nối server.</div>';
    }
  }

  let debounceTimer = null;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (!q) { panel.classList.remove('open'); panel.innerHTML = ''; return; }
    debounceTimer = setTimeout(() => runSearch(q), 300);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim() && panel.innerHTML) panel.classList.add('open');
  });

  document.addEventListener('click', (e) => {
    if (e.target !== input && !panel.contains(e.target)) panel.classList.remove('open');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { panel.classList.remove('open'); input.blur(); }
  });
})();

// Tab switching
function setActiveTab(tabEl, groupSelector = '.tab-item') {
  const group = tabEl.closest('.tab-nav') || document.querySelector('.tab-nav');
  if (!group) return;
  group.querySelectorAll(groupSelector).forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
}

// Password toggle helper
function initPasswordToggle(inputId, toggleBtnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(toggleBtnId);
  if (!input || !btn) return;

  const eyeOpen   = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  const eyeClosed = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" stroke-linecap="round"/>`;

  let visible = false;
  btn.addEventListener('click', () => {
    visible = !visible;
    input.type = visible ? 'text' : 'password';
    const icon = btn.querySelector('svg');
    if (icon) icon.innerHTML = visible ? eyeClosed : eyeOpen;
  });
}

// Google OAuth (placeholder)
function handleGoogleLogin() {
  const btn     = document.getElementById('googleBtn');
  const spinner = document.getElementById('gSpinner');
  const text    = document.getElementById('googleBtnText');
  if (!btn) return;

  btn.disabled = true;
  if (spinner) spinner.style.display = 'block';
  if (text) text.textContent = 'Đang chuyển hướng...';

  // Replace with real OAuth redirect: window.location.href = '/auth/google';
  setTimeout(() => {
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (text) text.textContent = 'Tiếp tục với Google';
  }, 2000);
}

// Show/hide alert banner
function showAlert(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  const msg = el.querySelector('[data-msg]');
  if (msg && message) msg.textContent = message;
  el.style.display = 'flex';
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Password toggles
  initPasswordToggle('password', 'togglePw');
  initPasswordToggle('password_confirmation', 'togglePwConfirm');

  // Close sidebar on overlay click
  document.getElementById('mob-overlay')?.addEventListener('click', closeSidebar);

  // Close sidebar on nav item click (mobile)
  document.querySelectorAll('#mob-sidebar .nav-item').forEach(item => {
    item.addEventListener('click', closeSidebar);
  });

  // Tab switching
  document.querySelectorAll('.tab-item[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => setActiveTab(tab));
  });
});

// ── Theme toggle (sáng/tối) ──────────────────────────────────
(function initThemeToggle() {
  const MOON = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  const SUN  = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke-linecap="round"/>';

  function applyIcon(btn, isDark) {
    const svg = btn.querySelector('svg');
    if (svg) svg.innerHTML = isDark ? SUN : MOON;
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    const btn = document.getElementById('themeToggle');
    if (btn) applyIcon(btn, theme === 'dark');
  }

  function setup() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    applyIcon(btn, document.documentElement.getAttribute('data-theme') === 'dark');
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Spaces sidebar section ───────────────────────────────────
(function initSpacesNav() {
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function currentSpaceId() {
    if (!location.pathname.endsWith('space.html')) return null;
    return new URLSearchParams(location.search).get('id');
  }

  function insertInto(navEl, groups) {
    if (!navEl) return;
    navEl.querySelectorAll('.spaces-nav-group').forEach(el => el.remove());
    if (!groups.length) return;

    let target = null;
    navEl.querySelectorAll('.nav-section-label').forEach(l => {
      if (l.textContent.trim() === 'Học tập') target = l;
    });
    if (!target) return;

    const activeId = currentSpaceId();
    groups.forEach(g => {
      const hasActive = g.spaces.some(s => String(s.id) === activeId);
      const storeKey = 'spacesNavCollapsed:' + g.id;
      const collapsed = !hasActive && localStorage.getItem(storeKey) === '1';

      const wrap = document.createElement('div');
      wrap.className = 'spaces-nav-group' + (collapsed ? ' collapsed' : '');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-section-label spaces-nav-label';
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.innerHTML = `<span>${esc(g.name)}</span><svg class="spaces-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>`;
      btn.addEventListener('click', () => {
        const isCollapsed = wrap.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(!isCollapsed));
        localStorage.setItem(storeKey, isCollapsed ? '1' : '0');
      });

      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'spaces-nav-items';
      g.spaces.forEach(s => {
        const a = document.createElement('a');
        a.href = `space.html?id=${s.id}`;
        a.className = 'nav-item spaces-nav-item' + (String(s.id) === activeId ? ' active' : '');
        a.innerHTML = `<span style="width:17px;flex-shrink:0;text-align:center;font-size:14px;">${esc(s.icon || '💬')}</span>${esc(s.name)}`;
        itemsWrap.appendChild(a);
      });

      wrap.appendChild(btn);
      wrap.appendChild(itemsWrap);
      target.parentNode.insertBefore(wrap, target);
    });
  }

  function readCache(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  async function setup() {
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    const cacheKey = 'spacesNavCache:' + (user ? user.id : 'guest');
    // Render from last-known groups immediately so the sidebar doesn't
    // visibly pop in new items after the page has already rendered; then
    // refresh in the background and only touch the DOM again if it changed.
    const cached = readCache(cacheKey);
    if (cached) {
      insertInto(document.getElementById('sidebar-nav'), cached);
      insertInto(document.querySelector('#mob-sidebar nav'), cached);
    }
    try {
      const qs = user ? `?user_id=${user.id}` : '';
      const { groups } = await fetch(`/api/space-groups${qs}`).then(r => r.json());
      const fresh = groups || [];
      if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
        insertInto(document.getElementById('sidebar-nav'), fresh);
        insertInto(document.querySelector('#mob-sidebar nav'), fresh);
      }
      writeCache(cacheKey, fresh);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Courses sidebar section (only courses the user has joined) ─
(function initCoursesNav() {
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function currentCourseId() {
    if (!location.pathname.endsWith('courses.html')) return null;
    return new URLSearchParams(location.search).get('course_id');
  }

  function insertInto(navEl, courses) {
    if (!navEl) return;
    navEl.querySelectorAll('.courses-nav-item').forEach(el => el.remove());
    if (!courses.length) return;

    let anchor = null;
    navEl.querySelectorAll('.nav-section-label').forEach(l => {
      if (l.textContent.trim() === 'Học tập') anchor = l;
    });
    if (!anchor) return;

    const activeId = currentCourseId();
    let ref = anchor;
    courses.forEach(c => {
      const a = document.createElement('a');
      a.href = `courses.html?course_id=${c.id}`;
      a.className = 'nav-item courses-nav-item' + (String(c.id) === activeId ? ' active' : '');
      a.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"/></svg>${esc(c.title)}`;
      ref.parentNode.insertBefore(a, ref.nextSibling);
      ref = a;
    });
  }

  function readCache(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  async function setup() {
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user) return;
    const cacheKey = 'coursesNavCache:' + user.id;
    const cached = readCache(cacheKey);
    if (cached) {
      insertInto(document.getElementById('sidebar-nav'), cached);
      insertInto(document.querySelector('#mob-sidebar nav'), cached);
    }
    try {
      const { courses } = await fetch(`/api/courses?user_id=${user.id}`).then(r => r.json());
      const mine = (courses || []).filter(c => c.enroll_status === 'approved');
      if (JSON.stringify(mine) !== JSON.stringify(cached)) {
        insertInto(document.getElementById('sidebar-nav'), mine);
        insertInto(document.querySelector('#mob-sidebar nav'), mine);
      }
      writeCache(cacheKey, mine);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Collapsible sidebar sections ("Học tập", "Cẩm nang") ──────
// Each section collapses/expands independently, with its own remembered
// state in localStorage (keyed by SECTIONS[].storeKey below).
(function initCollapsibleNavSections() {
  const SECTIONS = [
    { label: 'Học tập', itemClass: 'group-hoctap', storeKey: 'navCollapsed:hoctap' },
    { label: 'Cẩm nang', itemClass: 'group-camnang', storeKey: 'navCollapsed:camnang' },
  ];

  function findLabel(navEl, text) {
    if (!navEl) return null;
    return Array.from(navEl.querySelectorAll('.nav-section-label'))
      .find(l => l.textContent.trim() === text) || null;
  }

  function applyState(label, collapsed) {
    label.classList.toggle('collapsed', collapsed);
    label.setAttribute('aria-expanded', String(!collapsed));
  }

  function setState(label, storeKey, collapsed) {
    try { localStorage.setItem(storeKey, collapsed ? '1' : '0'); } catch (e) {}
    applyState(label, collapsed);
  }

  function setupLabel(label, storeKey) {
    if (!label || label.dataset.collapsible === '1') return;
    label.dataset.collapsible = '1';
    label.classList.add('nav-section-toggle');
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '0');
    label.innerHTML = `<span>${label.textContent.trim()}</span>` +
      `<svg class="spaces-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">` +
      `<path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>`;

    function toggle() {
      setState(label, storeKey, localStorage.getItem(storeKey) !== '1');
    }
    label.addEventListener('click', toggle);
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }

  function markItems(navEl, label, itemClass) {
    navEl.querySelectorAll(`.nav-item.${itemClass}`).forEach(el => el.classList.remove(itemClass));
    let sib = label.nextElementSibling;
    while (sib && !sib.classList.contains('nav-section-label')) {
      if (sib.classList.contains('nav-item')) sib.classList.add(itemClass);
      sib = sib.nextElementSibling;
    }
  }

  function refresh() {
    [document.getElementById('sidebar-nav'), document.querySelector('#mob-sidebar nav')].forEach(navEl => {
      SECTIONS.forEach(({ label: text, itemClass, storeKey }) => {
        const label = findLabel(navEl, text);
        if (!label) return;
        setupLabel(label, storeKey);
        markItems(navEl, label, itemClass);
        applyState(label, localStorage.getItem(storeKey) === '1');
      });
    });
  }

  function setup() {
    refresh();
    [document.getElementById('sidebar-nav'), document.querySelector('#mob-sidebar nav')].forEach(navEl => {
      if (navEl) new MutationObserver(refresh).observe(navEl, { childList: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Notification Bell ────────────────────────────────────────
(function initNotifSystem() {
  const NOTIF_API = '/api';
  let _notifOpen = false;
  let _notifUserId = null;
  let _seenIds = new Set();
  let _firstLoad = true;

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _icon(type) {
    return ({challenge:'🎯',course:'📚',feed:'📢',marketplace:'🛍️',system:'⚙️',
             enrollment_approved:'✅',enrollment_rejected:'❌',submission_reviewed:'📝'})[type] || '🔔';
  }
  function _timeAgo(s) {
    const d = Date.now() - new Date(s).getTime();
    if (d < 60000) return 'Vừa xong';
    if (d < 3600000) return Math.floor(d/60000) + ' phút trước';
    if (d < 86400000) return Math.floor(d/3600000) + ' giờ trước';
    return Math.floor(d/86400000) + ' ngày trước';
  }

  function _showToast(notif) {
    const icon = _icon(notif.type);
    const wrap = document.createElement('div');
    wrap.className = 'notif-toast';
    wrap.innerHTML = `
      <div class="notif-toast-icon">${icon}</div>
      <div class="notif-toast-body">
        ${notif.title ? `<div class="notif-toast-title">${_esc(notif.title)}</div>` : ''}
        <div class="notif-toast-text">${_esc(notif.content)}</div>
      </div>
      <button class="notif-toast-close" onclick="this.closest('.notif-toast').remove()">×</button>
    `;
    if (notif.link) {
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('.notif-toast-close')) return;
        wrap.remove();
        window._notifClick && window._notifClick(notif.id, notif.link);
      });
    }
    document.body.appendChild(wrap);
    // Stack toasts vertically
    const existing = document.querySelectorAll('.notif-toast');
    let top = 72;
    existing.forEach(el => { if (el !== wrap) top += el.offsetHeight + 8; });
    wrap.style.top = top + 'px';
    // Auto-dismiss after 6s
    setTimeout(() => { wrap.style.opacity = '0'; setTimeout(() => wrap.remove(), 400); }, 6000);
  }

  async function _load() {
    if (!_notifUserId) return;
    try {
      const r = await fetch(`${NOTIF_API}/notifications?user_id=${_notifUserId}`);
      const data = await r.json();
      const notifs = data.notifications || [];
      _renderBadge(data.unread);
      _renderDropdown(notifs);
      // On first load: toast unread from last 5 min. On polls: toast all new unread.
      const RECENT = 5 * 60 * 1000;
      const now = Date.now();
      notifs
        .filter(n => {
          if (n.is_read || _seenIds.has(n.id)) return false;
          if (_firstLoad) return (now - new Date(n.created_at).getTime()) < RECENT;
          return true;
        })
        .forEach(_showToast);
      _seenIds = new Set(notifs.map(n => n.id));
      _firstLoad = false;
    } catch(e) {}
  }

  function _renderBadge(unread) {
    const el = document.getElementById('notifBadge');
    if (!el) return;
    if (unread > 0) {
      el.textContent = unread > 99 ? '99+' : unread;
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
    } else {
      el.style.display = 'none';
    }
  }

  function _renderDropdown(notifs) {
    const el = document.getElementById('notifDropdown');
    if (!el) return;
    if (!notifs || !notifs.length) {
      el.innerHTML = '<div class="notif-header"><span>Thông báo</span></div><div class="notif-empty">🔔 Chưa có thông báo nào</div>';
      return;
    }
    const unread = notifs.filter(n => !n.is_read).length;
    el.innerHTML = `
      <div class="notif-header">
        <div class="notif-header-left">
          Thông báo
          ${unread > 0 ? `<span class="notif-unread-count">${unread}</span>` : ''}
        </div>
        ${unread > 0 ? `<button class="notif-read-all-btn" onclick="window._notifMarkAll()">Đọc tất cả</button>` : ''}
      </div>
      <div class="notif-list">${notifs.map(n => `
        <div class="notif-item ${n.is_read?'read':'unread'}" onclick="window._notifClick(${n.id},'${_esc(n.link||'')}')">
          <div class="notif-item-icon">${_icon(n.type)}</div>
          <div class="notif-item-body">
            ${n.title ? `<div class="notif-item-title">${_esc(n.title)}</div>` : ''}
            <div class="notif-item-text">${_esc(n.content)}</div>
            <div class="notif-item-time">${_timeAgo(n.created_at)}</div>
          </div>
          ${!n.is_read ? '<div class="notif-item-dot"></div>' : ''}
        </div>`).join('')}
      </div>`;
  }

  window._notifClick = async function(id, link) {
    if (!_notifUserId) return;
    await fetch(`${NOTIF_API}/notifications/${id}/read`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({user_id: _notifUserId})
    }).catch(()=>{});
    _notifOpen = false;
    const dd = document.getElementById('notifDropdown');
    if (dd) dd.style.display = 'none';
    await _load();
    if (link) location.href = link;
  };

  window._notifMarkAll = async function() {
    if (!_notifUserId) return;
    await fetch(`${NOTIF_API}/notifications/read-all`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({user_id: _notifUserId})
    }).catch(()=>{});
    await _load();
  };

  function _positionNotifDropdown(bell, dd) {
    const r = bell.getBoundingClientRect();
    const width = 340;
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    dd.style.top = (r.bottom + 8) + 'px';
    dd.style.left = left + 'px';
  }

  function _setup() {
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user) return;
    _notifUserId = user.id;
    const bell = document.getElementById('notifBell');
    const dd   = document.getElementById('notifDropdown');
    if (!bell || !dd) return;

    // Move the dropdown to <body> so position:fixed is never clipped by an
    // ancestor's overflow (e.g. #subnav-bar's overflow-x:auto scroll strip).
    document.body.appendChild(dd);

    _load();
    setInterval(_load, 15000); // poll every 15s for faster notification display

    bell.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      _notifOpen = !_notifOpen;
      if (_notifOpen) _positionNotifDropdown(bell, dd);
      dd.style.display = _notifOpen ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
      if (_notifOpen && !bell.contains(e.target) && !dd.contains(e.target)) {
        _notifOpen = false; dd.style.display = 'none';
      }
    });
    window.addEventListener('resize', () => { if (_notifOpen) { _notifOpen = false; dd.style.display = 'none'; } });
    window.addEventListener('scroll', () => { if (_notifOpen) { _notifOpen = false; dd.style.display = 'none'; } }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _setup);
  } else {
    setTimeout(_setup, 300);
  }
})();

// ── Cẩm Nang Ngũ Hành nav injector ───────────────────────────
// Groups the nutrition tools under a single "Cẩm nang" labelled section
// in the left sidebar + mobile menu.
(function injectNguHanhNav() {
  const ITEMS = [
    ['tro-ly.html', 'Trợ lý Ngũ Hành', '<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>'],
    ['cam-nang-suc-khoe.html', 'Ngũ Hành – Chìa khóa sức khỏe', '<path d="M12 7c0-1.1-.9-2-2-2H4v13h6a2 2 0 012 2M12 7c0-1.1.9-2 2-2h6v13h-6a2 2 0 00-2 2M12 7v14"/>'],
    ['quy-trinh.html',  'Quy trình 1 ngày', '<path d="M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z"/>'],
    ['thuc-pham.html',  'Tra cứu thực phẩm', '<path d="M3 2v7c0 1.1.9 2 2 2h1v11M8 2v20M13 2c-1 3-1 6 0 8 1 2 3 2 3 0V2m0 8v12"/>'],
    ['nhat-ky.html',    'Nhật ký ăn uống',  '<path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"/>'],
    ['cong-thuc.html',  'Thư viện công thức', '<path d="M12 3a6 6 0 00-6 6c0 2 1 3.5 2 4.5.7.7 1 1.5 1 2.5v1h6v-1c0-1 .3-1.8 1-2.5 1-1 2-2.5 2-4.5a6 6 0 00-6-6zM9 21h6"/>'],
    ['tai-lieu.html',   'Tài liệu PDF', '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h6"/>'],
  ];
  const here = location.pathname.split('/').pop() || 'index.html';
  const svg = p => `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

  // "Khác" is always the last static section in the markup — after Cẩm nang
  // is appended (below) it would sit second-to-last, so move it (label + its
  // items) to the very end of navEl. Stops at the next .nav-section-label OR
  // at the Cẩm nang wrapper (which isn't itself a .nav-section-label).
  function moveKhacToBottom(navEl) {
    if (!navEl) return;
    const khacLabel = Array.from(navEl.querySelectorAll('.nav-section-label'))
      .find(l => l.textContent.trim() === 'Khác');
    if (!khacLabel) return;
    const nodes = [khacLabel];
    let sib = khacLabel.nextElementSibling;
    while (sib && !sib.classList.contains('nav-section-label') && !sib.classList.contains('camnang-nav-section')) {
      nodes.push(sib);
      sib = sib.nextElementSibling;
    }
    nodes.forEach(n => navEl.appendChild(n)); // re-appending in order moves the whole block to the end
  }

  // Left sidebar + mobile drawer — "Cẩm nang" labelled section.
  // Wrapped in its own container (rather than appended as loose siblings) so
  // the collapse feature below can reliably find "the items in this section"
  // without depending on DOM order relative to the other nav injectors
  // (Spaces, Khoá học) that also mutate this same list.
  function addSection(navEl, itemClass) {
    if (!navEl || navEl.dataset.nguhanh) return;
    navEl.dataset.nguhanh = '1';
    const section = document.createElement('div');
    section.className = 'camnang-nav-section';
    const label = document.createElement('div');
    label.className = 'nav-section-label';
    label.style.marginTop = '8px';
    label.textContent = 'Cẩm nang';
    section.appendChild(label);
    ITEMS.forEach(([href, label2, path]) => {
      const a = document.createElement('a');
      a.href = href;
      a.className = itemClass + (here === href ? ' active' : '');
      a.innerHTML = svg(path) + label2;
      section.appendChild(a);
    });
    navEl.appendChild(section);
    moveKhacToBottom(navEl);
  }
  addSection(document.getElementById('sidebar-nav'), 'nav-item');
  addSection(document.querySelector('#mob-sidebar nav'), 'nav-item');
  addSection(document.querySelector('#mob-mainmenu nav'), 'nav-item');
})();
