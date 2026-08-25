/**
 * AIH Picker Config — Composant réutilisable pour dropdown avec configuration modale.
 *
 * Remplace un <select> standard par :
 *   [ ⚙️ ] [ ▼ dropdown sélection... ]
 *
 * Le ⚙️ ouvre une modale 2 colonnes (Tous les items ↔ Shortlist).
 * L'utilisateur choisit quels items apparaissent dans le dropdown.
 * Si la shortlist est vide → le dropdown affiche tout.
 * Si la shortlist a >1 item → le dropdown propose "🎲 Random".
 *
 * La shortlist est stockée dans un widget STRING natif (sérialisé dans le workflow).
 */
(function() {
    // ── Etat global de la modale (singleton) ──

    /**
     * Configure un dropdown avec bouton config.
     * @param {Object} opts
     * @param {HTMLSelectElement} opts.select - Le <select> existant
     * @param {Object} opts.node - Le node ComfyUI
     * @param {string} opts.widgetName - Nom du widget natif pour la valeur sélectionnée (ex: 'style_id')
     * @param {string} opts.listWidgetName - Nom du widget natif STRING pour la shortlist JSON (ex: 'style_shortlist')
     * @param {string} opts.apiPath - Chemin API relatif (ex: 'styles')
     * @param {string} opts.label - Texte du label
     * @param {string} opts.placeholder - Texte du placeholder
     * @param {string} opts.idField - Champ ID dans l'objet item (défaut: 'id')
     * @param {string} opts.nameField - Champ nom (défaut: 'name')
     * @param {string} opts.authorField - Champ auteur (défaut: 'owner_name')
     * @param {string} opts.descField - Champ description (défaut: undefined)
     * @param {Function} opts.fetchItems - Fonction async pour fetcher les items
     * @param {Function} opts.onSelect - Callback quand la sélection change (selectedId, shortlist)
     */
    function setupPickerConfig(opts) {
        var select = opts.select;
        var node = opts.node;
        var widgetName = opts.widgetName;  // réservé pour usage futur (ex: label du widget natif)
        var listWidgetName = opts.listWidgetName;
        var apiPath = opts.apiPath;
        var label = opts.label || 'Picker';
        var placeholder = opts.placeholder || '-- Select --';
        var idField = opts.idField || 'id';
        var nameField = opts.nameField || 'name';
        var authorField = opts.authorField || 'owner_name';
        var descField = opts.descField;
        var fetchItems = opts.fetchItems || function() { return Promise.resolve([]); };
        var onSelect = opts.onSelect;

        // ── Widget natif pour la shortlist ──
        var shortlistWidget = node.widgets?.find(function(w) { return w.name === listWidgetName; });

        // Helper : lire la shortlist depuis le widget natif
        function getShortlist() {
            try {
                if (shortlistWidget && shortlistWidget.value) {
                    var parsed = JSON.parse(shortlistWidget.value);
                    if (Array.isArray(parsed)) return parsed;
                }
            } catch(e) {
                console.warn('[PickerConfig] Invalid shortlist JSON, resetting:', e);
            }
            return [];
        }

        // Helper : écrire la shortlist dans le widget natif
        function setShortlist(arr) {
            var json = JSON.stringify(arr);
            if (shortlistWidget) {
                shortlistWidget.value = json;
                if (shortlistWidget.callback) shortlistWidget.callback(json);
            }
        }

        // ── Container pour le bouton ──
        var pickerRow = document.createElement('div');
        Object.assign(pickerRow.style, {
            display: 'flex', gap: '0', alignItems: 'center', width: '100%',
        });

        // Bouton ⚙️ (config)
        var configBtn = document.createElement('button');
        configBtn.textContent = '\u2699';
        Object.assign(configBtn.style, {
            width: '28px', height: '22px', flexShrink: '0',
            padding: '0', borderRadius: '4px 0 0 4px',
            border: '1px solid #555', borderRight: 'none', background: '#3a3a3e', color: '#ccc',
            fontSize: '13px', cursor: 'pointer', lineHeight: '1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        });
        configBtn.title = 'Configurer la shortlist';
        configBtn.onmouseenter = function() { configBtn.style.borderColor = '#777'; };
        configBtn.onmouseleave = function() { configBtn.style.borderColor = '#555'; };

        // Style du select : prendre toute la largeur restante
        select.style.flex = '1';

        // Fusionner visuellement le bouton et le select
        pickerRow.appendChild(configBtn);
        select.parentNode.insertBefore(pickerRow, select);
        pickerRow.appendChild(select);
        select.style.borderRadius = '0 4px 4px 0';

        // ── Peupler le dropdown ──
        var _allItems = [];

        function populateDropdown(items, shortlist) {
            // Sauvegarder la valeur courante
            var currentVal = select.value;
            select.innerHTML = '';

            var list = shortlist && shortlist.length > 0
                ? items.filter(function(item) { return shortlist.indexOf(String(item[idField])) >= 0 || shortlist.indexOf(item[idField]) >= 0; })
                : items;

            // Option placebo
            var opt0 = document.createElement('option');
            opt0.value = '0';
            opt0.textContent = placeholder;
            select.appendChild(opt0);

            // Option random si shortlist > 1
            if (list.length > 1) {
                var randOpt = document.createElement('option');
                randOpt.value = '_random';
                randOpt.textContent = '\ud83c\udfb2 Random';
                select.appendChild(randOpt);
            }

            // Trier par ordre alphabétique
            list.sort(function(a, b) {
                var nameA = (a[nameField] || a[idField] || a).toString().toLowerCase();
                var nameB = (b[nameField] || b[idField] || b).toString().toLowerCase();
                return nameA.localeCompare(nameB);
            });

            // Items
            list.forEach(function(item) {
                var o = document.createElement('option');
                o.value = String(item[idField]);
                o.textContent = item[nameField] || ('Item ' + item[idField]);
                select.appendChild(o);
            });

            // Restaurer si possible
            if ([...select.options].some(function(o) { return o.value === currentVal; })) {
                select.value = currentVal;
            } else {
                select.value = '0';
            }
        }

        // ── Initialisation des items ──
        async function initItems() {
            try {
                _allItems = await fetchItems(apiPath);
            } catch(e) {
                _allItems = [];
            }
            select._aihPickerItems = _allItems;
            var shortlist = getShortlist();
            populateDropdown(_allItems, shortlist);
        }

        // ── Refresh ──
        select._aihRefreshItems = function() {
            return initItems();
        };

        // ── Ouverture de la modale ──
        configBtn.onclick = function() {
            function _openWithItems() {
                openPickerModal({
                    allItems: _allItems,
                    currentShortlist: getShortlist(),
                    idField: idField,
                    nameField: nameField,
                    authorField: authorField,
                    descField: descField,
                    label: label,
                    onSave: function(newShortlist) {
                        setShortlist(newShortlist);
                        populateDropdown(_allItems, newShortlist);
                        if (onSelect) onSelect(select.value, newShortlist);
                    }
                });
            }
            // Toujours re-fetch pour avoir les données fraîches
            initItems().then(_openWithItems);
        };

        // ── Refresh au mousedown sur le select (cache TTL 15s) ──
        select.addEventListener("mousedown", function() {
            // Re-fetch si plus de 15 secondes depuis le dernier fetch
            if (!select._aihLastFetch || Date.now() - select._aihLastFetch > 15000) {
                select._aihLastFetch = Date.now();
                initItems().then(function() {
                    // Re-populate le dropdown avec les nouvelles données
                    // sans perdre la valeur actuellement sélectionnée
                    var shortlist = getShortlist();
                    populateDropdown(_allItems, shortlist);
                    if (onSelect) onSelect(select.value, shortlist);
                });
            }
        });

        // ── "🎲 Random" reste sélectionné visuellement (valeur sentinelle -1) ──
        // Le widget natif style_id est mis à -1 par syncNativeWidgets() du widget hôte.
        // La résolution en ID réel se fait au moment du preview/exécution (dans chaque widget).
        select.addEventListener('change', function() {
            if (select.value === '_random') {
                // Ne PAS résoudre en un ID fixe : garder _random sélectionné visuellement.
                // Le widget caché sera mis à -1 par le handler onchange du widget hôte.
            }
        });

        // ── Sauvegarder la référence pour le restore ──
        // (les callers utilisent l'API retournée par setupPickerConfig)

        return {
            init: initItems,
            getShortlist: getShortlist,
            setShortlist: setShortlist,
            populate: populateDropdown,
            refresh: initItems,
        };
    }

    // ── Modale 2 colonnes (singleton) ──
    // NOTE (migration future) : Cette modale utilise son propre système (drag, resize, overlay,
    // pattern singleton, persistence localStorage). Elle sera migrée vers aihOpenModalV2 dans
    // une future passe. Le z-index (99999) est compatible avec le système v2 (base 90000).
    function openPickerModal(opts) {
        var allItems = opts.allItems || [];
        var currentShortlist = opts.currentShortlist || [];
        var idField = opts.idField || 'id';
        var nameField = opts.nameField || 'name';
        var authorField = opts.authorField || 'owner_name';
        var descField = opts.descField;
        var label = opts.label || 'Picker';
        var onSave = opts.onSave || function() {};

        var shortlistSet = new Set(currentShortlist.map(function(id) { return String(id); }));

        // ── Créer ou récupérer la modale ──
        var modal = document.getElementById('aih-picker-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'aih-picker-modal';
            Object.assign(modal.style, {
                position: 'fixed', zIndex: '99999',
                left: 'calc(50% - 320px)', top: 'calc(50% - 240px)',
                width: '640px', height: '560px',
                background: '#2a2a2e', borderRadius: '10px',
                fontFamily: 'sans-serif', fontSize: '13px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                overflow: 'hidden',
                flexDirection: 'column',
            });
            // Restaurer position/taille depuis localStorage
            try {
                var saved = JSON.parse(localStorage.getItem('aihPickerModalRect') || 'null');
                if (saved) {
                    var vw = window.innerWidth;
                    var vh = window.innerHeight;
                    modal.style.left = Math.max(0, Math.min(saved.left, vw - 400)) + 'px';
                    modal.style.top = Math.max(0, Math.min(saved.top, vh - 350)) + 'px';
                    modal.style.width = Math.max(400, Math.min(saved.width, vw - 100)) + 'px';
                    modal.style.height = Math.max(350, Math.min(saved.height, vh - 100)) + 'px';
                }
            } catch(e) {}

            // Overlay semi-transparent en arrière-plan
            var overlay = document.createElement('div');
            overlay.id = 'aih-picker-overlay';
            Object.assign(overlay.style, {
                display: 'none', position: 'fixed', zIndex: '99998',
                left: '0', top: '0', width: '100%', height: '100%',
                background: 'rgba(0,0,0,0.6)',
            });
            // overlay.onclick est rebindé à chaque ouverture (hors du if(!modal))
            document.body.appendChild(overlay);

            // MODAL HTML — structure complète
            modal.innerHTML =
                // Header (barre de titre, draggable)
                '<div id="aih-picker-header" style="padding:8px 12px;border-bottom:1px solid #444;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;cursor:move;user-select:none;">' +
                    '<span id="aih-picker-title" style="color:#eee;font-weight:600;font-size:13px;"></span>' +
                    '<span id="aih-picker-close" style="color:#888;cursor:pointer;font-size:18px;line-height:1;">&times;</span>' +
                '</div>' +
                // Filtre auteur unique (s'applique aux deux colonnes)
                '<div id="aih-picker-authors" style="display:flex;flex-wrap:wrap;gap:2px;padding:4px 10px;border-bottom:1px solid #444;overflow-y:auto;max-height:48px;flex-shrink:0;"></div>' +
                // Corps : grille 2 colonnes
                '<div style="display:flex;flex:1;min-height:0;padding:6px 10px;gap:6px;">' +
                    // Colonne gauche : tous les items
                    '<div style="display:flex;flex-direction:column;flex:1;min-width:0;">' +
                        '<div id="aih-picker-left-label" style="font-size:10px;color:#888;margin-bottom:3px;"></div>' +
                        '<div style="display:flex;gap:4px;margin-bottom:3px;">' +
                            '<input id="aih-picker-left-search" type="text" placeholder="Mot-cl\u00e9..." style="flex:1;padding:3px 6px;border-radius:4px;border:1px solid #555;background:#1a1a1e;color:#ccc;font-size:11px;box-sizing:border-box;outline:none;">' +
                        '</div>' +
                        '<div id="aih-picker-left-list" style="flex:1;overflow-y:auto;border:1px solid #444;border-radius:4px;padding:2px;background:#1a1a1e;min-height:80px;"></div>' +
                    '</div>' +
                    // Boutons centraux
                    '<div style="display:flex;flex-direction:column;justify-content:center;gap:6px;padding:2px 0;flex-shrink:0;">' +
                        '<button id="aih-picker-to-right" title="D\u00e9placer vers la droite" style="padding:4px 6px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:13px;line-height:1;">\u2192</button>' +
                        '<button id="aih-picker-to-left" title="D\u00e9placer vers la gauche" style="padding:4px 6px;border-radius:4px;border:1px solid #555;background:#3a3a3e;color:#ccc;cursor:pointer;font-size:13px;line-height:1;">\u2190</button>' +
                    '</div>' +
                    // Colonne droite : shortlist
                    '<div style="display:flex;flex-direction:column;flex:1;min-width:0;">' +
                        '<div id="aih-picker-right-label" style="font-size:10px;color:#888;margin-bottom:3px;"></div>' +
                        '<div style="display:flex;gap:4px;margin-bottom:3px;">' +
                            '<input id="aih-picker-right-search" type="text" placeholder="Mot-cl\u00e9..." style="flex:1;padding:3px 6px;border-radius:4px;border:1px solid #555;background:#1a1a1e;color:#ccc;font-size:11px;box-sizing:border-box;outline:none;">' +
                        '</div>' +
                        '<div id="aih-picker-right-list" style="flex:1;overflow-y:auto;border:1px solid #444;border-radius:4px;padding:2px;background:#1a1a1e;min-height:80px;"></div>' +
                    '</div>' +
                '</div>' +
                // Zone description en bas
                '<div id="aih-picker-desc" style="flex-shrink:0;padding:4px 10px;border-top:1px solid #444;min-height:24px;max-height:80px;overflow-y:auto;font-size:11px;color:#999;display:none;"></div>' +
                // Footer : boutons
                '<div style="padding:6px 12px;border-top:1px solid #444;display:flex;justify-content:flex-end;gap:6px;flex-shrink:0;">' +
                    '<button id="aih-picker-cancel" style="padding:4px 12px;border-radius:4px;border:1px solid #555;background:transparent;color:#888;cursor:pointer;font-size:11px;">Annuler</button>' +
                    '<button id="aih-picker-save" style="padding:4px 16px;border-radius:4px;border:none;background:#6366f1;color:white;cursor:pointer;font-size:11px;font-weight:600;">Valider</button>' +
                '</div>';
            document.body.appendChild(modal);

            // ── Drag ──
            var header = document.getElementById('aih-picker-header');
            var dragOffX = 0, dragOffY = 0;
            header.addEventListener('mousedown', function(e) {
                if (e.target.id === 'aih-picker-close') return;
                dragOffX = e.clientX - modal.offsetLeft;
                dragOffY = e.clientY - modal.offsetTop;
                function onMove(ev) {
                    modal.style.left = Math.max(0, ev.clientX - dragOffX) + 'px';
                    modal.style.top = Math.max(0, ev.clientY - dragOffY) + 'px';
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    saveModalRect();
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            // ── Resize (coin bas-droit) ──
            var resizeHandle = document.createElement('div');
            Object.assign(resizeHandle.style, {
                position: 'absolute', right: '0', bottom: '0',
                width: '14px', height: '14px', cursor: 'nwse-resize',
                background: 'linear-gradient(135deg, transparent 50%, #555 50%)',
                borderRadius: '0 0 10px 0',
            });
            modal.style.position = 'fixed';
            modal.appendChild(resizeHandle);

            resizeHandle.addEventListener('mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var startX = e.clientX, startY = e.clientY;
                var startW = modal.offsetWidth, startH = modal.offsetHeight;
                function onMove(ev) {
                    var newW = Math.max(400, startW + (ev.clientX - startX));
                    var newH = Math.max(350, startH + (ev.clientY - startY));
                    modal.style.width = newW + 'px';
                    modal.style.height = newH + 'px';
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    saveModalRect();
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            function saveModalRect() {
                try {
                    localStorage.setItem('aihPickerModalRect', JSON.stringify({
                        left: modal.offsetLeft,
                        top: modal.offsetTop,
                        width: modal.offsetWidth,
                        height: modal.offsetHeight,
                    }));
                } catch(e) {}
            }

            // ── Listeners globaux installés UNE FOIS (dispatch via refs updatables) ──
            if (!window._aihPickerInstalled) {
                window._aihPickerInstalled = true;
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape' && modal.style.display !== 'none') {
                        if (window._aihCurrentClose) window._aihCurrentClose();
                    }
                });
                document.getElementById('aih-picker-left-search').addEventListener('input', function() {
                    if (window._aihCurrentRender) window._aihCurrentRender();
                });
                document.getElementById('aih-picker-right-search').addEventListener('input', function() {
                    if (window._aihCurrentRender) window._aihCurrentRender();
                });
            }
        }

        var overlay = document.getElementById('aih-picker-overlay');

        // ── Dirty tracking ──
        var _dirty = false;

        async function tryClose() {
            if (_dirty) {
                var confirmed = await window.aihShowConfirm('Modifications non sauvegardées', 'Annuler les changements ?');
                if (!confirmed) return;
            }
            _dirty = false;
            modal.style.display = 'none';
            if (overlay) overlay.style.display = 'none';
        }

        // ── Mise à jour des refs dispatch (closures fraîches à chaque ouverture) ──
        window._aihCurrentClose = tryClose;
        window._aihCurrentRender = renderLists;

        // ── Event bindings (overwritables, pas d'accumulation) ──
        document.getElementById('aih-picker-close').onclick = function() { window._aihCurrentClose(); };
        document.getElementById('aih-picker-cancel').onclick = function() { _dirty = false; window._aihCurrentClose(); };
        overlay.onclick = function() { window._aihCurrentClose(); };
        document.getElementById('aih-picker-to-right').onclick = function() { transferSelected('left', 'right'); };
        document.getElementById('aih-picker-to-left').onclick = function() { transferSelected('right', 'left'); };
        document.getElementById('aih-picker-save').onclick = function() {
            var result = Array.from(shortlistSet);
            onSave(result);
            _dirty = false;
            window._aihCurrentClose();
        };

        // ── Caches ──
        var _cachedAllItems = allItems;
        var _cachedIdField = idField;
        var _cachedNameField = nameField;
        var _cachedAuthorField = authorField;
        var _cachedDescField = descField;

        // ── Auteurs activés (Set de noms, vide = tous) ──
        var _enabledAuthors = new Set();
        // (déclaré localement dans populateAuthorChecks)

        function isAuthorEnabled(author) {
            if (_enabledAuthors.size === 0) return false;  // aucun coché → rien affiché
            return _enabledAuthors.has(author);
        }

        // ── Afficher la description d'un item ──
        var _descItemId = null;

        function showDescription(item) {
            var descDiv = document.getElementById('aih-picker-desc');
            if (!descDiv) return;
            if (!item || !_cachedDescField || !item[_cachedDescField]) {
                descDiv.style.display = 'none';
                _descItemId = null;
                return;
            }
            var desc = item[_cachedDescField];
            if (typeof desc !== 'string') desc = String(desc);
            descDiv.textContent = desc;
            descDiv.style.display = 'block';
            _descItemId = String(item[_cachedIdField]);
        }

        // ── Rendu des listes ──
        function renderLists() {
            var leftSearch = document.getElementById('aih-picker-left-search').value.toLowerCase().trim();
            var rightSearch = document.getElementById('aih-picker-right-search').value.toLowerCase().trim();

            var leftList = document.getElementById('aih-picker-left-list');
            var rightList = document.getElementById('aih-picker-right-list');

            var leftItems = _cachedAllItems.filter(function(item) {
                var id = String(item[_cachedIdField]);
                if (shortlistSet.has(id)) return false;
                if (!isAuthorEnabled(item[_cachedAuthorField] || '')) return false;
                if (leftSearch) {
                    var name = (item[_cachedNameField] || '').toLowerCase();
                    if (!name.includes(leftSearch)) return false;
                }
                return true;
            });

            var rightItems = _cachedAllItems.filter(function(item) {
                var id = String(item[_cachedIdField]);
                if (!shortlistSet.has(id)) return false;
                if (!isAuthorEnabled(item[_cachedAuthorField] || '')) return false;
                if (rightSearch) {
                    var name = (item[_cachedNameField] || '').toLowerCase();
                    if (!name.includes(rightSearch)) return false;
                }
                return true;
            });

            renderList(leftList, leftItems, 'left');
            renderList(rightList, rightItems, 'right');

            var leftLabel = document.getElementById('aih-picker-left-label');
            var rightLabel = document.getElementById('aih-picker-right-label');
            if (leftLabel) leftLabel.textContent = 'Tous les ' + label.toLowerCase() + 's (' + leftItems.length + ')';
            if (rightLabel) rightLabel.textContent = 'Dans le dropdown (' + rightItems.length + ')';

            // Mettre à jour la description si l'item affiché n'est plus visible
            if (_descItemId) {
                var stillVisible = leftItems.concat(rightItems).some(function(item) {
                    return String(item[_cachedIdField]) === _descItemId;
                });
                if (!stillVisible) showDescription(null);
            }
        }

        // ── Rendu d'une liste (compact: nom (auteur)) ──
        function renderList(container, items, side) {
            container.innerHTML = '';
            if (items.length === 0) {
                var empty = document.createElement('div');
                empty.textContent = 'Aucun';
                Object.assign(empty.style, { padding: '12px', textAlign: 'center', color: '#666', fontSize: '11px' });
                container.appendChild(empty);
                return;
            }
            items.forEach(function(item) {
                var div = document.createElement('div');
                var itemId = String(item[_cachedIdField]);

                div.dataset.id = itemId;
                div.dataset.side = side;

                var isSelected = _selected.has(side + ':' + itemId);
                var isDescShown = (_descItemId === itemId);

                Object.assign(div.style, {
                    padding: '3px 6px', margin: '1px 0', borderRadius: '3px',
                    cursor: 'pointer', fontSize: '11px',
                    border: isDescShown ? '1px solid #6366f1' : '1px solid transparent',
                    background: isSelected ? '#4a4a6e' : (isDescShown ? '#2a2a4e' : 'transparent'),
                    color: '#ddd',
                });
                div.onmouseenter = function() {
                    if (!isSelected) div.style.background = '#3a3a3e';
                };
                div.onmouseleave = function() {
                    if (!isSelected) div.style.background = isDescShown ? '#2a2a4e' : 'transparent';
                };

                // Texte compact : "Nom (Auteur)"
                var text = item[_cachedNameField] || ('Item ' + itemId);
                if (item[_cachedAuthorField]) {
                    text += ' (' + item[_cachedAuthorField] + ')';
                }
                div.textContent = text;

                // Click pour sélection
                div.onclick = function(e) {
                    var key = side + ':' + itemId;
                    if (e.shiftKey) {
                        var siblings = Array.from(container.children);
                        var idx = siblings.indexOf(div);
                        var lastClicked = siblings.findIndex(function(s) {
                            return _selected.has(side + ':' + s.dataset.id);
                        });
                        if (lastClicked >= 0 && lastClicked !== idx) {
                            var start = Math.min(lastClicked, idx);
                            var end = Math.max(lastClicked, idx);
                            for (var i = start; i <= end; i++) {
                                var sid = siblings[i].dataset.id;
                                if (sid) _selected.add(side + ':' + sid);
                            }
                        } else {
                            _selected.add(key);
                        }
                    } else if (e.ctrlKey || e.metaKey) {
                        if (_selected.has(key)) {
                            _selected.delete(key);
                        } else {
                            _selected.add(key);
                        }
                    } else if (e.detail === 1) {
                        // Simple click : si l'item a une description, on la montre
                        _selected.clear();
                        _selected.add(key);
                        if (_cachedDescField && item[_cachedDescField]) {
                            if (_descItemId === itemId) {
                                showDescription(null);  // re-click → ferme
                            } else {
                                showDescription(item);
                            }
                        } else {
                            showDescription(null);
                        }
                    }
                    renderLists();
                };

                container.appendChild(div);
            });
        }

        // ── Transfert de sélection ──
        function transferSelected(fromSide, toSide) {
            var toMove = [];
            _selected.forEach(function(key) {
                if (key.startsWith(fromSide + ':')) {
                    toMove.push(key.split(':')[1]);
                }
            });
            if (toMove.length === 0) return;

            if (fromSide === 'left') {
                toMove.forEach(function(id) { shortlistSet.add(id); });
            } else {
                toMove.forEach(function(id) { shortlistSet.delete(id); });
            }
            _dirty = true;
            _selected.clear();
            renderLists();
        }

        var _selected = new Set();

        // ── Auteurs : checkboxes ──
        function populateAuthorChecks() {
            var authors = new Set();
            _cachedAllItems.forEach(function(item) {
                if (item[_cachedAuthorField]) authors.add(item[_cachedAuthorField]);
            });
            var allAuthors = Array.from(authors).sort();
            var container = document.getElementById('aih-picker-authors');
            if (!container) return;
            container.innerHTML = '';
            allAuthors.forEach(function(a) {
                var label = document.createElement('label');
                Object.assign(label.style, {
                    display: 'inline-flex', alignItems: 'center', gap: '2px',
                    fontSize: '10px', color: '#aaa', cursor: 'pointer',
                    padding: '1px 4px', borderRadius: '3px',
                    background: '#2a2a2e', whiteSpace: 'nowrap',
                });
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = isAuthorEnabled(a);
                Object.assign(cb.style, { margin: '0', cursor: 'pointer' });
                cb.onchange = function() {
                    if (cb.checked) {
                        _enabledAuthors.add(a);
                    } else {
                        _enabledAuthors.delete(a);
                    }
                    renderLists();
                };
                label.appendChild(cb);
                label.appendChild(document.createTextNode(a));
                container.appendChild(label);
            });
        }

        // ── Initialisation ──
        document.getElementById('aih-picker-title').textContent = 'Choisir les ' + label.toLowerCase() + 's du dropdown';
        _selected.clear();
        currentShortlist.forEach(function(id) { shortlistSet.add(String(id)); });

        populateAuthorChecks();
        renderLists();
        showDescription(null);

        document.getElementById('aih-picker-left-search').value = '';
        document.getElementById('aih-picker-right-search').value = '';

        // Afficher
        modal.style.display = 'flex';
        if (overlay) overlay.style.display = 'block';
        setTimeout(function() { document.getElementById('aih-picker-left-search').focus(); }, 100);
    }

    // ── Exposer ──
    window.AIH = window.AIH || {};
    window.AIH.PickerConfig = {
        setup: setupPickerConfig,
        openModal: openPickerModal,
    };
})();
