
    // === État des sélections multi-select ===
    var selectedSections = new Set();
    var selectedSubsections = new Set();
    var sectionNames = {};  // { id: "I. Title (total)" }
    var subsectionNames = {};  // { id: "I.A — Title (total)" }

    function getSectionParam() {
      return Array.from(selectedSections).join(',');
    }

    function getSubsectionParam() {
      return Array.from(selectedSubsections).join(',');
    }

    function toggleSectionDropdown() {
      var dd = document.getElementById('section-dropdown');
      if (dd) dd.classList.toggle('hidden');
      // Fermer l'autre dropdown
      var subDd = document.getElementById('subsection-dropdown');
      if (subDd) subDd.classList.add('hidden');
    }

    function toggleSubsectionDropdown() {
      var dd = document.getElementById('subsection-dropdown');
      if (dd) dd.classList.toggle('hidden');
      // Fermer l'autre dropdown
      var secDd = document.getElementById('section-dropdown');
      if (secDd) secDd.classList.add('hidden');
    }

    function toggleSection(id, name) {
      if (selectedSections.has(id)) {
        selectedSections.delete(id);
      } else {
        selectedSections.add(id);
      }
      // Mettre à jour la checkbox correspondante dans le dropdown
      var cb = document.querySelector('#section-dropdown input[value="' + CSS.escape(id) + '"]');
      if (cb) cb.checked = selectedSections.has(id);
      updateSectionButton();
      // Les sous-sections dépendent des sections : recharger
      selectedSubsections.clear();
      loadSubsections(getSectionParam()).then(function() {
        updateSubsectionButton();
        semanticCache = null;
        loadKeywords();
      });
    }

    function toggleSubsection(id, name) {
      if (selectedSubsections.has(id)) {
        selectedSubsections.delete(id);
      } else {
        selectedSubsections.add(id);
      }
      var cb = document.querySelector('#subsection-dropdown input[value="' + CSS.escape(id) + '"]');
      if (cb) cb.checked = selectedSubsections.has(id);
      updateSubsectionButton();
      semanticCache = null;
      loadKeywords();
    }

    function updateSectionButton() {
      var label = document.getElementById('section-btn-label');
      if (!label) return;
      if (selectedSections.size === 0) {
        label.textContent = 'Toutes sections';
      } else if (selectedSections.size === 1) {
        var id = Array.from(selectedSections)[0];
        label.textContent = sectionNames[id] || id;
      } else {
        label.textContent = selectedSections.size + ' sections';
      }
    }

    function updateSubsectionButton() {
      var label = document.getElementById('subsection-btn-label');
      if (!label) return;
      if (selectedSubsections.size === 0) {
        label.textContent = 'Toutes sous-sections';
      } else if (selectedSubsections.size === 1) {
        var id = Array.from(selectedSubsections)[0];
        label.textContent = subsectionNames[id] || id;
      } else {
        label.textContent = selectedSubsections.size + ' sous-sections';
      }
    }

    async function loadSections() {
      try {
        const res = await fetch(API + '/sections');
        sectionsList = await res.json();
        sectionNames = {};
        var dd = document.getElementById('section-dropdown');
        if (dd) dd.innerHTML = '';
        for (const sec of sectionsList) {
          var displayName = sec.section_id + '. ' + sec.section_title + ' (' + sec.total + ')';
          sectionNames[sec.section_id] = displayName;
          if (dd) {
            var item = document.createElement('label');
            item.className = 'flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer';
            item.innerHTML = '<input type="checkbox" value="' + escapeHtml(sec.section_id) + '" class="accent-indigo-500 rounded" onchange="toggleSection(\'' + sec.section_id.replace(/'/g, "\\'") + '\')">'
              + '<span class="truncate">' + escapeHtml(displayName) + '</span>';
            dd.appendChild(item);
          }
        }
      } catch { sectionsList = []; }
    }

    async function loadSubsections(sectionParam) {
      try {
        const url = sectionParam ? (API + '/subsections?section=' + encodeURIComponent(sectionParam)) : (API + '/subsections');
        const res = await fetch(url);
        const list = await res.json();
        subsectionNames = {};
        var dd = document.getElementById('subsection-dropdown');
        if (dd) dd.innerHTML = '';
        for (const sub of list) {
          var displayName = sub.subsection_id + ' — ' + sub.subsection_title + ' (' + sub.total + ')';
          subsectionNames[sub.subsection_id] = displayName;
          if (dd) {
            var item = document.createElement('label');
            item.className = 'flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer';
            item.innerHTML = '<input type="checkbox" value="' + escapeHtml(sub.subsection_id) + '" class="accent-indigo-500 rounded" onchange="toggleSubsection(\'' + sub.subsection_id.replace(/'/g, "\\'") + '\')">'
              + '<span class="truncate">' + escapeHtml(displayName) + '</span>';
            dd.appendChild(item);
          }
        }
        return list;
      } catch { return []; }
    }

    async function loadKeywords() {
      const kwLoading = document.getElementById('keywords-loading');
      if (kwLoading) kwLoading.classList.remove('hidden');
      try {
        const textQ = searchInput.value.trim();
      const negQ = searchNegInput.value.trim();
      const semQ = semanticInput.value.trim();
      const nsfw = getNsfwFilter();
      const section = getSectionParam();
      const subsection = getSubsectionParam();
      const confidence = parseFloat(document.getElementById('filter-confidence').value) / 100 || 0;

      let semResults = null;
      if (semQ) {
        if (!semanticCache || semanticCache.text !== semQ || semanticCache.confidence !== confidence || semanticCache.section !== section || semanticCache.subsection !== subsection) {
          semResults = await fetchSemanticSearch(semQ, nsfw, section, subsection, confidence);
          if (semResults) semanticCache = { text: semQ, confidence: confidence, section: section, subsection: subsection, results: semResults };
        } else {
          semResults = semanticCache.results;
        }
      }

      // Appliquer les filtres texte (+) et exclusion (-) aux résultats sémantiques
      if (semResults !== null && (textQ || negQ)) {
        const qLower = textQ.toLowerCase();
        const negLower = negQ.toLowerCase();
        semResults = semResults.filter(function(kw) {
          const fields = [
            (kw.keyword || '').toLowerCase(),
            (kw.description || '').toLowerCase(),
            (kw.section_title || '').toLowerCase(),
            (kw.subsection_title || '').toLowerCase()
          ];
          if (qLower && !fields.some(function(f){ return f.includes(qLower); })) return false;
          if (negLower && fields.some(function(f){ return f.includes(negLower); })) return false;
          return true;
        });
      }

      // Ne pas fetcher l'API texte si la sémantique est active (filtrage fait ci-dessus)
      const [textResults] = await Promise.all([
        (!semQ && (textQ || negQ)) ? fetchTextSearch(textQ, negQ, nsfw, section, subsection) : Promise.resolve(null),
      ]);

      if (semResults !== null) {
        allKeywords = semResults;
      } else if (textResults !== null) {
        allKeywords = textResults;
      } else {
        // Aucune recherche active : charger tout
        try {
          const params = new URLSearchParams();
          if (section) params.append('section', section);
          if (subsection) params.append('subsection', subsection);
          if (nsfw !== '') params.append('nsfw', nsfw);
          const res = await fetch(API + '/keywords?' + params.toString());
          allKeywords = await res.json();
        } catch { allKeywords = []; }
      }
      renderTable(allKeywords);
      } finally {
        if (kwLoading) kwLoading.classList.add('hidden');
      }
    }

    async function fetchTextSearch(q, q_neg, nsfw, section, subsection) {
      try {
        const params = new URLSearchParams();
        params.append('q', q);
        if (q_neg) params.append('q_neg', q_neg);
        if (section) params.append('section', section);
        if (subsection) params.append('subsection', subsection);
        if (nsfw !== '') params.append('nsfw', nsfw);
        const res = await fetch(API + '/keywords?' + params.toString());
        return await res.json();
      } catch { return []; }
    }

    async function fetchSemanticSearch(q, nsfw, section, subsection, confidence) {
      semanticLoading.classList.remove('hidden');
      try {
        const params = new URLSearchParams();
        params.append('q', q);
        params.append('limit', '500');
        if (section) params.append('section', section);
        if (subsection) params.append('subsection', subsection);
        if (nsfw !== '') params.append('nsfw', nsfw);
        if (confidence > 0) params.append('confidence', confidence);
        const res = await fetch(API + '/search/semantic?' + params.toString());
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur ' + res.status);
        }
        return await res.json();
      } catch (err) {
        console.error('Semantic search error:', err);
        return [];
      } finally {
        semanticLoading.classList.add('hidden');
      }
    }

    function applyFilters(preserveHidden) {
      if (!preserveHidden) hiddenKWs = {};
      loadKeywords();
    }

    function renderTable(rows) {
      tableBody.innerHTML = '';
      const isSemantic = semanticInput.value.trim() !== '';
      scoreHeader.classList.toggle('hidden', !isSemantic);
      // Filtrer les mots masques localement
      var hiddenCount = rows.filter(function(r){ return hiddenKWs[r.id]; }).length;
      if (rows.length === 0) {
        const colspan = isSemantic ? 4 : 3;
        tableBody.innerHTML = '<tr><td colspan="' + colspan + '" class="px-4 py-10 text-center text-slate-400 dark:text-slate-500">Aucun resultat trouve.</td></tr>';
        countDisplay.textContent = '0';
        countLabel.textContent = 'resultat';
        return;
      }
      if (hiddenCount === rows.length) {
        const colspan = isSemantic ? 4 : 3;
        tableBody.innerHTML = '<tr><td colspan="' + colspan + '" class="px-4 py-8 text-center text-sm text-slate-400">Tous les mots-cles sont masques. <button onclick="showAllHidden()" class="text-indigo-500 hover:underline">Tout reafficher</button></td></tr>';
        countDisplay.textContent = '0';
        countLabel.textContent = 'resultat (masques)';
        return;
      }
      const frag = document.createDocumentFragment();
      const isDark = document.documentElement.classList.contains('dark');
      var hiddenCount = 0;
      for (const row of rows) {
        var isHidden = !!hiddenKWs[row.id];
        if (isHidden) hiddenCount++;
        const tr = document.createElement('tr');
        tr.className = row.nsfw ? (isDark ? 'bg-rose-950/30' : 'bg-rose-50/40') : '';
        if (isHidden) tr.className += ' opacity-40 line-through decoration-1 decoration-slate-400';
        const nsfwClass = row.nsfw
          ? (isDark ? 'bg-rose-900/50 text-rose-300' : 'bg-rose-100 text-rose-700')
          : (isDark ? 'bg-slate-700 text-indigo-300' : 'bg-slate-100 text-indigo-600');
        const pct = Math.round((row.score || 0) * 100);
        const scoreTd = isSemantic
          ? '<td class="px-4 py-2 align-top w-24"><div class="score-bar' + (isDark ? ' bg-slate-700' : '') + '"><div class="score-bar-fill" style="width:' + pct + '%"></div></div><span class="text-xs text-slate-400 dark:text-slate-500">' + pct + '%</span></td>'
          : '';
        tr.innerHTML = '<td class="px-4 py-2 align-top"><div class="flex items-center gap-1"><button onclick="toggleHideKeyword(' + row.id + ')" title="' + (isHidden ? 'Reafficher' : 'Masquer') + '" class="text-xs transition p-0.5 leading-none ' + (isHidden ? 'text-rose-400' : 'text-slate-300 hover:text-rose-400') + '">' + (isHidden ? '🙈' : '👁️') + '</button><code class="text-xs font-mono px-1.5 py-0.5 rounded ' + nsfwClass + '">' + escapeHtml(row.keyword) + '</code></div></td>'
          + '<td class="px-4 py-2 text-slate-700 align-top dark:text-slate-300">' + escapeHtml(row.description) + '</td>'
          + '<td class="px-4 py-2 text-xs text-slate-500 align-top dark:text-slate-400 max-w-[160px]"><div class="font-medium text-slate-600 dark:text-slate-300 truncate">' + escapeHtml(row.subsection_title) + '</div><div class="text-slate-400 mt-0.5 dark:text-slate-500 truncate">' + escapeHtml(row.section_id) + '. ' + escapeHtml(row.section_title) + '</div></td>'
          + scoreTd;
        frag.appendChild(tr);
      }
      tableBody.appendChild(frag);
      initColResize();
      loadColWidths();
      countDisplay.textContent = rows.length - hiddenCount;
      countLabel.textContent = (rows.length - hiddenCount > 1 ? ' visibles' : ' visible') + (hiddenCount > 0 ? ' (+ ' + hiddenCount + ' masques)' : '');
    }

    function escapeHtml(str) {
      if (typeof str !== 'string') return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }    function escapeHtml(str) {
      if (typeof str !== 'string') return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }




    // === Elements Picker ===
    var genElementId = 0;
    var genElements = [];
    var genFilters = [];

    function genAddElement(type) {
      type = type || '';
      var id = ++genElementId;
      genElements.push({id: id, type: type, filterId: null, text: '', filterName: ''});
      genRender();
      if (type === 'filter') openFilterPick(id);
      if (type === 'text') openSemanticModal(id);
      saveEPState();
    }

    function genRemoveElement(id) {
      genElements = genElements.filter(function(e){ return e.id !== id; });
      genRender();
      saveEPState();
    }

    function genRender() {
      var container = document.getElementById('gen-elements');
      var html = '';
      if (genElements.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Ajoute un element via les boutons ci-dessous</p>';
        document.getElementById('gen-count').textContent = '0';
      } else {
        for (var i = 0; i < genElements.length; i++) {
          var el = genElements[i];
          html += '<div class="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-700/30 rounded p-1.5">';
          if (el.type === 'filter' && el.filterId) {
            html += '<span class="flex-1 text-xs text-indigo-600 dark:text-indigo-400 truncate">' + escapeHtml(el.filterName) + '</span>';
            html += '<button onclick="previewFilterCache(' + el.filterId + ')" class="text-xs text-slate-300 hover:text-indigo-400 p-0.5" title="Voir le cache">📊</button>';
            html += '<button onclick="genChangeType(' + el.id + ')" class="text-xs text-slate-400 hover:text-slate-600 p-0.5" title="Changer">↻</button>';
          } else if (el.type === 'text' && el.text) {
            html += '<span class="flex-1 text-xs text-emerald-600 dark:text-emerald-400 truncate">"' + escapeHtml(el.text).replace(/"/g, '&quot;') + '"</span>';
            html += '<button onclick="genChangeType(' + el.id + ')" class="text-xs text-slate-400 hover:text-slate-600 p-0.5" title="Changer">↻</button>';
          } else {
            html += '<span class="flex-1 text-xs text-slate-400 italic">En attente...</span>';
          }
          html += '<button onclick="genRemoveElement(' + el.id + ')" class="text-xs text-rose-400 hover:text-rose-300 p-1" title="Supprimer">&times;</button>';
          html += '</div>';
        }
        container.innerHTML = html;
        document.getElementById('gen-count').textContent = genElements.length;
      }
    }

    function genChangeType(id) {
      for (var i = 0; i < genElements.length; i++) {
        if (genElements[i].id === id) {
          genElements[i].type = '';
          genElements[i].filterId = null;
          genElements[i].text = '';
          genElements[i].filterName = '';
          break;
        }
      }
      genRender();
      saveEPState();
    }

    // Modal pour le texte semantique
    function openSemanticModal(elId) {
      showPrompt('Texte libre', 'Recherche semantique (mot ou phrase) :', 'ex: pose dynamique', function(txt){
        if (txt) {
          for (var i = 0; i < genElements.length; i++) {
            if (genElements[i].id === elId) { genElements[i].text = txt.trim(); break; }
          }
        } else {
          genElements = genElements.filter(function(e){ return e.id !== elId; });
        }
        genRender();
        saveEPState();
      });
    }

    // Persistance Elements Picker
    async function saveEPState() {
      if (LOCAL_MODE || !currentUser) return;   // /settings indisponible en local
      var s = currentUser.settings || {};
      s.genElements = genElements.map(function(e){ return {type: e.type, filterId: e.filterId, text: e.text, filterName: e.filterName}; });
      try {
        await fetch(API + '/settings', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(s)
        });
        currentUser.settings = s;
      } catch (e) {}
    }

    function loadEPState() {
      if (currentUser && currentUser.settings && currentUser.settings.genElements) {
        var saved = currentUser.settings.genElements;
        genElements = [];
        saved.forEach(function(e) {
          genElements.push({id: ++genElementId, type: e.type || '', filterId: e.filterId || null, text: e.text || '', filterName: e.filterName || ''});
        });
        genRender();
      }
    }

    // Filter picker modal
    var fpTargetId = null;

    function openFilterPick(elementId) {
      fpTargetId = elementId;
      document.getElementById('modal-filter-pick').classList.remove('hidden');
      document.getElementById('modal-filter-pick').classList.add('flex');
      makeModalDraggable('fp-modal-header', 'fp-modal');
      loadFilterList();
    }

    function closeFilterPick() {
      var target = fpTargetId;
      fpTargetId = null;
      document.getElementById('modal-filter-pick').classList.add('hidden');
      document.getElementById('modal-filter-pick').classList.remove('flex');
      // Si l'utilisateur ferme sans choisir, enlever l'element
      for (var i = 0; i < genElements.length; i++) {
        if (genElements[i].id === target && !genElements[i].filterId) {
          genElements.splice(i, 1);
          genRender();
          saveEPState();
          break;
        }
      }
    }

    async function loadFilterList() {
      var owner = document.getElementById('fp-owner').value;
      var nsfw = document.getElementById('fp-nsfw').value;
      try {
        var res = await fetch(API + '/filters');
        if (!res.ok) return;
        var all = await res.json();
        var filtered = all.filter(function(f) {
          if (owner === 'mine' && f.user_id !== (currentUser ? currentUser.id : '')) return false;
          if (nsfw !== '' && f.nsfw !== parseInt(nsfw)) return false;
          return true;
        });
        var list = document.getElementById('fp-list');
        list.innerHTML = filtered.map(function(f) {
          var badge = f.nsfw ? '<span class="text-xs text-rose-400">NSFW</span>' : '<span class="text-xs text-emerald-400">SFW</span>';
          var pub = f.is_public ? '<span class="text-xs text-slate-400">public</span>' : '';
          var typeTag = f.filter_type === 'union' ? '<span class="text-xs text-amber-500 font-medium">[Union]</span> ' : '';
          return '<div class="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer" onclick="pickFilter(' + f.id + ',\'' + escapeHtml(f.name).replace(/'/g,"\\'") + '\')">'
            + typeTag + '<span class="flex-1 text-slate-700 dark:text-slate-300">' + escapeHtml(f.name) + '</span>'
            + badge + ' ' + pub
            + '</div>';
        }).join('');
        if (filtered.length === 0) {
          list.innerHTML = '<p class="text-slate-400 text-center">Aucun filtre trouve</p>';
        }
      } catch {}
    }

    function pickFilter(filterId, name) {
      if (fpTargetId === -1) {
        // Mode "charger" depuis les filtres
        loadFilterIntoPanel(filterId);
      } else {
        // Mode "choisir" pour le generateur
        for (var i = 0; i < genElements.length; i++) {
          if (genElements[i].id === fpTargetId) {
            genElements[i].filterId = filterId;
            genElements[i].filterName = name;
            break;
          }
        }
        closeFilterPick();
        genRender();
        saveEPState();
      }
    }

    // Generation
    async function genGenerate() {
      if (LOCAL_MODE) { showModal('Generateur', 'Indisponible en mode local', 'error'); return; }
      var items = [];
      for (var i = 0; i < genElements.length; i++) {
        var el = genElements[i];
        if (el.type === 'filter' && el.filterId) items.push({type: 'filter', id: el.filterId});
        else if (el.type === 'text' && el.text) items.push({type: 'text', text: el.text});
      }
      if (items.length === 0) { showModal('Elements Picker', 'Ajoute un element (saved filter ou semantic) avant de generer', 'error'); return; }

      try {
        var res = await fetch(API + '/generate', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({elements: items})
        });
        if (!res.ok) {
          var err = await res.json().catch(function(){ return {}; });
          showModal('Erreur', err.error || 'Generation impossible', 'error');
          return;
        }
        var data = await res.json();
        var output = data.prompt;
        if (data.count === 0) output = '(aucun mot-cle trouve : verifie les filtres et le cache)';
        document.getElementById('gen-output').value = output;
        document.getElementById('gen-count').textContent = data.count;
      } catch (err) {
        showModal('Erreur', err.message || 'Une erreur est survenue', 'error');
      }
    }

    function genCopy() {
      var ta = document.getElementById('gen-output');
      ta.select();
      document.execCommand('copy');
    }

    function esc(str) {
      if (typeof str !== 'string') return '';
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }


// ── Keywords Manager ─────────────────────────────────────────────

let kwEditingId = null;
let kwSelectedIds = new Set();
let kwLastClickedId = null;
let kwCurrentList = [];
let _kwSectionsCache = [];
let _kwSubsectionsCache = [];
let isKwEditor = false;
let _kwAuthorsCache = [];

// ── Roman numeral helpers for auto section IDs ──

function _romanToNum(s) {
    var roman = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000};
    var n = 0;
    for (var i = 0; i < s.length; i++) {
        var cur = roman[s[i]] || 0;
        var next = roman[s[i+1]] || 0;
        if (cur < next) n -= cur; else n += cur;
    }
    return n;
}

function _numToRoman(num) {
    var vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    var syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
    var r = '';
    for (var i = 0; i < vals.length; i++) {
        while (num >= vals[i]) { r += syms[i]; num -= vals[i]; }
    }
    return r;
}

// ── Section/subsection combobox logic ──

function _resolveSectionId(title) {
    if (!title) return {id: '', title: ''};
    var found = _kwSectionsCache.find(function(s) { return s.section_title.toLowerCase() === title.toLowerCase(); });
    if (found) return {id: found.section_id, title: found.section_title};
    var maxNum = 0;
    _kwSectionsCache.forEach(function(s) { var n = _romanToNum(s.section_id); if (n > maxNum) maxNum = n; });
    return {id: _numToRoman(maxNum + 1), title: title.trim()};
}

function _resolveSubsectionId(title, sectionId) {
    if (!title) return {id: '', title: ''};
    var found = _kwSubsectionsCache.find(function(s) {
        return s.subsection_title.toLowerCase() === title.toLowerCase() &&
               (!sectionId || (s.subsection_id && s.subsection_id.startsWith(sectionId + '.')));
    });
    if (found) return {id: found.subsection_id, title: found.subsection_title};
    if (sectionId) {
        var existing = _kwSubsectionsCache.filter(function(s) { return s.subsection_id && s.subsection_id.startsWith(sectionId + '.'); });
        var nextLetter = 'A';
        if (existing.length > 0) {
            var lastLetter = existing.map(function(s) { return s.subsection_id.split('.')[1] || 'A'; }).sort().pop();
            nextLetter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);
        }
        return {id: sectionId + '.' + nextLetter, title: title.trim()};
    }
    return {id: '', title: title.trim()};
}

function kwRefreshSubsectionCombo(sectionId) {
    var dl = document.getElementById('kw-subsection-combo');
    if (!dl) return;
    dl.innerHTML = '';
    var subs = sectionId
        ? _kwSubsectionsCache.filter(function(s) { return s.subsection_id && s.subsection_id.startsWith(sectionId + '.'); })
        : _kwSubsectionsCache;
    subs.forEach(function(sub) {
        var opt = document.createElement('option');
        opt.value = sub.subsection_title;
        opt.textContent = sub.subsection_id + ' — ' + sub.subsection_title;
        dl.appendChild(opt);
    });
}

// ── Modale combobox handlers ──

function kwModalOnSectionChange() {
    var title = document.getElementById('kw-modal-section').value.trim();
    var res = _resolveSectionId(title);
    document.getElementById('kw-modal-section-id').value = res.id;
    document.getElementById('kw-modal-section-title').value = res.title;
    kwRefreshSubsectionCombo(res.id);
}

function kwModalOnSubsectionChange() {
    var title = document.getElementById('kw-modal-subsection').value.trim();
    var sectionId = document.getElementById('kw-modal-section-id').value;
    var res = _resolveSubsectionId(title, sectionId);
    document.getElementById('kw-modal-subsection-id').value = res.id;
    document.getElementById('kw-modal-subsection-title').value = res.title;
}

// ── Data loading ──

function kwLoadList() {
    const search = document.getElementById('kw-filter-search').value.trim();
    const section = document.getElementById('kw-filter-section').value;
    const author = document.getElementById('kw-filter-author').value;

    // Checkboxes NSFW
    var sfwChecked = document.getElementById('kw-filter-sfw').checked;
    var nsfwChecked = document.getElementById('kw-filter-nsfw').checked;
    var nsfwParam = '';
    if (sfwChecked && !nsfwChecked) nsfwParam = '0';
    else if (!sfwChecked && nsfwChecked) nsfwParam = '1';
    // both checked or both unchecked = no filter

    // Checkboxes privacy/scope
    var privacyParts = [];
    if (document.getElementById('kw-filter-public').checked) privacyParts.push('public');
    if (document.getElementById('kw-filter-private').checked) privacyParts.push('private');
    if (document.getElementById('kw-filter-pending').checked) privacyParts.push('public_pending');
    var privacyParam = privacyParts.join(',');
    var mineParam = document.getElementById('kw-filter-mine').checked ? '1' : '';

    // Réinitialiser la sélection
    kwSelectedIds.clear();
    kwLastClickedId = null;
    _kwDirtyIds.clear();
    kwUpdateSelectUI();

    const params = new URLSearchParams();
    if (search) params.append('q', search);
    if (section) params.append('section', section);
    if (nsfwParam !== '') params.append('nsfw', nsfwParam);
    if (author) params.append('author', author);
    if (privacyParam) params.append('privacy', privacyParam);
    if (mineParam) params.append('mine', mineParam);

    // Charger les sections + sous-sections + auteurs pour les filtres/datalists
    Promise.all([
        fetch(API + '/sections').then(r => r.json()).catch(() => []),
        fetch(API + '/subsections').then(r => r.json()).catch(() => []),
        fetch(API + '/keywords/authors').then(r => r.json()).catch(() => [])
    ]).then(([sections, subs, authors]) => {
        _kwSectionsCache = sections;
        _kwSubsectionsCache = subs;
        _kwAuthorsCache = authors;

        // Dropdown sections
        const secSel = document.getElementById('kw-filter-section');
        const secVal = secSel.value;
        secSel.innerHTML = '<option value="">Toutes sections</option>';
        sections.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.section_id;
            opt.textContent = s.section_id + '. ' + s.section_title;
            secSel.appendChild(opt);
        });
        secSel.value = secVal;

        // Datalist section combobox (for modal)
        var dlSec = document.getElementById('kw-section-combo');
        dlSec.innerHTML = '';
        sections.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s.section_title;
            opt.textContent = s.section_id + '. ' + s.section_title;
            dlSec.appendChild(opt);
        });

        // Datalist subsection combobox
        var dlSub = document.getElementById('kw-subsection-combo');
        dlSub.innerHTML = '';
        subs.forEach(function(sub) {
            var opt = document.createElement('option');
            opt.value = sub.subsection_title;
            opt.textContent = sub.subsection_id + ' — ' + sub.subsection_title;
            dlSub.appendChild(opt);
        });

        // Dropdown authors
        const authSel = document.getElementById('kw-filter-author');
        const authVal = authSel.value;
        authSel.innerHTML = '<option value="">Tous auteurs</option>';
        authors.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.user_id;
            opt.textContent = a.display_name || a.username || a.user_id;
            authSel.appendChild(opt);
        });
        authSel.value = authVal;

        // Charger les keywords
        const tbody = document.getElementById('kw-table-body');
        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-4 text-center text-slate-400">Chargement...</td></tr>';

        fetch(API + '/keywords?' + params.toString())
            .then(r => r.json())
            .then(data => { renderKwList(data); })
            .catch(() => { tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-4 text-center text-rose-400">Erreur de chargement</td></tr>'; });
    });

    // Vérifier le statut kw_editor
    checkKwEditorStatus();
}

// ── Dirty tracking (modifié non sauvegardé) ──

var _kwDirtyIds = new Set();

function _kwMarkDirty(kwId) {
    _kwDirtyIds.add(kwId);
    var tr = document.getElementById('kw-tr-' + kwId);
    if (tr) {
        tr.classList.add('border-l-4', 'border-l-amber-400');
        tr.classList.remove('border-l-4', 'border-l-transparent');
    }
}

function _kwClearDirty(kwId) {
    _kwDirtyIds.delete(kwId);
    var tr = document.getElementById('kw-tr-' + kwId);
    if (tr) {
        tr.classList.remove('border-l-amber-400');
        tr.classList.add('border-l-transparent');
    }
}

// ── Column resize for kw-table ──

var _kwColResize = null;

function kwInitColResize() {
    var headers = document.querySelectorAll('#kw-table-header-row th');
    headers.forEach(function(th, idx) {
        if (idx === headers.length - 1) return;
        if (th.querySelector('.col-resize-handle')) return;
        var handle = document.createElement('div');
        handle.className = 'col-resize-handle';
        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            var next = headers[idx + 1];
            _kwColResize = {
                th: th, nextTh: next,
                startX: e.clientX,
                w: th.offsetWidth,
                wNext: next.offsetWidth,
                idx: idx
            };
            document.body.classList.add('col-resizing');
        }, true);
        th.appendChild(handle);
    });
}

document.addEventListener('mousemove', function(e) {
    if (!_kwColResize) return;
    var dx = e.clientX - _kwColResize.startX;
    var w = Math.max(40, _kwColResize.w + dx);
    var wNext = Math.max(40, _kwColResize.wNext - dx);
    _kwColResize.th.style.width = w + 'px';
    _kwColResize.nextTh.style.width = wNext + 'px';
    var rows = document.querySelectorAll('#kw-table-body tr');
    for (var r = 0; r < rows.length; r++) {
        var tds = rows[r].children;
        if (tds[_kwColResize.idx]) tds[_kwColResize.idx].style.width = w + 'px';
        if (tds[_kwColResize.idx + 1]) tds[_kwColResize.idx + 1].style.width = wNext + 'px';
    }
});

document.addEventListener('mouseup', function() {
    if (_kwColResize) {
        _kwColResize = null;
        document.body.classList.remove('col-resizing');
        kwSaveColWidths();
    }
});

function kwSaveColWidths() {
    if (LOCAL_MODE || !currentUser) return;   // /settings indisponible en local
    var headers = document.querySelectorAll('#kw-table-header-row th');
    var widths = {};
    var labels = ['checkbox', 'keyword', 'description', 'section', 'subsection', 'nsfw', 'status', 'actions'];
    headers.forEach(function(th, idx) {
        widths[labels[idx] || ('col' + idx)] = th.offsetWidth;
    });
    var settings = (currentUser.settings || {});
    settings.kwManagerColumns = widths;
    fetch(API + '/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(settings)
    }).catch(function(){});
}

function kwLoadColWidths() {
    if (!currentUser || !currentUser.settings || !currentUser.settings.kwManagerColumns) return;
    var headers = document.querySelectorAll('#kw-table-header-row th');
    var cols = currentUser.settings.kwManagerColumns;
    var labels = ['checkbox', 'keyword', 'description', 'section', 'subsection', 'nsfw', 'status', 'actions'];
    headers.forEach(function(th, idx) {
        var w = cols[labels[idx]];
        if (w && w > 30) {
            th.style.width = w + 'px';
            var rows = document.querySelectorAll('#kw-table-body tr');
            for (var r = 0; r < rows.length; r++) {
                var td = rows[r].children[idx];
                if (td) td.style.width = w + 'px';
            }
        }
    });
}

// ── Render : tableau avec édition directe (1 ligne par keyword) ──

function renderKwList(keywords) {
    const tbody = document.getElementById('kw-table-body');
    kwCurrentList = keywords || [];
    if (!keywords || keywords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">Aucun mot-clé trouvé</td></tr>';
        document.getElementById('kw-select-toolbar').classList.add('hidden');
        return;
    }
    document.getElementById('kw-select-toolbar').classList.remove('hidden');
    tbody.innerHTML = '';
    var isDark = document.documentElement.classList.contains('dark');

    keywords.forEach(kw => {
        const isSelected = kwSelectedIds.has(kw.id);
        const canEdit = (kw.user_id === (currentUser ? currentUser.id : '')) || isKwEditor;
        const isOwner = (kw.user_id === (currentUser ? currentUser.id : ''));
        const canDelete = isOwner || isKwEditor;
        const isPending = kw.privacy_status === 'public_pending';

        var tr = document.createElement('tr');
        tr.id = 'kw-tr-' + kw.id;
        tr.dataset.kwId = kw.id;
        tr.className = 'border-b border-slate-100 dark:border-slate-700 border-l-4 border-l-transparent transition';
        if (kw.nsfw) tr.className += isDark ? ' bg-rose-950/20' : ' bg-rose-50/30';
        if (isSelected) tr.className += ' bg-indigo-50 dark:bg-indigo-900/20';

        // ── Col 0: Checkbox ──
        var tdCb = document.createElement('td');
        tdCb.className = 'px-1 py-1 text-center';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isSelected;
        cb.className = 'kw-row-cb cursor-pointer rounded';
        cb.onclick = function(e) { e.stopPropagation(); kwToggleSelection(kw.id, e); };
        tdCb.appendChild(cb);
        tr.appendChild(tdCb);

        // Row click for shift+click selection (ignorer les inputs/boutons)
        tr.onclick = function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
            kwToggleSelection(kw.id, e);
        };

        // ── Col 1: Keyword ──
        var tdKw = document.createElement('td');
        tdKw.className = 'px-2 py-1';
        var kwInput = document.createElement('input');
        kwInput.type = 'text';
        kwInput.value = kw.keyword || '';
        kwInput.className = 'w-full px-1.5 py-0.5 text-xs font-medium border border-transparent rounded hover:border-slate-300 dark:bg-transparent dark:hover:border-slate-600 dark:text-slate-200 focus:border-indigo-400 focus:dark:border-indigo-500 focus:outline-none';
        if (!canEdit) { kwInput.disabled = true; kwInput.className += ' opacity-70'; }
        kwInput.id = 'kw-row-kw-' + kw.id;
        tdKw.appendChild(kwInput);
        tr.appendChild(tdKw);

        // ── Col 2: Description ──
        var tdDesc = document.createElement('td');
        tdDesc.className = 'px-2 py-1';
        var descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.value = kw.description || '';
        descInput.className = 'w-full px-1.5 py-0.5 text-xs border border-transparent rounded hover:border-slate-300 dark:bg-transparent dark:hover:border-slate-600 dark:text-slate-300 focus:border-indigo-400 focus:dark:border-indigo-500 focus:outline-none';
        if (!canEdit) { descInput.disabled = true; descInput.className += ' opacity-70'; }
        descInput.id = 'kw-row-desc-' + kw.id;
        tdDesc.appendChild(descInput);
        tr.appendChild(tdDesc);

        // ── Col 3: Section ──
        var tdSec = document.createElement('td');
        tdSec.className = 'px-2 py-1';
        var secInput = document.createElement('input');
        secInput.type = 'text';
        secInput.value = kw.section_title || '';
        secInput.setAttribute('list', 'kw-section-combo');
        secInput.className = 'w-full px-1.5 py-0.5 text-xs border border-transparent rounded hover:border-slate-300 dark:bg-transparent dark:hover:border-slate-600 dark:text-slate-300 focus:border-indigo-400 focus:dark:border-indigo-500 focus:outline-none';
        if (!canEdit) { secInput.disabled = true; secInput.className += ' opacity-70'; }
        secInput.id = 'kw-row-sec-' + kw.id;
        secInput.onchange = function() {
            var res = _resolveSectionId(secInput.value.trim());
            document.getElementById('kw-row-secid-' + kw.id).value = res.id;
            document.getElementById('kw-row-sectitle-' + kw.id).value = res.title;
            kwRefreshSubsectionCombo(res.id);
        };
        tdSec.appendChild(secInput);
        tr.appendChild(tdSec);

        // ── Col 4: Subsection ──
        var tdSub = document.createElement('td');
        tdSub.className = 'px-2 py-1';
        var subInput = document.createElement('input');
        subInput.type = 'text';
        subInput.value = kw.subsection_title || '';
        subInput.setAttribute('list', 'kw-subsection-combo');
        subInput.className = 'w-full px-1.5 py-0.5 text-xs border border-transparent rounded hover:border-slate-300 dark:bg-transparent dark:hover:border-slate-600 dark:text-slate-300 focus:border-indigo-400 focus:dark:border-indigo-500 focus:outline-none';
        if (!canEdit) { subInput.disabled = true; subInput.className += ' opacity-70'; }
        subInput.id = 'kw-row-sub-' + kw.id;
        subInput.onchange = function() {
            var sectionId = document.getElementById('kw-row-secid-' + kw.id).value;
            var res = _resolveSubsectionId(subInput.value.trim(), sectionId);
            document.getElementById('kw-row-subid-' + kw.id).value = res.id;
            document.getElementById('kw-row-subtitle-' + kw.id).value = res.title;
        };
        tdSub.appendChild(subInput);
        tr.appendChild(tdSub);

        // Hidden fields
        ['secid', 'sectitle', 'subid', 'subtitle'].forEach(function(suffix) {
            var h = document.createElement('input');
            h.type = 'hidden';
            h.id = 'kw-row-' + suffix + '-' + kw.id;
            var fieldMap = {'secid': 'section_id', 'sectitle': 'section_title', 'subid': 'subsection_id', 'subtitle': 'subsection_title'};
            h.value = kw[fieldMap[suffix]] || '';
            tr.appendChild(h);
        });

        // ── Col 5: NSFW ──
        var tdNsfw = document.createElement('td');
        tdNsfw.className = 'px-1 py-1 text-center';
        var nsfwCb = document.createElement('input');
        nsfwCb.type = 'checkbox';
        nsfwCb.checked = !!kw.nsfw;
        nsfwCb.className = 'rounded cursor-pointer';
        nsfwCb.id = 'kw-row-nsfw-' + kw.id;
        nsfwCb.disabled = !canEdit;
        tdNsfw.appendChild(nsfwCb);
        tr.appendChild(tdNsfw);

        // ── Col 6: Privacy ──
        var tdPriv = document.createElement('td');
        tdPriv.className = 'px-1 py-1 text-center';
        var privSel = document.createElement('select');
        privSel.className = 'text-xs px-1 py-0.5 border border-transparent rounded dark:bg-transparent dark:text-slate-300 focus:outline-none focus:border-indigo-400';
        privSel.id = 'kw-row-priv-' + kw.id;
        privSel.disabled = !canEdit;
        privSel.innerHTML = '<option value="private">🔒</option><option value="public_pending">🟡</option><option value="public">🌐</option>';
        privSel.value = kw.privacy_status || 'private';
        if (!isKwEditor) privSel.querySelector('option[value="public"]').disabled = true;
        tdPriv.appendChild(privSel);
        tr.appendChild(tdPriv);

        // ── Col 7: Actions ──
        var tdAct = document.createElement('td');
        tdAct.className = 'px-1 py-1 text-center whitespace-nowrap';

        // Pending: approve/reject
        if (isPending && isKwEditor) {
            var apBtn = document.createElement('button');
            apBtn.textContent = '✅';
            apBtn.className = 'px-1 py-0.5 text-xs rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition';
            apBtn.title = 'Valider (avec modifications)';
            apBtn.onclick = function(e) { e.stopPropagation(); kwInlineReview(kw.id, 'approve'); };
            tdAct.appendChild(apBtn);

            var rjBtn = document.createElement('button');
            rjBtn.textContent = '❌';
            rjBtn.className = 'px-1 py-0.5 text-xs rounded hover:bg-rose-100 dark:hover:bg-rose-900/30 transition';
            rjBtn.title = 'Rejeter';
            rjBtn.onclick = function(e) { e.stopPropagation(); kwInlineReview(kw.id, 'reject'); };
            tdAct.appendChild(rjBtn);
        }

        // Save
        if (canEdit) {
            var saveBtn = document.createElement('button');
            saveBtn.textContent = '💾';
            saveBtn.className = 'px-1 py-0.5 text-xs rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition';
            saveBtn.title = 'Sauvegarder (Ctrl+Enter)';
            saveBtn.onclick = function(e) { e.stopPropagation(); kwInlineSave(kw.id); };
            tdAct.appendChild(saveBtn);
        }

        // Delete
        if (canDelete) {
            var delBtn = document.createElement('button');
            delBtn.textContent = '🗑';
            delBtn.className = 'px-1 py-0.5 text-xs rounded hover:bg-rose-100 dark:hover:bg-rose-900/30 transition';
            delBtn.title = 'Supprimer';
            delBtn.onclick = function(e) { e.stopPropagation(); kwDelete(kw.id); };
            tdAct.appendChild(delBtn);
        }

        tr.appendChild(tdAct);

        // Dirty tracking + Ctrl+Enter
        if (canEdit) {
            [kwInput, descInput, secInput, subInput].forEach(function(el) {
                el.addEventListener('input', function() { _kwMarkDirty(kw.id); });
                el.addEventListener('keydown', function(e) {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        kwInlineSave(kw.id);
                    }
                });
            });
            nsfwCb.addEventListener('change', function() { _kwMarkDirty(kw.id); });
            privSel.addEventListener('change', function() { _kwMarkDirty(kw.id); });
        }

        tbody.appendChild(tr);
    });

    // Init column resize + load saved widths
    kwInitColResize();
    kwLoadColWidths();
    kwUpdateSelectUI();
}

// ── Inline save (lit les champs de la ligne) ──

async function kwInlineSave(kwId) {
    if (LOCAL_MODE) { showModal('Mot-clé', 'Modification indisponible en mode local', 'error'); return; }
    var keyword = document.getElementById('kw-row-kw-' + kwId).value.trim();
    var description = document.getElementById('kw-row-desc-' + kwId).value.trim();
    var section_id = document.getElementById('kw-row-secid-' + kwId).value.trim();
    var section_title = document.getElementById('kw-row-sectitle-' + kwId).value.trim();
    var subsection_id = document.getElementById('kw-row-subid-' + kwId).value.trim();
    var subsection_title = document.getElementById('kw-row-subtitle-' + kwId).value.trim();
    var nsfw = document.getElementById('kw-row-nsfw-' + kwId).checked ? 1 : 0;
    var privacy = document.getElementById('kw-row-priv-' + kwId).value;

    if (!keyword || !description) {
        showModal('Erreur', 'Mot-clé et description requis', 'error');
        return;
    }

    try {
        var res = await fetch(API + '/keywords/' + kwId, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({keyword, description, section_id, section_title, subsection_id, subsection_title, nsfw, privacy_status: privacy})
        });
        var data = await safeJson(res);
        if (!res.ok) { showModal('Erreur', data.error || 'Erreur', 'error'); return; }
        showModal('Succès', 'Mot-clé mis à jour', 'success');
        _kwClearDirty(kwId);
        kwLoadList();
    } catch(e) { showModal('Erreur', e.message, 'error'); }
}

// ── Quick review (approve/reject without editing) ──

async function kwQuickReview(kwId, action) {
    if (LOCAL_MODE) { showModal('Mot-clé', 'Validation indisponible en mode local', 'error'); return; }
    try {
        var res = await fetch(API + '/keywords/' + kwId + '/review', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: action})
        });
        if (res.ok) {
            showModal('Succès', action === 'approve' ? 'Mot-clé validé' : 'Mot-clé rejeté', 'success');
            kwLoadList();
        } else {
            var data = await safeJson(res);
            showModal('Erreur', data.error || 'Erreur', 'error');
        }
    } catch(e) { showModal('Erreur', e.message, 'error'); }
}

// ── Inline review (approve/reject with edits from the row) ──

async function kwInlineReview(kwId, action) {
    if (LOCAL_MODE) { showModal('Mot-clé', 'Validation indisponible en mode local', 'error'); return; }
    var edits = {};
    var kwEl = document.getElementById('kw-row-kw-' + kwId);
    if (!kwEl) { kwQuickReview(kwId, action); return; }
    edits.keyword = kwEl.value.trim();
    edits.description = document.getElementById('kw-row-desc-' + kwId).value.trim();
    edits.section_id = document.getElementById('kw-row-secid-' + kwId).value.trim();
    edits.section_title = document.getElementById('kw-row-sectitle-' + kwId).value.trim();
    edits.subsection_id = document.getElementById('kw-row-subid-' + kwId).value.trim();
    edits.subsection_title = document.getElementById('kw-row-subtitle-' + kwId).value.trim();
    edits.nsfw = document.getElementById('kw-row-nsfw-' + kwId).checked ? 1 : 0;

    try {
        var body = {action: action};
        if (action === 'approve') body.edits = edits;
        var res = await fetch(API + '/keywords/' + kwId + '/review', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        if (res.ok) {
            showModal('Succès', action === 'approve' ? 'Mot-clé validé et mis à jour' : 'Mot-clé rejeté', 'success');
            kwLoadList();
        } else {
            var data = await safeJson(res);
            showModal('Erreur', data.error || 'Erreur', 'error');
        }
    } catch(e) { showModal('Erreur', e.message, 'error'); }
}

// ── Delete ──

// ── Multi-selection ──

function kwToggleSelection(id, event) {
    var isCtrl = event && (event.ctrlKey || event.metaKey);
    var isShift = event && event.shiftKey;

    if (isShift && kwLastClickedId !== null) {
        var ids = kwCurrentList.map(function(k) { return k.id; });
        var startIdx = ids.indexOf(kwLastClickedId);
        var endIdx = ids.indexOf(id);
        if (startIdx === -1 || endIdx === -1) return;
        var from = Math.min(startIdx, endIdx);
        var to = Math.max(startIdx, endIdx);
        if (!isCtrl) kwSelectedIds.clear();
        for (var i = from; i <= to; i++) kwSelectedIds.add(ids[i]);
    } else if (isCtrl) {
        if (kwSelectedIds.has(id)) kwSelectedIds.delete(id);
        else kwSelectedIds.add(id);
    } else {
        if (kwSelectedIds.size === 1 && kwSelectedIds.has(id)) kwSelectedIds.clear();
        else { kwSelectedIds.clear(); kwSelectedIds.add(id); }
    }
    kwLastClickedId = id;
    kwRenderSelection();
}

function kwRenderSelection() {
    kwCurrentList.forEach(function(kw) {
        var tr = document.getElementById('kw-tr-' + kw.id);
        if (!tr) return;
        var cb = tr.querySelector('.kw-row-cb');
        var selected = kwSelectedIds.has(kw.id);
        if (cb) cb.checked = selected;
        if (selected) {
            tr.classList.add('bg-indigo-50', 'dark:bg-indigo-900/20');
        } else {
            tr.classList.remove('bg-indigo-50', 'dark:bg-indigo-900/20');
        }
    });
    kwUpdateSelectUI();
}

function kwUpdateSelectUI() {
    var count = kwSelectedIds.size;
    var countEl = document.getElementById('kw-select-count');
    if (countEl) countEl.textContent = count + ' sélectionné' + (count > 1 ? 's' : '');
    var delBtn = document.getElementById('kw-btn-bulk-delete');
    if (delBtn) {
        delBtn.textContent = '🗑 Supprimer (' + count + ')';
        delBtn.disabled = count === 0;
        delBtn.style.opacity = count === 0 ? '0.5' : '1';
    }
    var valBtn = document.getElementById('kw-btn-bulk-validate');
    if (valBtn) {
        // Compter les sélectionnés qui sont en attente
        var pendingCount = 0;
        kwCurrentList.forEach(function(k) {
            if (kwSelectedIds.has(k.id) && k.privacy_status === 'public_pending') pendingCount++;
        });
        if (pendingCount > 0) {
            valBtn.classList.remove('hidden');
            valBtn.textContent = '✅ Valider (' + pendingCount + ')';
            valBtn.disabled = false;
            valBtn.style.opacity = '1';
        } else {
            valBtn.classList.add('hidden');
        }
    }
}

function kwSelectAll() {
    kwCurrentList.forEach(function(k) { kwSelectedIds.add(k.id); });
    kwRenderSelection();
}

function kwSelectNone() {
    kwSelectedIds.clear();
    kwRenderSelection();
}

function kwSelectInverse() {
    var newSel = new Set();
    kwCurrentList.forEach(function(k) { if (!kwSelectedIds.has(k.id)) newSel.add(k.id); });
    kwSelectedIds = newSel;
    kwRenderSelection();
}

async function kwBulkDelete() {
    if (LOCAL_MODE) { showModal('Mot-clé', 'Suppression indisponible en mode local', 'error'); return; }
    var ids = Array.from(kwSelectedIds);
    if (ids.length === 0) return;
    showConfirm('Confirmer', 'Supprimer ' + ids.length + ' mot' + (ids.length > 1 ? 's' : '') + '-clé' + (ids.length > 1 ? 's' : '') + ' ?', async function(ok) {
        if (!ok) return;
        var deleted = 0, errors = 0;
        for (var i = 0; i < ids.length; i++) {
            try {
                var res = await fetch(API + '/keywords/' + ids[i], { method: 'DELETE' });
                if (res.ok) deleted++; else errors++;
            } catch(e) { errors++; }
        }
        kwSelectedIds.clear();
        if (errors > 0) showModal('Résultat', deleted + ' supprimé(s), ' + errors + ' erreur(s)', 'warning');
        else showModal('Succès', deleted + ' mot-clé supprimé(s)', 'success');
        kwLoadList();
    });
}

// ── Bulk validate ──

async function kwBulkValidate() {
    if (LOCAL_MODE) { showModal('Mot-clé', 'Validation indisponible en mode local', 'error'); return; }
    // Filtrer les sélectionnés qui sont en attente
    var pendingIds = [];
    kwCurrentList.forEach(function(k) {
        if (kwSelectedIds.has(k.id) && k.privacy_status === 'public_pending') pendingIds.push(k.id);
    });
    if (pendingIds.length === 0) return;
    showConfirm('Confirmer', 'Valider ' + pendingIds.length + ' mot' + (pendingIds.length > 1 ? 's' : '') + '-clé' + (pendingIds.length > 1 ? 's' : '') + ' en attente ?', async function(ok) {
        if (!ok) return;
        var valBtn = document.getElementById('kw-btn-bulk-validate');
        if (valBtn) valBtn.disabled = true;
        var approved = 0, errors = 0;
        for (var i = 0; i < pendingIds.length; i++) {
            try {
                var res = await fetch(API + '/keywords/' + pendingIds[i] + '/review', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({action: 'approve'})
                });
                if (res.ok) approved++; else errors++;
            } catch(e) { errors++; }
        }
        kwSelectedIds.clear();
        if (errors > 0) showModal('Résultat', approved + ' validé(s), ' + errors + ' erreur(s)', 'warning');
        else showModal('Succès', approved + ' mot-clé validé(s)', 'success');
        try { await kwLoadList(); } catch(e) { console.error(e); kwUpdateSelectUI(); }
    });
}

// ── Duplicate checker ──

async function kwCheckDuplicates() {
    if (LOCAL_MODE) { showModal('Mot-clé', 'Vérification des doublons indisponible en mode local', 'error'); return; }
    var keyword = document.getElementById('kw-modal-keyword').value.trim();
    if (!keyword) {
        showModal('Info', 'Entre d\'abord un mot-clé pour vérifier les doublons', 'info');
        return;
    }
    try {
        var res = await fetch(API + '/keywords/check-duplicates', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({keyword, threshold: 0.85})
        });
        var data = await safeJson(res);
        if (!res.ok) { showModal('Erreur', data.error || 'Erreur', 'error'); return; }
        var msg = '';
        if (data.exact_matches && data.exact_matches.length > 0) {
            msg += '⚠️ <b>Doublons exacts :</b><br>';
            data.exact_matches.forEach(function(m) { msg += '• ' + esc(m.keyword) + ' (' + m.privacy_status + ')<br>'; });
        }
        if (data.semantic_matches && data.semantic_matches.length > 0) {
            msg += '<br>🔍 <b>Similaires (≥85%) :</b><br>';
            data.semantic_matches.forEach(function(m) { msg += '• ' + esc(m.keyword) + ' (' + (m.similarity * 100).toFixed(0) + '%)<br>'; });
        }
        if (!msg) msg = '✅ Aucun doublon trouvé';
        showModal('Résultat vérification', msg, data.exact_matches.length > 0 ? 'warning' : 'success');
    } catch(e) { showModal('Erreur', e.message, 'error'); }
}

// ── Modale création/édition ──

function kwOpenAddModal() {
    document.getElementById('kw-edit-modal-title').textContent = 'Nouveau mot-clé';
    document.getElementById('kw-modal-keyword').value = '';
    document.getElementById('kw-modal-desc').value = '';
    document.getElementById('kw-modal-section').value = '';
    document.getElementById('kw-modal-subsection').value = '';
    document.getElementById('kw-modal-section-id').value = '';
    document.getElementById('kw-modal-section-title').value = '';
    document.getElementById('kw-modal-subsection-id').value = '';
    document.getElementById('kw-modal-subsection-title').value = '';
    document.getElementById('kw-modal-editing-id').value = '';
    document.getElementById('kw-modal-nsfw').checked = false;
    document.getElementById('kw-modal-privacy').value = 'private';
    document.getElementById('kw-modal-save-btn').textContent = 'Ajouter';
    document.getElementById('kw-modal-delete-btn').classList.add('hidden');
    document.getElementById('modal-kw-edit').classList.remove('hidden');
    document.getElementById('modal-kw-edit').classList.add('flex');
    makeModalDraggable('kw-edit-modal-header', 'kw-edit-modal');
    document.getElementById('kw-modal-keyword').focus();
}

function kwCloseAddModal() {
    document.getElementById('modal-kw-edit').classList.add('hidden');
    document.getElementById('modal-kw-edit').classList.remove('flex');
}

async function kwModalSave() {
    if (LOCAL_MODE) { showModal('Mot-clé', 'Création/modification indisponible en mode local', 'error'); return; }
    var keyword = document.getElementById('kw-modal-keyword').value.trim();
    var description = document.getElementById('kw-modal-desc').value.trim();
    var section_id = document.getElementById('kw-modal-section-id').value.trim();
    var section_title = document.getElementById('kw-modal-section-title').value.trim();
    var subsection_id = document.getElementById('kw-modal-subsection-id').value.trim();
    var subsection_title = document.getElementById('kw-modal-subsection-title').value.trim();
    var nsfw = document.getElementById('kw-modal-nsfw').checked ? 1 : 0;
    var privacy = document.getElementById('kw-modal-privacy').value;
    var editingId = document.getElementById('kw-modal-editing-id').value;

    if (!keyword || !description) {
        showModal('Erreur', 'Mot-clé et description requis', 'error');
        return;
    }

    var body = {keyword, description, section_id, section_title, subsection_id, subsection_title, nsfw, privacy_status: privacy};

    try {
        var res, msg;
        if (editingId) {
            res = await fetch(API + '/keywords/' + editingId, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            });
            msg = 'Mot-clé mis à jour';
        } else {
            res = await fetch(API + '/keywords', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            });
            msg = 'Mot-clé créé';
        }
        var data = await safeJson(res);
        if (!res.ok) { showModal('Erreur', data.error || 'Erreur inconnue', 'error'); return; }
        showModal('Succès', msg, 'success');
        kwCloseAddModal();
        kwLoadList();
    } catch(e) { showModal('Erreur', e.message, 'error'); }
}

function kwModalDelete() {
    var editingId = document.getElementById('kw-modal-editing-id').value;
    if (editingId) {
        kwCloseAddModal();
        kwDelete(parseInt(editingId));
    }
}

// ── KW Editor status ──

async function checkKwEditorStatus() {
    if (LOCAL_MODE) { isKwEditor = false; return; }   // pas de review en local
    try {
        var res = await fetch(API + '/keywords/pending');
        if (res.status === 403) {
            isKwEditor = false;
            return;
        }
        isKwEditor = true;
        var pubOpt = document.getElementById('kw-modal-privacy-public');
        if (pubOpt) pubOpt.disabled = false;
    } catch {
        isKwEditor = false;
    }
}

// ── Bulk Import ─────────────────────────────────────────────────

function kwOpenBulkImport() {
    document.getElementById('modal-bulk-import').classList.remove('hidden');
    document.getElementById('modal-bulk-import').classList.add('flex');
    document.getElementById('bi-result').classList.add('hidden');
    makeModalDraggable('bi-modal-header', 'bi-modal');

    // Restaurer taille et position
    var modal = document.getElementById('bi-modal');
    try {
        var cfg = JSON.parse(localStorage.getItem('AIH_config')) || {};
        var r = cfg.biModalRect;
        if (r) {
            modal.style.position = 'fixed';
            modal.style.left = r.left + 'px';
            modal.style.top = r.top + 'px';
            modal.style.width = r.width + 'px';
            modal.style.height = r.height + 'px';
            modal.style.transform = 'none';
            modal.style.margin = '0';
        }
    } catch (e) {}

    // Observer les redimensionnements pour sauvegarder
    if (!modal._biResizeObs) {
        var ro = new ResizeObserver(function() { _saveBiModalRect(); });
        ro.observe(modal);
        modal._biResizeObs = ro;
    }

    // Reset to import tab
    switchBiTab('import');
    loadBiPresets();
}

let _bulkParsedLines = null;
let _bulkFileContent = '';
let _bulkRowIdCounter = 0;
let _bulkExistingSet = null; // Set of LOWER(keyword) from DB

function _saveBiModalRect() {
    var modal = document.getElementById('bi-modal');
    if (!modal) return;
    var rect = modal.getBoundingClientRect();
    try {
        var cfg = JSON.parse(localStorage.getItem('AIH_config')) || {};
        cfg.biModalRect = {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
        localStorage.setItem('AIH_config', JSON.stringify(cfg));
    } catch (e) {}
}

function closeBulkImport() {
    _saveBiModalRect();
    document.getElementById('modal-bulk-import').classList.add('hidden');
    document.getElementById('modal-bulk-import').classList.remove('flex');
    document.getElementById('bi-preview').classList.add('hidden');
    document.getElementById('bi-preview').innerHTML = '';
    document.getElementById('bi-result').classList.add('hidden');
    document.getElementById('bi-dropzone-text').textContent = 'Clique pour choisir un fichier';
    document.getElementById('bi-filename').classList.add('hidden');
    document.getElementById('bi-filename').textContent = '';
    document.getElementById('btn-bi-confirm').classList.add('hidden');
    document.getElementById('bi-file').value = '';
    document.getElementById('bi-gen-preview').classList.add('hidden');
    document.getElementById('bi-gen-preview').innerHTML = '';
    document.getElementById('bi-gen-status').classList.add('hidden');
    _bulkParsedLines = null;
    _bulkFileContent = '';
    _bulkExistingSet = null;
}

// ── Tabs Import / Generation IA ────────────────────────────────

function switchBiTab(tab) {
    document.querySelectorAll('.bi-tab-btn').forEach(function(btn) {
        btn.style.borderColor = 'transparent';
        btn.style.color = '#888';
    });
    document.getElementById('bi-tab-content-import').classList.add('hidden');
    document.getElementById('bi-tab-content-generate').classList.add('hidden');

    if (tab === 'import') {
        document.getElementById('bi-tab-import').style.borderColor = '#6366f1';
        document.getElementById('bi-tab-import').style.color = '#fff';
        document.getElementById('bi-tab-content-import').classList.remove('hidden');
    } else {
        document.getElementById('bi-tab-generate').style.borderColor = '#6366f1';
        document.getElementById('bi-tab-generate').style.color = '#fff';
        document.getElementById('bi-tab-content-generate').classList.remove('hidden');
    }
}

function biToggleLLM() {
    var cb = document.getElementById('bi-llm-convert');
    var preset = document.getElementById('bi-llm-preset');
    var nsfw = document.getElementById('bi-llm-nsfw');
    var show = cb.checked;
    preset.classList.toggle('hidden', !show);
    nsfw.classList.toggle('hidden', !show);
}

function _saveBiPrefs() {
    try {
        var cfg = JSON.parse(localStorage.getItem('AIH_config')) || {};
        cfg.biLlmPreset = document.getElementById('bi-llm-preset').value;
        cfg.biLlmNsfw = document.getElementById('bi-llm-nsfw').value;
        cfg.biGenPreset = document.getElementById('bi-gen-preset').value;
        cfg.biGenNsfw = document.getElementById('bi-gen-nsfw').value;
        localStorage.setItem('AIH_config', JSON.stringify(cfg));
    } catch (e) {}
}

async function loadBiPresets() {
    if (LOCAL_MODE) return;   // /presets indisponible en local
    try {
        var res = await fetch(API + '/presets');
        if (!res.ok) {
            var txt = await res.text().catch(function(){ return ''; });
            console.error('[loadBiPresets] failed:', res.status, txt.substring(0,200));
            return;
        }
        var presets = await res.json();
        var saved;
        try { saved = JSON.parse(localStorage.getItem('AIH_config')) || {}; } catch { saved = {}; }

        [
            {sel: 'bi-llm-preset', save: 'biLlmPreset'},
            {sel: 'bi-gen-preset', save: 'biGenPreset'}
        ].forEach(function(item) {
            var sel = document.getElementById(item.sel);
            if (!sel) return;
            var val = sel.value;
            sel.innerHTML = '<option value="">-- Provider LLM --</option>';
            presets.forEach(function(p) {
                var opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name + (p.is_global ? ' 🌐' : '') + (p.is_client_side ? ' 🖥️' : '');
                sel.appendChild(opt);
            });
            // Restaurer la valeur sauvegardee
            sel.value = saved[item.save] || val;
            // Sauvegarder au changement
            sel.onchange = _saveBiPrefs;
        });

        // Restaurer les niveaux NSFW
        ['bi-llm-nsfw', 'bi-gen-nsfw'].forEach(function(id) {
            var sel = document.getElementById(id);
            if (!sel) return;
            sel.value = saved[id === 'bi-llm-nsfw' ? 'biLlmNsfw' : 'biGenNsfw'] || 'sfw';
            sel.onchange = _saveBiPrefs;
        });
    } catch (e) {
        console.error('[loadBiPresets] exception:', e);
    }
}

function _nsfwLevelLabel(level) {
    var labels = {sfw: 'SFW uniquement', sexy: 'Sexy inclus', erotic: 'Érotique inclus', porno: 'Porno inclus (tout)'};
    return labels[level] || 'SFW';
}

async function biGenerateKeywords() {
    if (LOCAL_MODE) { showModal('Generation IA', 'Indisponible en mode local', 'error'); return; }
    var instruction = document.getElementById('bi-gen-instruction').value.trim();
    var presetId = document.getElementById('bi-gen-preset').value;
    var nsfwLevel = document.getElementById('bi-gen-nsfw').value || 'sfw';

    if (!instruction) {
        showModal('Erreur', 'Donne des instructions à l\'IA', 'error');
        return;
    }
    if (!presetId) {
        showModal('Erreur', 'Choisis un provider LLM', 'error');
        return;
    }

    // Enrichir l'instruction avec le niveau NSFW + format strict
    var nsfwDirective = '\n\nImportant - Niveau NSFW : ' + _nsfwLevelLabel(nsfwLevel) + '.';
    switch (nsfwLevel) {
        case 'sfw': nsfwDirective += ' Aucun contenu suggestif ou explicite. Tous les mots-cles doivent etre marques nsfw=0.'; break;
        case 'sexy': nsfwDirective += ' Les mots-cles a caractere sexy/suggestif sont autorises (nsfw=1). Pas d\'erotisme ni de pornographie.'; break;
        case 'erotic': nsfwDirective += ' Les mots-cles sexy et erotiques sont autorises (nsfw=1). Pas de pornographie explicite.'; break;
        case 'porno': nsfwDirective += ' Tous les niveaux sont autorises, y compris la pornographie explicite (nsfw=1).'; break;
    }
    nsfwDirective += ' Tu dois marquer chaque mot-cle avec nsfw=0 ou nsfw=1 dans le champ nsfw.\n';
    nsfwDirective += '\nIMPORTANT - Regles strictes de formatage :\n';
    nsfwDirective += '- UNILEMENT des lignes au format : keyword | description | section | subsection | nsfw(0/1)\n';
    nsfwDirective += '- NE RIEN AJOUTER d\'autre : pas d\'introduction, pas de conclusion, pas de commentaires\n';
    nsfwDirective += '- Pas de markdown, pas de puces, pas de numerotation, pas de gras\n';
    nsfwDirective += '- Utilise | comme separateur entre les colonnes\n';
    nsfwDirective += '- Une seule ligne par mot-cle, rien d\'autre avant ni apres\n';
    nsfwDirective += '- Exemple valide : Clair de lune | Lumiere douce filtrant a travers les arbres | nature | paysages | 0\n';
    nsfwDirective += '- Exemple valide : Cuirasse | Armure brillante en acier poli | objets | equipement | 0\n';
    nsfwDirective += '- Si tu ne connais pas la section/subsection, laisse vide (ex: keyword | description | | | 0)';

    var statusEl = document.getElementById('bi-gen-status');
    var previewEl = document.getElementById('bi-gen-preview');
    var btn = document.getElementById('btn-bi-generate');

    statusEl.classList.remove('hidden');
    statusEl.textContent = '🤖 Generation en cours...';
    previewEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = '⏳...';

    try {
        var res = await fetch(API + '/keywords/llm-process', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                preset_id: parseInt(presetId),
                instruction: instruction + nsfwDirective
            })
        });
        var data = await safeJson(res);
        if (!res.ok) {
            statusEl.textContent = '❌ ' + (data.error || 'Erreur LLM');
            return;
        }

        statusEl.textContent = '✅ ' + data.output.split('\n').length + ' ligne(s) detectees. Bascule vers Import...';

        var rawText = data.output || '';
        var formatted = _parseGenToBulkFormat(rawText);
        _bulkFileContent = formatted;
        _parseAndShowPreview(formatted);

        // Basculer sur l'onglet Import (le prompt reste dans l'onglet Generation)
        setTimeout(function() {
            switchBiTab('import');
            statusEl.textContent = '✅ Pret pour confirmation dans l\'onglet Import.';
        }, 600);

    } catch (e) {
        statusEl.textContent = '❌ Erreur: ' + (e.message || '');
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Générer';
    }
}

function _parseGenToBulkFormat(rawText) {
    var lines = rawText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
    var result = [];
    var skipWords = ['voici', 'cette', 'ces', 'pour', 'avec', 'dans', 'afin', 'nous', 'elles', 'ils', 'je', 'tu'];  // mots d'intro
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        // Skip code fences, headers, et lignes marquees comme erreur par le LLM
        if (line.startsWith('```') || line.startsWith('#')) continue;
        // Skip les lignes conversationnelles (phrases completes)
        var firstWord = line.split(/\s+/)[0] || '';
        firstWord = firstWord.replace(/^['"\*]*/, '').toLowerCase();
        if ((skipWords.indexOf(firstWord) !== -1) && line.endsWith('.') && line.split(' ').length > 5) continue;
        // Regex pour reperer les phrases d'intro/conclusion
        if (/^(voici|j['']ai|merci|ces|cette|pour obtenir|je recommande|n['']hésitez|bonne)/i.test(line)) continue;

        // Nettoyer les artefacts markdown
        line = line.replace(/^[\s*#\-\d\.]+/g, '').trim();
        line = line.replace(/\*\*/g, '');  // enlever le gras markdown

        // Deja au bon format avec pipe ?
        if (line.includes('|')) {
            // S'assurer qu'il y a au moins keyword | description
            var parts = line.split('|').map(function(p) { return p.trim(); });
            if (parts.length >= 2 && parts[0] && parts[1]) {
                result.push(parts.join(' | '));
            }
            continue;
        }
        // Pattern : **keyword** — description  ou  **keyword** : description
        var m = line.match(/^\*\*?([^*]+)\*\*?\s*[:–—]\s*(.+)/);
        if (m) {
            result.push(m[1].trim() + ' | ' + m[2].trim());
            continue;
        }
        // Pattern : keyword : description
        m = line.match(/^([^:–—]{2,60})\s*[:–—]\s*(.+)/);
        if (m) {
            result.push(m[1].trim() + ' | ' + m[2].trim());
            continue;
        }
        // Pattern : keyword (traduction) nsfw=X — tenter de separer
        m = line.match(/^([A-Za-zéèêëàâäùûüôöîïç]+)\s*\(([^)]+)\)\s*nsfw=(\d)/i);
        if (m) {
            result.push(m[1].trim() + ' | ' + m[2].trim() + ' | | | ' + m[3]);
            continue;
        }
        // Pattern : keyword nsfw=X
        m = line.match(/^([^|]+)\s*nsfw=(\d)/i);
        if (m) {
            result.push(m[1].trim() + ' |  | | | ' + m[2]);
            continue;
        }
        // Fallback : si la ligne ressemble a une donnee (pas une phrase)
        if (line.includes(' ')) {
            var words = line.split(' ');
            // Si c'est une phrase (trop de mots courts), on skip
            if (words.length <= 8) {
                result.push(line);
            }
        }
    }
    return result.join('\n');
}

function kwBulkFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('bi-filename').textContent = '📄 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' Ko)';
    document.getElementById('bi-filename').classList.remove('hidden');
    document.getElementById('bi-dropzone-text').textContent = 'Clique pour changer de fichier';
    document.getElementById('bi-result').classList.add('hidden');

    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;

        // Si la conversion LLM est activee
        var llmCb = document.getElementById('bi-llm-convert');
        if (llmCb && llmCb.checked) {
            if (LOCAL_MODE) {
                showModal('Conversion LLM', 'Indisponible en mode local', 'error');
                llmCb.checked = false;
                biToggleLLM();
                _bulkFileContent = text;
                _parseAndShowPreview(text);
                return;
            }
            var presetId = document.getElementById('bi-llm-preset').value;
            var nsfwLevel = document.getElementById('bi-llm-nsfw').value || 'sfw';

            if (!presetId) {
                showModal('Erreur', 'Choisis un provider LLM pour la conversion', 'error');
                llmCb.checked = false;
                biToggleLLM();
                _bulkFileContent = text;
                _parseAndShowPreview(text);
                return;
            }

            var statusEl = document.getElementById('bi-gen-status');
            if (statusEl) {
                statusEl.classList.remove('hidden');
                statusEl.textContent = '🤖 Conversion LLM en cours...';
            }

            var nsfwDirective = '\nNiveau NSFW : ' + _nsfwLevelLabel(nsfwLevel) + '.';
            switch (nsfwLevel) {
                case 'sfw': nsfwDirective += ' Aucun contenu suggestif. Tout marquer nsfw=0.'; break;
                case 'sexy': nsfwDirective += ' Contenu sexy/suggestif → nsfw=1. Pas d\'erotisme ni porno.'; break;
                case 'erotic': nsfwDirective += ' Contenu sexy/erotique → nsfw=1. Pas de porno.'; break;
                case 'porno': nsfwDirective += ' Seul le porno explicite → nsfw=1.'; break;
            }

            var instruction = "Reformate UNIQUEMENT les mots-cles au format 'keyword | description | section | subsection | nsfw(0/1)', un par ligne. NE RIEN AJOUTER d'autre : pas d'introduction, pas de conclusion, pas de commentaires, pas de markdown. Conserve le sens original. Nettoie la ponctuation. Utilise '|' comme separateur, jamais autre chose."
                + nsfwDirective;

            try {
                var res = await fetch(API + '/keywords/llm-process', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        preset_id: parseInt(presetId),
                        instruction: instruction,
                        input_text: text
                    })
                });
                var data = await safeJson(res);
                if (!res.ok) {
                    if (statusEl) statusEl.textContent = '❌ ' + (data.error || 'Erreur LLM');
                    _bulkFileContent = text;
                    _parseAndShowPreview(text);
                    return;
                }
                var converted = data.output || '';
                _bulkFileContent = converted;
                _parseAndShowPreview(converted);
                if (statusEl) statusEl.textContent = '✅ Conversion terminee !';
            } catch (err) {
                if (statusEl) statusEl.textContent = '❌ Erreur: ' + (err.message || '');
                _bulkFileContent = text;
                _parseAndShowPreview(text);
            }
        } else {
            _bulkFileContent = text;
            _parseAndShowPreview(text);
        }
    };
    reader.onerror = function() {
        showModal('Erreur', 'Impossible de lire le fichier', 'error');
    };
    reader.readAsText(file);
}

function _parseAndShowPreview(text) {
    const previewDiv = document.getElementById('bi-preview');
    const resultDiv = document.getElementById('bi-result');
    resultDiv.classList.add('hidden');
    _bulkExistingSet = null; // Reset duplicate cache

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const rows = [];
    const errors = [];

    _bulkRowIdCounter = 0;

    lines.forEach((line, i) => {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 2) {
            errors.push({ line: i + 1, text: line, reason: 'Format invalide : besoin keyword | description au minimum' });
            return;
        }
        const keyword = parts[0];
        const description = parts[1];
        const sectionId = parts[2] || '';
        const subsectionId = parts[3] || '';
        const nsfw = (parts[4] === '1') ? 1 : 0;
        if (!keyword || !description) {
            errors.push({ line: i + 1, text: line, reason: 'keyword ou description vide' });
            return;
        }
        rows.push({
            id: ++_bulkRowIdCounter,
            keyword, description, sectionId, subsectionId, nsfw,
        });
    });

    _bulkParsedLines = rows;

    // Construire le DOM
    previewDiv.innerHTML = '';
    previewDiv.classList.remove('hidden');

    // Barre d'actions
    const toolbar = document.createElement('div');
    toolbar.className = 'px-2 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-xs font-medium flex items-center gap-2';
    toolbar.innerHTML = '<span>✅ <span id="bi-valid-count">' + rows.length + '</span> ligne(s) valide(s)'
        + (errors.length > 0 ? ' · ⚠️ ' + errors.length + ' erreur(s)' : '')
        + '</span>';
    const dupBtn = document.createElement('button');
    dupBtn.textContent = '🔍 Vérifier doublons';
    dupBtn.className = 'ml-auto px-2 py-0.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-400 transition';
    dupBtn.onclick = _bulkCheckDuplicates;
    toolbar.appendChild(dupBtn);
    previewDiv.appendChild(toolbar);

    // Erreurs de parsing
    if (errors.length > 0) {
        const errDiv = document.createElement('div');
        errDiv.className = 'mt-2 p-2 bg-rose-50 dark:bg-rose-900/30 rounded border border-rose-200 dark:border-rose-800 text-xs';
        errDiv.innerHTML = '<p class="text-rose-600 dark:text-rose-400 font-medium mb-1">⚠️ ' + errors.length + ' erreur(s) de parsing :</p>';
        errors.forEach(e => {
            const p = document.createElement('p');
            p.className = 'text-rose-500 text-[10px]';
            p.textContent = 'Ligne ' + e.line + ' : ' + e.reason;
            errDiv.appendChild(p);
            const code = document.createElement('code');
            code.className = 'text-rose-400 text-[10px] block ml-2';
            code.textContent = e.text.substring(0, 80);
            errDiv.appendChild(code);
        });
        previewDiv.appendChild(errDiv);
    }

    // Tableau editable
    if (rows.length > 0) {
        const table = document.createElement('table');
        table.className = 'w-full text-xs border-collapse mt-2';
        table.innerHTML = '<thead><tr class="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">'
            + '<th class="px-1 py-1 text-center w-6"></th>'
            + '<th class="px-2 py-1 text-left">Keyword</th>'
            + '<th class="px-2 py-1 text-left">Description</th>'
            + '<th class="px-2 py-1 text-left w-16">Section</th>'
            + '<th class="px-2 py-1 text-left w-20">Sous-section</th>'
            + '<th class="px-2 py-1 text-center w-12">NSFW</th>'
            + '<th class="px-1 py-1 text-center w-6"></th>'
            + '</tr></thead>';
        const tbody = document.createElement('tbody');

        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.id = 'bi-row-' + r.id;
            tr.className = 'border-b border-slate-100 dark:border-slate-700';
            tr.dataset.id = r.id;

            // Checkbox
            const tdCheck = document.createElement('td');
            tdCheck.className = 'px-1 py-1 text-center';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.className = 'bi-row-cb';
            cb.dataset.rowId = r.id;
            cb.onchange = _bulkUpdateCount;
            tdCheck.appendChild(cb);

            // Keyword (editable)
            const tdKw = document.createElement('td');
            tdKw.className = 'px-2 py-1';
            const kwInput = document.createElement('input');
            kwInput.type = 'text';
            kwInput.value = r.keyword;
            kwInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            kwInput.dataset.rowId = r.id;
            kwInput.dataset.field = 'keyword';
            kwInput.oninput = _bulkUpdateRow;
            tdKw.appendChild(kwInput);

            // Description (editable)
            const tdDesc = document.createElement('td');
            tdDesc.className = 'px-2 py-1';
            const descInput = document.createElement('input');
            descInput.type = 'text';
            descInput.value = r.description;
            descInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            descInput.dataset.rowId = r.id;
            descInput.dataset.field = 'description';
            descInput.oninput = _bulkUpdateRow;
            tdDesc.appendChild(descInput);

            // Section
            const tdSec = document.createElement('td');
            tdSec.className = 'px-2 py-1';
            const secInput = document.createElement('input');
            secInput.type = 'text';
            secInput.value = r.sectionId;
            secInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            secInput.dataset.rowId = r.id;
            secInput.dataset.field = 'sectionId';
            secInput.oninput = _bulkUpdateRow;
            secInput.setAttribute('list', 'kw-section-list');
            tdSec.appendChild(secInput);

            // Subsection
            const tdSub = document.createElement('td');
            tdSub.className = 'px-2 py-1';
            const subInput = document.createElement('input');
            subInput.type = 'text';
            subInput.value = r.subsectionId;
            subInput.className = 'w-full px-1 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-transparent dark:text-slate-200';
            subInput.dataset.rowId = r.id;
            subInput.dataset.field = 'subsectionId';
            subInput.oninput = _bulkUpdateRow;
            subInput.setAttribute('list', 'kw-subsection-list');
            tdSub.appendChild(subInput);

            // NSFW toggle
            const tdNsfw = document.createElement('td');
            tdNsfw.className = 'px-2 py-1 text-center';
            const nsCb = document.createElement('input');
            nsCb.type = 'checkbox';
            nsCb.checked = !!r.nsfw;
            nsCb.className = 'bi-row-nsfw';
            nsCb.dataset.rowId = r.id;
            nsCb.onchange = _bulkUpdateRow;
            tdNsfw.appendChild(nsCb);

            // Delete button
            const tdDel = document.createElement('td');
            tdDel.className = 'px-1 py-1 text-center';
            const delBtn = document.createElement('button');
            delBtn.textContent = '×';
            delBtn.className = 'text-rose-400 hover:text-rose-600 text-xs font-bold px-1';
            delBtn.title = 'Supprimer cette ligne';
            delBtn.onclick = function() { _bulkDeleteRow(r.id); };
            tdDel.appendChild(delBtn);

            tr.append(tdCheck, tdKw, tdDesc, tdSec, tdSub, tdNsfw, tdDel);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        previewDiv.appendChild(table);
    }

    document.getElementById('btn-bi-confirm').classList.remove('hidden');
}

function _bulkUpdateCount() {
    const cbs = document.querySelectorAll('.bi-row-cb');
    const checked = Array.from(cbs).filter(cb => cb.checked).length;
    document.getElementById('bi-valid-count').textContent = checked;
}

function _bulkUpdateRow(e) {
    const input = e.target;
    const id = parseInt(input.dataset.rowId);
    const field = input.dataset.field;
    const row = _bulkParsedLines.find(r => r.id === id);
    if (row) {
        if (field === 'nsfw') {
            row.nsfw = input.checked ? 1 : 0;
        } else {
            row[field] = input.value;
        }
        // Si le keyword change, invalider le cache doublon
        if (field === 'keyword') {
            const tr = document.getElementById('bi-row-' + id);
            if (tr) tr.classList.remove('bg-rose-100', 'dark:bg-rose-900/30', 'line-through', 'opacity-60');
            const cb = tr?.querySelector('.bi-row-cb');
            if (cb) cb.disabled = false;
            _bulkExistingSet = null; // Invalider le cache
        }
    }
}

function _bulkDeleteRow(id) {
    _bulkParsedLines = _bulkParsedLines.filter(r => r.id !== id);
    const tr = document.getElementById('bi-row-' + id);
    if (tr) tr.remove();
    _bulkUpdateCount();
}

async function _bulkCheckDuplicates() {
    const dupBtn = document.querySelector('#bi-preview button');
    if (dupBtn) dupBtn.textContent = '🔍 Vérification...';

    try {
        // Charger les keywords existants
        const res = await fetch(API + '/keywords?scope=public&limit=5000');
        const existing = await safeJson(res);
        if (!Array.isArray(existing)) return;

        _bulkExistingSet = new Set(existing.map(kw => kw.keyword.toLowerCase()));

        let dupCount = 0;
        _bulkParsedLines.forEach(r => {
            const tr = document.getElementById('bi-row-' + r.id);
            if (!tr) return;
            const cb = tr.querySelector('.bi-row-cb');
            if (_bulkExistingSet.has(r.keyword.toLowerCase())) {
                tr.classList.add('bg-rose-100', 'dark:bg-rose-900/30', 'line-through', 'opacity-60');
                if (cb) {
                    cb.checked = false;
                    cb.disabled = true;
                }
                dupCount++;
            } else {
                tr.classList.remove('bg-rose-100', 'dark:bg-rose-900/30', 'line-through', 'opacity-60');
                if (cb) cb.disabled = false;
            }
        });

        _bulkUpdateCount();
        if (dupBtn) dupBtn.textContent = '🔍 Vérifier doublons';
        showModal('Résultat', dupCount > 0
            ? '⚠️ ' + dupCount + ' doublon(s) trouvé(s) et désactivé(s). Vérifie et confirme si nécessaire.'
            : '✅ Aucun doublon trouvé !',
            dupCount > 0 ? 'warning' : 'success');
    } catch (e) {
        if (dupBtn) dupBtn.textContent = '🔍 Vérifier doublons';
        showModal('Erreur', e.message || 'Erreur de vérification', 'error');
    }
}

async function kwBulkConfirm() {
    if (LOCAL_MODE) { showModal('Import', 'Import indisponible en mode local', 'error'); return; }
    if (!_bulkParsedLines || _bulkParsedLines.length === 0) {
        showModal('Erreur', 'Sélectionne d\'abord un fichier', 'error');
        return;
    }

    // Reconstruire le texte à partir des données éditées
    const selectedRows = _bulkParsedLines.filter(r => {
        const tr = document.getElementById('bi-row-' + r.id);
        if (!tr) return false;
        const cb = tr.querySelector('.bi-row-cb');
        return cb && cb.checked;
    });

    if (selectedRows.length === 0) {
        showModal('Erreur', 'Aucune ligne sélectionnée pour l\'import', 'error');
        return;
    }

    // Reconstruire le format texte
    const text = selectedRows.map(r =>
        r.keyword + ' | ' + r.description + ' | ' + r.sectionId + ' | ' + r.subsectionId + ' | ' + r.nsfw
    ).join('\n');

    const privacy = document.getElementById('bi-privacy').value;

    try {
        const res = await fetch(API + '/keywords/bulk', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text, privacy_status: privacy})
        });
        const data = await safeJson(res);
        const resultDiv = document.getElementById('bi-result');
        resultDiv.classList.remove('hidden');
        if (res.ok) {
            resultDiv.className = 'text-xs p-2 rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300';
            resultDiv.innerHTML = '✅ <b>' + escapeHtml(data.message || '') + '</b>';
            if (data.errors && data.errors.length > 0) {
                resultDiv.innerHTML += '<br><br><b>Erreurs :</b><br>' + data.errors.slice(0, 10).map(escapeHtml).join('<br>');
            }
            kwLoadList();
            setTimeout(() => closeBulkImport(), 3000);
        } else {
            resultDiv.className = 'text-xs p-2 rounded border border-rose-300 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700 text-rose-800 dark:text-rose-300';
            resultDiv.innerHTML = '❌ ' + escapeHtml(data.error || 'Erreur inconnue');
        }
    } catch (e) {
        showModal('Erreur', e.message, 'error');
    }
}

// ── Scan des doublons ─────────────────────────────────────────

async function kwOpenDuplicateScan() {
    if (LOCAL_MODE) { showModal('Doublons', 'Scan indisponible en mode local', 'error'); return; }
    // Afficher la progression inline
    var progressDiv = document.getElementById('kw-scan-progress');
    var statusEl = document.getElementById('kw-scan-status');
    var barEl = document.getElementById('kw-scan-bar');
    var timerEl = document.getElementById('kw-scan-timer');
    var cancelBtn = document.getElementById('kw-scan-cancel');
    
    progressDiv.classList.remove('hidden');
    statusEl.textContent = 'Scan en cours...';
    barEl.style.width = '10%';
    cancelBtn.disabled = false;
    
    var startTime = Date.now();
    var timerInterval = setInterval(function() {
        var elapsed = Math.floor((Date.now() - startTime) / 1000);
        timerEl.textContent = elapsed + 's';
        var pct = Math.min(80, 10 + elapsed * 3);
        barEl.style.width = pct + '%';
    }, 500);

    var controller = new AbortController();
    
    cancelBtn.onclick = function() {
        controller.abort();
        cancelBtn.disabled = true;
        cancelBtn.textContent = '✕ Annulation...';
    };

    try {
        var res = await fetch(API + '/keywords/scan-duplicates', { signal: controller.signal });
        
        barEl.style.width = '95%';
        statusEl.textContent = 'Analyse des resultats...';
        
        var data = await safeJson(res);
        clearInterval(timerInterval);
        
        if (!res.ok) {
            progressDiv.classList.add('hidden');
            showModal('Erreur', data.error || 'Erreur de scan (HTTP ' + res.status + ')', 'error');
            return;
        }
        
        barEl.style.width = '100%';
        
        var html = '';
        html += '<p>🔍 <b>' + data.exact_count + '</b> groupe(s) de doublons exacts';
        if (data.semantic_count > 0) html += ' · <b>' + data.semantic_count + '</b> groupe(s) semantiques';
        html += '</p>';

        if (data.exact_count === 0 && data.semantic_count === 0) {
            html += '<p class="text-emerald-600 dark:text-emerald-400 mt-2">✅ Aucun doublon trouve !</p>';
        } else {
            if (data.exact_duplicates && data.exact_duplicates.length > 0) {
                html += '<h4 class="text-xs font-semibold text-rose-600 dark:text-rose-400 mb-1 mt-2">⚠️ Doublons exacts</h4>';
                data.exact_duplicates.forEach(function(g) {
                    html += '<div class="mb-1 p-1.5 bg-rose-50 dark:bg-rose-900/20 rounded border border-rose-200 dark:border-rose-800 text-xs">';
                    html += '<span class="font-medium">' + esc(g.normalized) + '</span> x' + g.count;
                    html += '<div class="text-slate-500">' + g.keywords.map(function(k) { return esc(k); }).join(' . ') + '</div></div>';
                });
            }
            if (data.semantic_groups && data.semantic_groups.length > 0) {
                html += '<h4 class="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1 mt-2">🔍 Similaires (>=85%)</h4>';
                data.semantic_groups.forEach(function(group) {
                    html += '<div class="mb-1 p-1.5 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800 text-xs">';
                    group.forEach(function(item, idx) {
                        var label = idx === 0 ? '🎯' : '🔗 ' + (item.similarity * 100).toFixed(0) + '%';
                        html += '<div>' + label + ' <b>' + esc(item.keyword) + '</b></div>';
                    });
                    html += '</div>';
                });
            }
        }
        
        progressDiv.classList.add('hidden');
        // Afficher dans une modale large et scrollable
        _showScanResults(html);
        
    } catch (e) {
        clearInterval(timerInterval);
        progressDiv.classList.add('hidden');
        if (e.name === 'AbortError') {
            showModal('Info', 'Scan annule par l\'utilisateur.', 'info');
        } else {
            showModal('Erreur', e.message || 'Erreur de scan', 'error');
        }
    }
}

function _showScanResults(html) {
    // Modale plein écran scrollable
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:90%;max-width:700px;max-height:85vh;display:flex;flex-direction:col;overflow:hidden;';
    if (document.documentElement.classList.contains('dark')) {
        modal.style.background = '#1e293b';
        modal.style.border = '1px solid #334155';
    }

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;flex-shrink:0;';
    if (document.documentElement.classList.contains('dark')) {
        header.style.borderColor = '#334155';
    }
    var title = document.createElement('span');
    title.textContent = '🔍 Resultat du scan';
    title.style.cssText = 'font-size:14px;font-weight:600;color:#1e293b;';
    if (document.documentElement.classList.contains('dark')) title.style.color = '#e2e8f0';
    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8;padding:0 4px;';
    closeBtn.onmouseenter = function() { closeBtn.style.color = '#ef4444'; };
    closeBtn.onmouseleave = function() { closeBtn.style.color = '#94a3b8'; };
    closeBtn.onclick = function() { overlay.remove(); };
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body scrollable
    var body = document.createElement('div');
    body.style.cssText = 'padding:16px;overflow-y:auto;font-size:12px;color:#475569;line-height:1.5;';
    if (document.documentElement.classList.contains('dark')) body.style.color = '#cbd5e1';
    body.innerHTML = html;

    // Footer
    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid #e2e8f0;flex-shrink:0;';
    if (document.documentElement.classList.contains('dark')) footer.style.borderColor = '#334155';
    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:6px 16px;font-size:13px;font-weight:600;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer;';
    okBtn.onmouseenter = function() { okBtn.style.background = '#4f46e5'; };
    okBtn.onmouseleave = function() { okBtn.style.background = '#6366f1'; };
    okBtn.onclick = function() { overlay.remove(); };
    footer.appendChild(okBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Fermer au clic sur l\'overlay (pas sur la modale)
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    // Fermer avec Escape
    var keyHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); } };
    document.addEventListener('keydown', keyHandler);
}

// ── Export ──────────────────────────────────────────────────────

function kwExport() {
    if (LOCAL_MODE) { showModal('Export', 'Indisponible en mode local', 'error'); return; }
    // Utiliser les checkboxes pour déterminer le scope d'export
    var mineOnly = document.getElementById('kw-filter-mine').checked;
    var scope = mineOnly ? 'mine' : 'public';
    window.open(API + '/keywords/export?scope=' + scope, '_blank');
}

// ── Initialisation ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    // Le switchMainTab appelle kwLoadList() quand l'onglet keywords est activé
});

