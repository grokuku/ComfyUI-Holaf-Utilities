
    let API = '/api';
    let LOCAL_MODE = false;      // page servie par ComfyUI (backend indisponible)
    let localStatus = null;      // dernier statut {server_reachable, pending_sync, ...}
    let apiFailCount = 0;        // echecs consecutifs de fetch vers le backend
    let localPollTimer = null;   // timer du polling du badge local
    let localPollStarted = false; // guard: listener visibilitychange ajoute une seule fois
    let allKeywords = [];
    let sectionsList = [];
    let currentUser = null;
    let semanticCache = null;  // { text, results: [...], timestamp }

    // === DOM refs ===
    const $ = id => document.getElementById(id);
    const searchInput = $('search-input');
    const searchNegInput = $('search-neg-input');
    const semanticInput = $('search-semantic-input');
    const sectionSelect = $('section-multiselect');
    const subsectionSelect = $('subsection-multiselect');
    const emptyState = $('empty-state');
    const resultsArea = $('results-area');
    const filtersBar = $('filters-bar');
    const tableBody = $('table-body');
    const footerStats = $('footer-stats');
    const countDisplay = $('count-display');
    const countLabel = $('count-label');
    const scoreHeader = $('score-header');
    const semanticLoading = $('semantic-loading');
    const userArea = $('user-area');
    const btnLogin = $('btn-login');
    const userInfo = $('user-info');
    const userAvatar = $('user-avatar');
    const userName = $('user-name');
    const btnAdmin = $('btn-admin');
    const emptyTitle = $('empty-title');
    const emptyDesc = $('empty-desc');
    const emptyBtn = $('empty-btn');
    const emptyImportBtn = $('empty-import-btn');
    const emptySvg = $('empty-svg');

    let textTimer = null;
    let semanticTimer = null;

    // === Init ===

    const enhOutput = $('enhance-output');

    let hiddenKWs = {};  // { id: true } — mots-cles masques localement

    // === Mode local (page servie par ComfyUI, backend indisponible) ===
    async function detectLocalMode() {
      try {
        const res = await fetch('/aih/local/status', { signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch (e) { /* silencieux → mode backend par defaut */ }
      return false;
    }

    function applyLocalMode() {
      window.LOCAL_MODE = true;   // flag lisible par les autres scripts (call-time guards)
      currentUser = { id: 'local', display_name: 'Local', role: 'user', local: true };
      // Masquer les elements "mode complet" (login, user, admin, membres, preview,
      // presets IA / upload / partage)
      ['btn-login', 'user-info', 'btn-admin', 'btn-members', 'tab-btn-preview', 'tab-preview',
       'enhance-preset', 'empty-import-btn', 'presets-list'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      injectLocalBadge();
      startLocalPolling();
    }

    function injectLocalBadge() {
      if (document.getElementById('aih-mode-badge')) return;
      var badge = document.createElement('span');
      badge.id = 'aih-mode-badge';
      badge.style.cssText = 'font-size:11px;font-weight:500;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.25);white-space:nowrap;';
      var userArea = document.getElementById('user-area');
      if (userArea && userArea.parentNode) userArea.parentNode.insertBefore(badge, userArea);
      else if (document.querySelector('header')) document.querySelector('header').appendChild(badge);
      updateLocalBadge(localStatus);
    }

    function startLocalPolling() {
      refreshLocalStatus();
      if (localPollTimer) clearInterval(localPollTimer);
      localPollTimer = setInterval(refreshLocalStatus, 10000);
      if (!localPollStarted) {
        localPollStarted = true;
        document.addEventListener('visibilitychange', function() {
          if (document.visibilityState === 'visible') refreshLocalStatus();
        });
      }
    }

    async function refreshLocalStatus() {
      if (!LOCAL_MODE) return;
      try {
        const res = await fetch('/aih/local/status', { signal: AbortSignal.timeout(1500) });
        if (!res.ok) throw new Error('status ' + res.status);
        localStatus = await res.json();
      } catch (e) {
        localStatus = { server_reachable: false, pending_sync: 0 };
      }
      updateLocalBadge(localStatus);
    }

    function updateLocalBadge(status) {
      var badge = document.getElementById('aih-mode-badge');
      if (!badge || !status) return;
      if (status.server_reachable) {
        badge.textContent = '🟢 Local — synchro OK';
        badge.style.color = '#86efac';
        badge.style.border = '1px solid rgba(134,239,172,.45)';
      } else if ((status.pending_sync || 0) > 0) {
        badge.textContent = '🟠 Local — ' + status.pending_sync + ' écritures en attente';
        badge.style.color = '#fcd34d';
        badge.style.border = '1px solid rgba(252,211,77,.45)';
      } else {
        badge.textContent = '🔴 Hors ligne';
        badge.style.color = '#fca5a5';
        badge.style.border = '1px solid rgba(252,165,165,.45)';
      }
    }

    async function enterLocalMode() {
      if (LOCAL_MODE) return;
      const ok = await detectLocalMode();  // re-probe
      if (!ok) { apiFailCount = 0; return; }  // toujours indisponible → on retentera
      LOCAL_MODE = true;
      API = '/aih/local/api';
      applyLocalMode();
      try { await checkData(); } catch (e) {}
      if (typeof loadEnhancerConfig === 'function') loadEnhancerConfig();
      if (typeof loadEPState === 'function') loadEPState();
    }

    // Wrapper fetch : compte les echecs des appels vers l'API backend, puis bascule
    // en mode local apres 3 echecs consecutifs (le probe local ne compte jamais).
    (function() {
      const origFetch = window.fetch.bind(window);
      window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        return origFetch(input, init).then(function(res) {
          if (!LOCAL_MODE && url.indexOf('/api') === 0) {
            if (res.ok) apiFailCount = 0;
            else {
              apiFailCount++;
              if (apiFailCount >= 3) enterLocalMode();
            }
          }
          return res;
        }, function(err) {
          if (!LOCAL_MODE && url.indexOf('/api') === 0) {
            apiFailCount++;
            if (apiFailCount >= 3) enterLocalMode();
          }
          throw err;
        });
      };
    })();

    async function safeJson(res) {
      try { return await res.json(); } catch(e) { return { error: 'Erreur serveur ' + res.status }; }
    }

    function updateStats(stats) {
      var parts = [];
      if (stats.total > 0) parts.push(stats.total + ' mots-cles');
      if (stats.section_count > 0) parts.push(stats.section_count + ' sections');
      if (stats.nsfw_total > 0) parts.push(stats.nsfw_total + ' NSFW');
      if (stats.generated_total > 0) parts.push(stats.generated_total + ' prompts generes');
      footerStats.textContent = parts.length > 0 ? parts.join(' · ') : 'Base vide — importez un fichier pour commencer';
    }

    document.addEventListener('DOMContentLoaded', initApp);

    /* ── Main tabs (Prompt Helper / Style / Template / Keywords Manager) ── */
    function switchMainTab(tab) {
      const tabs = {
        prompt: document.getElementById('tab-prompt-helper'),
        style: document.getElementById('tab-styles'),
        template: document.getElementById('tab-templates'),
        keywords: document.getElementById('tab-keywords-manager'),
        preview: document.getElementById('tab-preview')
      };
      const buttons = {
        prompt: document.getElementById('tab-btn-prompt'),
        style: document.getElementById('tab-btn-style'),
        template: document.getElementById('tab-btn-template'),
        keywords: document.getElementById('tab-btn-keywords'),
        preview: document.getElementById('tab-btn-preview')
      };

      Object.keys(tabs).forEach(function(key) {
        if (tabs[key]) {
          if (key === tab) tabs[key].classList.remove('hidden');
          else tabs[key].classList.add('hidden');
        }
      });

      // Arrêter le polling de l'onglet Preview quand on le quitte
      if (tab !== 'preview' && typeof previewStop === 'function') previewStop();

      Object.keys(buttons).forEach(function(key) {
        var btn = buttons[key];
        if (!btn) return;
        if (key === tab) {
          btn.classList.remove('text-white/70', 'hover:text-white', 'hover:bg-white/10');
          btn.classList.add('bg-white/20', 'text-white');
        } else {
          btn.classList.remove('bg-white/20', 'text-white');
          btn.classList.add('text-white/70', 'hover:text-white', 'hover:bg-white/10');
        }
      });

      if (tab === 'style') loadStylesTab();
      if (tab === 'template') loadTemplatesTab();
      if (tab === 'keywords') kwLoadList();
      if (tab === 'preview' && typeof previewStart === 'function') previewStart();
    }

    /* ── Theme system ── */
    function setTheme(name) {
      document.documentElement.setAttribute('data-theme', name);
      localStorage.setItem('theme', name);
    }

    function toggleThemeMode() {
      const html = document.documentElement;
      const isDark = html.classList.toggle('dark');
      localStorage.setItem('theme-mode', isDark ? 'dark' : 'light');
      document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
    }

    function initThemeUI() {
      var sel = document.getElementById('theme-select');
      if (sel) {
        var saved = localStorage.getItem('theme') || 'nord';
        var validThemes = ['solarized','nord','catppuccin','gruvbox','material'];
        if (validThemes.indexOf(saved) === -1) saved = 'nord';
        sel.value = saved;
      }
      document.getElementById('theme-icon').textContent =
        document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
    }

    document.addEventListener('DOMContentLoaded', initThemeUI);

    async function initApp() {
      LOCAL_MODE = await detectLocalMode();  // probe non-bloquant (timeout 1500ms, catch silencieux)
      if (LOCAL_MODE) applyLocalMode();
      else await checkAuth();
      searchInput?.addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(applyFilters, 300); });
      semanticInput?.addEventListener('input', () => { clearTimeout(semanticTimer); semanticTimer = setTimeout(applyFilters, 400); });
      searchNegInput?.addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(applyFilters, 300); });
      // Dropdowns custom (multi-select) — les event listeners sont gérés
      // dans les fonctions toggleSection/toggleSubsection (app-keywords.js).
      // Fermer les dropdowns quand on clique en dehors.
      document.addEventListener('click', function(e) {
        var secMs = document.getElementById('section-multiselect');
        var subMs = document.getElementById('subsection-multiselect');
        if (secMs && !secMs.contains(e.target)) {
          var dd = document.getElementById('section-dropdown');
          if (dd) dd.classList.add('hidden');
        }
        if (subMs && !subMs.contains(e.target)) {
          var dd2 = document.getElementById('subsection-dropdown');
          if (dd2) dd2.classList.add('hidden');
        }
      });
      document.querySelectorAll('input[name="nsfw-filter"]').forEach(el => el.addEventListener('change', function(){ semanticCache = null; applyFilters(); }));
    searchNegInput?.addEventListener('change', function(){ semanticCache = null; });
      var confSlider = document.getElementById('filter-confidence');
      var confNum = document.getElementById('filter-confidence-num');
      function applyConfidence() {
        var n = parseInt(confSlider.value);
        if (isNaN(n)) n = 0;
        if (n < 0) n = 0; if (n > 100) n = 100;
        confSlider.value = n;
        confNum.value = n;
        semanticCache = null;  // forcer un re-fetch avec le nouveau %
        loadKeywords();
      }
      if (confSlider) {
        confSlider.addEventListener('input', function() { confNum.value = this.value; applyConfidence(); });
      }
      if (confNum) {
        confNum.addEventListener('change', function() { confSlider.value = this.value; applyConfidence(); });
      }
      if (currentUser) await checkData();
      if (currentUser) {
        if (typeof loadEnhancerConfig === 'function') loadEnhancerConfig();
        if (typeof loadEPState === 'function') loadEPState();
      }
    }

    // --- Reset functions ---
    function toggleHideKeyword(id) {
      if (hiddenKWs[id]) delete hiddenKWs[id];
      else hiddenKWs[id] = true;
      renderTable(allKeywords);
    }

    function showAllHidden() {
      hiddenKWs = {};
      renderTable(allKeywords);
    }

    function resetFilters() {
      document.getElementById('search-input').value = '';
      document.getElementById('search-neg-input').value = '';
      document.getElementById('search-semantic-input').value = '';
      selectedSections.clear();
      selectedSubsections.clear();
      updateSectionButton();
      updateSubsectionButton();
      // Réinitialiser le dropdown des sous-sections
      var subDd = document.getElementById('subsection-dropdown');
      if (subDd) subDd.innerHTML = '';
      loadSubsections();
      document.querySelectorAll('input[name="nsfw-filter"]').forEach(function(r){ r.checked = r.value === ''; });
      document.getElementById('filter-confidence').value = 0;
      document.getElementById('filter-confidence-num').value = 0;
      semanticCache = null;
      applyFilters();
    }
    function resetElementsPicker() {
      genElements = [];
      genRender();
      saveEPState();
    }
    function resetEnhancer() {
      document.getElementById('enhance-input').value = '';
      document.getElementById('enhance-output').value = '';
      document.getElementById('btn-copy-enhance').classList.add('hidden');
      document.getElementById('btn-toggle-view').classList.add('hidden');
      saveEnhancerSettings();
    }

    function getNsfwFilter() {
      const checked = document.querySelector('input[name="nsfw-filter"]:checked');
      return checked ? checked.value : '';
    }

    async function checkAuth() {
      try {
        const res = await fetch(API + '/auth/me');
        if (res.ok) {
          currentUser = await res.json();
          btnLogin.classList.add('hidden');
          userInfo.classList.remove('hidden');
          userInfo.classList.add('flex');
          userAvatar.src = currentUser.avatar_url;
          userName.textContent = currentUser.display_name;
          if (currentUser.role === 'admin') btnAdmin.classList.remove('hidden');
          else btnAdmin.classList.add('hidden');
          document.getElementById('btn-members').classList.remove('hidden');
          loadLayout();
        } else {
          currentUser = null;
          btnLogin.classList.remove('hidden');
          userInfo.classList.add('hidden');
          userInfo.classList.remove('flex');
        }
        showEmptyState(currentUser !== null);
      } catch {
        currentUser = null;
        showEmptyState(false);
      }
    }

    function showEmptyState(loggedIn) {
      emptyState.classList.remove('hidden');
      emptyState.style.display = 'flex';
      resultsArea.classList.add('hidden');
      var filtersInPanel = document.getElementById('filters-bar');
      if (filtersInPanel) filtersInPanel.classList.add('hidden');
      var mc = document.getElementById('main-content');
      if (mc) mc.style.display = loggedIn ? '' : '';
      var panels = document.getElementById('panels-container');
      if (panels) panels.style.display = loggedIn ? 'flex' : 'none';
      if (loggedIn) {
        emptyTitle.textContent = 'Base de donnees vide';
        emptyDesc.innerHTML = 'Aucun mot-cle pour le moment. Importe un fichier .md pour commencer.';
        emptyBtn.classList.add('hidden');
        emptyImportBtn.classList.remove('hidden');
      } else {
        emptyTitle.textContent = 'Connexion requise';
        emptyDesc.textContent = 'Connecte-toi avec Discord pour acceder aux mots-cles.';
        emptyBtn.classList.remove('hidden');
        emptyImportBtn.classList.add('hidden');
      }
    }

    async function logout() {
      if (typeof previewStop === 'function') previewStop();
      document.getElementById('admin-panel').classList.add('hidden');
      document.getElementById('members-panel').classList.add('hidden');
      document.getElementById('main-content').style.display = 'none';
      btnAdmin.classList.add('hidden');
      document.getElementById('btn-members').classList.add('hidden');
      await fetch(API + '/auth/logout');
      currentUser = null;
      btnLogin.classList.remove('hidden');
      userInfo.classList.add('hidden');
      userInfo.classList.remove('flex');
      showEmptyState(false);
      footerStats.textContent = 'Deconnecte.';
    }

    function discordLogin() {
      const w = 600, h = 700;
      const left = (screen.width - w) / 2;
      const top = (screen.height - h) / 2;
      window.open(API + '/auth/discord/login', 'Discord Login', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',popup=1');
    }

    window.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'auth_success') {
        await checkAuth();
        if (currentUser) await checkData();
      }
    });

    async function checkData() {
      try {
        const res = await fetch(API + '/stats');
        if (!res.ok) throw new Error('Not authorized');
        const stats = await res.json();
        const hasData = (stats.total || 0) > 0;
        updateUIState(hasData, stats);
        if (hasData) {
          document.getElementById('main-content').style.display = '';
          await loadSections();
          await loadKeywords();
        } else {
          showEmptyState(true);
        }
      } catch {
        updateUIState(false, {});
      }
    }

    function updateUIState(hasData, stats) {
      if (hasData) {
        emptyState.classList.add('hidden');
        emptyState.style.display = 'none';
        resultsArea.classList.remove('hidden');
        var filtersInPanel = document.getElementById('filters-bar');
        if (filtersInPanel) filtersInPanel.classList.remove('hidden');
        var panels = document.getElementById('panels-container');
        if (panels) panels.style.display = 'flex';
        updateStats(stats);
      } else {
        emptyState.classList.add('hidden');
        resultsArea.classList.add('hidden');
        var filtersInPanel = document.getElementById('filters-bar');
        if (filtersInPanel) filtersInPanel.classList.add('hidden');
        if (currentUser) footerStats.textContent = 'Connecte : ' + currentUser.display_name;
      }
    }
