    /* ── Preview tab : galerie des dernières images générées ── */
    // L'endpoint /api/preview/* nécessite une auth par Bearer token (API key).
    // On récupère la clé via /auth/token (comme loadApiKey dans app-admin.js)
    // puis on l'utilise pour fetcher les images en blob → objectURL.

    var previewState = {
      apiKey: null,          // Bearer token (API key)
      tokenLoading: false,   // évite les fetchs concurrents du token
      pollTimer: null,       // setInterval id
      lastImages: null,      // dernière liste reçue (pour éviter re-render inutile)
      objectUrls: [],        // objectURLs créés (à révoquer au refresh)
      active: false          // onglet actuellement affiché
    };

    var PREVIEW_POLL_INTERVAL = 5000; // 5 secondes

    /* ── Cycle de vie de l'onglet ── */

    function previewStart() {
      if (LOCAL_MODE) { previewShowError('Indisponible en mode local'); return; }
      previewState.active = true;
      previewShowLoading();
      previewLoad();              // premier chargement immédiat
      previewStartPolling();
    }

    function previewStop() {
      previewState.active = false;
      previewStopPolling();
    }

    function previewStartPolling() {
      previewStopPolling();
      previewState.pollTimer = setInterval(previewLoad, PREVIEW_POLL_INTERVAL);
    }

    function previewStopPolling() {
      if (previewState.pollTimer) {
        clearInterval(previewState.pollTimer);
        previewState.pollTimer = null;
      }
    }

    function previewRefreshNow() {
      if (LOCAL_MODE) return;
      previewShowLoading();
      previewLoad();
    }

    /* ── Récupération de l'API key (Bearer token) ── */

    async function previewGetApiKey() {
      if (previewState.apiKey) return previewState.apiKey;
      if (previewState.tokenLoading) return null;
      previewState.tokenLoading = true;
      try {
        var res = await fetch(API + '/auth/token');
        if (!res.ok) throw new Error('Token ' + res.status);
        var data = await safeJson(res);
        if (data && data.token) {
          previewState.apiKey = data.token;
          return previewState.apiKey;
        }
        throw new Error('Pas de token');
      } finally {
        previewState.tokenLoading = false;
      }
    }

    /* ── Chargement de la liste des images ── */

    async function previewLoad() {
      if (LOCAL_MODE || !previewState.active) return;
      try {
        var key = await previewGetApiKey();
        if (!key) {
          if (!previewState.apiKey) {
            previewShowError('Authentification requise. Connecte-toi pour voir les images.');
            return;
          }
        }
        var res = await fetch(API + '/preview/recent', {
          headers: { 'Authorization': 'Bearer ' + previewState.apiKey }
        });
        if (!res.ok) {
          if (res.status === 401) {
            // Token invalide/expiré : on l'oublie et on réessaiera
            previewState.apiKey = null;
          }
          throw new Error('HTTP ' + res.status);
        }
        var data = await safeJson(res);
        if (!data || data.error) throw new Error((data && data.error) || 'Réponse invalide');
        var images = (data.images && Array.isArray(data.images)) ? data.images : [];
        previewRender(images);
      } catch (err) {
        // Ne pas écraser l'affichage pendant le polling si on a déjà des images
        if (!previewState.lastImages || previewState.lastImages.length === 0) {
          previewShowError('Erreur de chargement : ' + err.message);
        }
      }
    }

    /* ── Affichage ── */

    function previewShowLoading() {
      var el = $('preview-loading');
      if (el) el.classList.remove('hidden');
      $('preview-empty').classList.add('hidden');
      $('preview-gallery').classList.add('hidden');
      $('preview-error').classList.add('hidden');
    }

    function previewShowError(msg) {
      $('preview-loading').classList.add('hidden');
      $('preview-empty').classList.add('hidden');
      $('preview-gallery').classList.add('hidden');
      var errEl = $('preview-error');
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }

    function previewShowEmpty() {
      $('preview-loading').classList.add('hidden');
      $('preview-error').classList.add('hidden');
      $('preview-gallery').classList.add('hidden');
      var emptyEl = $('preview-empty');
      emptyEl.classList.remove('hidden');
      emptyEl.classList.add('flex');
    }

    // Comparaison rapide pour éviter un re-render (et re-fetch d'images) si rien n'a changé
    function previewImagesChanged(newImages) {
      var prev = previewState.lastImages;
      if (!prev || prev.length !== newImages.length) return true;
      for (var i = 0; i < newImages.length; i++) {
        if (!prev[i] || prev[i].id !== newImages[i].id) return true;
      }
      return false;
    }

    function previewRender(images) {
      $('preview-loading').classList.add('hidden');
      $('preview-error').classList.add('hidden');

      var countEl = $('preview-count');
      if (countEl) countEl.textContent = images.length + ' image' + (images.length > 1 ? 's' : '');

      if (!images.length) {
        previewState.lastImages = images;        // mémoriser même si empty
        previewShowEmpty();
        return;
      }

      // Optimisation : si la liste n'a pas changé, on ne re-render pas
      // (évite de re-fetch toutes les images en blob à chaque poll)
      if (!previewImagesChanged(images)) return;  // compare avec l'ANCIENNE liste

      previewState.lastImages = images;          // DÉPLACÉ ICI (après comparaison)

      // Révoquer les anciens objectURLs
      previewRevokeUrls();

      var gallery = $('preview-gallery');
      gallery.classList.remove('hidden');

      // La première image (la plus récente) est affichée en grand
      var html = '';

      // Image vedette
      if (images.length > 0) {
        var hero = images[0];
        html += previewHeroCard(hero);
      }

      // Grille pour le reste
      if (images.length > 1) {
        html += '<div class="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-4">';
        for (var i = 1; i < images.length; i++) {
          html += previewGridCard(images[i]);
        }
        html += '</div>';
      }

      gallery.innerHTML = html;

      // Charger les images en blob (auth Bearer) → objectURL
      images.forEach(function(img) {
        previewLoadImageBlob(img);
      });
    }

    function previewHeroCard(img) {
      var id = 'preview-img-' + img.id;
      var ts = previewFormatDate(img.created_at);
      var name = previewEscape(img.filename || ('Image #' + img.id));
      return '<div class="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">'
        + '<div class="aspect-video w-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center">'
        + '<img id="' + id + '" alt="' + name + '" class="max-w-full max-h-full object-contain opacity-0 transition-opacity duration-300" style="max-height: 60vh;">'
        + '</div>'
        + '<div class="px-3 py-2 flex items-center justify-between gap-2">'
        + '<span class="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">' + name + '</span>'
        + '<span class="text-xs text-slate-400 shrink-0">' + ts + '</span>'
        + '</div>'
        + '</div>';
    }

    function previewGridCard(img) {
      var id = 'preview-img-' + img.id;
      var ts = previewFormatDate(img.created_at);
      var name = previewEscape(img.filename || ('Image #' + img.id));
      return '<div class="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm flex flex-col">'
        + '<div class="aspect-square w-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center">'
        + '<img id="' + id + '" alt="' + name + '" class="max-w-full max-h-full object-cover opacity-0 transition-opacity duration-300">'
        + '</div>'
        + '<div class="px-2 py-1.5 flex items-center justify-between gap-1">'
        + '<span class="text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate">' + name + '</span>'
        + '<span class="text-[10px] text-slate-400 shrink-0">' + ts + '</span>'
        + '</div>'
        + '</div>';
    }

    /* ── Chargement d'une image via blob (auth Bearer) ── */

    async function previewLoadImageBlob(img) {
      if (!previewState.apiKey) return;
      var imgEl = document.getElementById('preview-img-' + img.id);
      if (!imgEl) return;
      try {
        var res = await fetch(API + '/preview/image/' + img.id, {
          headers: { 'Authorization': 'Bearer ' + previewState.apiKey }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        var url = URL.createObjectURL(blob);
        previewState.objectUrls.push(url);
        // L'élément a pu être remplacé entre-temps (re-render)
        var el = document.getElementById('preview-img-' + img.id);
        if (el) {
          el.onload = function() { el.style.opacity = '1'; };
          el.onerror = function() { URL.revokeObjectURL(url); };
          el.src = url;
        } else {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        // Afficher un placeholder d'erreur discret
        var el = document.getElementById('preview-img-' + img.id);
        if (el) {
          el.alt = 'Erreur de chargement';
          el.style.opacity = '0.3';
        }
      }
    }

    function previewRevokeUrls() {
      previewState.objectUrls.forEach(function(url) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      });
      previewState.objectUrls = [];
    }

    /* ── Utilitaires ── */

    function previewFormatDate(iso) {
      if (!iso) return '';
      try {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      } catch (e) {
        return '';
      }
    }

    function previewEscape(s) {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }