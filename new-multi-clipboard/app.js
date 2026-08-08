/* ==========================================================================
   新マルチクリップボード — app.js
   中身は data.js に固定。ユーザーは「探す・コピーする・その場で少し直す」だけ。
   ========================================================================== */
(function () {
  'use strict';

  var DATA = window.CLIP_DATA;
  var ITEMS = DATA.items;
  var CATS = DATA.categories;
  var TAGS = DATA.tags;

  var CAT_BY_ID = {};
  CATS.forEach(function (c) { CAT_BY_ID[c.id] = c; });
  var TAG_COLOR = {};
  TAGS.forEach(function (t) { TAG_COLOR[t.id] = t.color; });

  var $ = function (id) { return document.getElementById(id); };

  /* 申請プロンプトに差し込むリポジトリ情報。
     置き場所を変えたときは、ここだけ直せばプロンプト側も追従する。 */
  var REPO = {
    url: 'https://github.com/makoto1465/blob-chain',
    clone: 'https://github.com/makoto1465/blob-chain.git',
    branch: 'main',
    dir: 'new-multi-clipboard',
    file: 'new-multi-clipboard/data.js',
    vercelScope: 'makoto1465s-projects',
    site: 'https://new-multi-clipboard-makoto1465s-projects.vercel.app/',
    publicAlias: 'new-multi-clipboard.vercel.app'
  };

  /* ---------------------------------------------------------------- 保存領域
     保存するのは「使った回数・お気に入り・見た目の設定」だけ。
     クリップの中身は絶対に保存しない。 */
  var LS_KEY = 'nmc.v1';
  var store = load();

  function load() {
    var base = {
      used: {}, last: {}, fav: [], theme: 'dark', tour: false,
      tagMode: 'or', sort: 'recommend', reqs: [],
      note: { content: '', history: [], seeded: false }
    };
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return base;
      var o = JSON.parse(raw);
      return {
        used: o.used || {},
        last: o.last || {},
        fav: Array.isArray(o.fav) ? o.fav : [],
        theme: o.theme === 'light' ? 'light' : 'dark',
        tour: !!o.tour,
        tagMode: o.tagMode === 'and' ? 'and' : 'or',
        sort: o.sort || 'recommend',
        reqs: Array.isArray(o.reqs) ? o.reqs : [],
        note: {
          content: (o.note && typeof o.note.content === 'string') ? o.note.content : '',
          history: (o.note && Array.isArray(o.note.history)) ? o.note.history : [],
          seeded: !!(o.note && o.note.seeded)
        }
      };
    } catch (e) { return base; }
  }

  var saveWarned = false;
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      // 容量オーバーなどで保存できないとき、黙って消えると困るので一度だけ知らせる
      if (!saveWarned) {
        saveWarned = true;
        try { toast('保存できませんでした。メモが消える可能性があるのでコピーして退避してください', 'err'); } catch (e2) {}
      }
      return false;
    }
  }

  var state = {
    q: '',
    cat: 'all',
    tags: [],
    tagMode: store.tagMode,
    sort: store.sort
  };

  /* -------------------------------------------------------------- 小道具 */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(s) {
    return String(s).toLowerCase().replace(/[　\s]+/g, '');
  }

  function fullText(item) {
    if (item.type === 'collection') {
      return item.blocks.map(function (b) { return b.label + '\n' + b.text; }).join('\n');
    }
    return item.body;
  }

  function itemChars(item) {
    if (item.type === 'collection') {
      return item.blocks.reduce(function (n, b) { return n + b.text.length; }, 0);
    }
    return item.body.length;
  }

  function isFav(id) { return store.fav.indexOf(id) !== -1; }

  function toggleFav(id) {
    var i = store.fav.indexOf(id);
    if (i === -1) store.fav.push(id); else store.fav.splice(i, 1);
    save();
  }

  function markUsed(id) {
    store.used[id] = (store.used[id] || 0) + 1;
    store.last[id] = Date.now();
    save();
  }

  /* --------------------------------------------------- 入力欄（空欄）の検出 */
  function findSlots(text) {
    var slots = [];
    var push = function (index, length) {
      if (length <= 0) return;
      for (var i = 0; i < slots.length; i++) {
        if (index < slots[i].index + slots[i].length && slots[i].index < index + length) return;
      }
      slots.push({ index: index, length: length });
    };

    var re = /【[^】\n]*(?:ここ|入力|記入)[^】\n]*】|ここに[^\n]{0,24}(?:記入|入力|貼り付け|書い)[^\n]*|↓{2,}|\{[^{}\n]{1,40}\}|〇〇/g;
    var m;
    while ((m = re.exec(text)) !== null) push(m.index, m[0].length);

    // 【見出し】のあとが空行 → 記入欄とみなす
    var head = /^【[^】\n]{1,40}】[ \t]*$/gm;
    while ((m = head.exec(text)) !== null) {
      var after = text.slice(m.index + m[0].length, m.index + m[0].length + 4);
      if (/^\r?\n\s*\r?\n/.test(after)) push(m.index, m[0].length);
    }

    // 「〜：」で終わって次が空行の行（例：作りたいもの：）
    var colon = /^[^\n]{1,24}[:：][ \t]*$/gm;
    while ((m = colon.exec(text)) !== null) {
      var a2 = text.slice(m.index + m[0].length, m.index + m[0].length + 4);
      if (/^\r?\n\s*\r?\n/.test(a2)) push(m.index, m[0].length);
    }

    slots.sort(function (a, b) { return a.index - b.index; });
    return slots;
  }

  function highlight(text) {
    var slots = findSlots(text);
    if (!slots.length) return esc(text);
    var out = '';
    var pos = 0;
    slots.forEach(function (s) {
      out += esc(text.slice(pos, s.index));
      out += '<mark>' + esc(text.slice(s.index, s.index + s.length)) + '</mark>';
      pos = s.index + s.length;
    });
    out += esc(text.slice(pos));
    return out;
  }

  function slotCount(item) {
    return findSlots(fullText(item)).length;
  }

  /* ------------------------------------------------------------ コピー処理 */
  function copyText(text) {
    // 新しいAPI → だめなら旧方式、の順に試す（権限・フォーカス切れでも拾えるように）
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (e) { reject(e); }
    });
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast' + (kind ? ' ' + kind : ''); }, 1900);
  }

  function doCopy(text, id, btn, label) {
    copyText(text).then(function () {
      if (id) { markUsed(id); }
      if (btn) {
        var old = btn.textContent;
        btn.textContent = '✓ コピー済み';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = old; btn.classList.remove('done'); }, 1400);
      }
      toast('📋 ' + (label || 'コピーしました'));
    }).catch(function () {
      toast('コピーできませんでした。長押しで選択してください', 'err');
    });
  }

  /* ------------------------------------------------------------ 絞り込み */
  function matches(item) {
    if (state.cat === 'fav') {
      if (!isFav(item.id)) return false;
    } else if (state.cat === 'recent') {
      if (!store.last[item.id]) return false;
    } else if (state.cat !== 'all') {
      if (item.cat !== state.cat) return false;
    }

    if (state.tags.length) {
      if (state.tagMode === 'and') {
        for (var i = 0; i < state.tags.length; i++) {
          if (item.tags.indexOf(state.tags[i]) === -1) return false;
        }
      } else {
        var hit = false;
        for (var j = 0; j < state.tags.length; j++) {
          if (item.tags.indexOf(state.tags[j]) !== -1) { hit = true; break; }
        }
        if (!hit) return false;
      }
    }

    if (state.q) {
      var hay = item._hay || (item._hay = norm(
        item.title + ' ' + item.summary + ' ' + item.tags.join(' ') +
        ' ' + CAT_BY_ID[item.cat].name + ' ' + fullText(item) + ' ' + (item.note || '')
      ));
      var terms = state.q.split(/[\s　]+/).filter(Boolean).map(norm);
      for (var k = 0; k < terms.length; k++) {
        if (hay.indexOf(terms[k]) === -1) return false;
      }
    }
    return true;
  }

  function sortItems(list) {
    var base = {};
    ITEMS.forEach(function (it, i) { base[it.id] = i; });
    var s = state.sort;
    return list.slice().sort(function (a, b) {
      if (s === 'used') {
        var d = (store.used[b.id] || 0) - (store.used[a.id] || 0);
        if (d) return d;
      } else if (s === 'recent') {
        var r = (store.last[b.id] || 0) - (store.last[a.id] || 0);
        if (r) return r;
      } else if (s === 'title') {
        return a.title.localeCompare(b.title, 'ja');
      } else {
        var fa = isFav(a.id) ? 0 : 1, fb = isFav(b.id) ? 0 : 1;
        if (fa !== fb) return fa - fb;
      }
      return base[a.id] - base[b.id];
    });
  }

  function visibleItems() {
    return sortItems(ITEMS.filter(matches));
  }

  /* ------------------------------------------------------------ 画面描画 */
  function catCount(id) {
    return ITEMS.filter(function (it) { return it.cat === id; }).length;
  }

  function pseudoCats() {
    return [
      { id: 'all', name: 'すべて', icon: '✳️', accent: '#94a3b8', count: ITEMS.length, lead: 'よく使うプロンプト・定型文・リンクを、探してすぐコピーするための場所です。' },
      { id: 'fav', name: 'お気に入り', icon: '⭐️', accent: '#fbbf24', count: store.fav.length, lead: '★を付けたものだけを表示しています。' },
      { id: 'recent', name: '最近使った', icon: '🕘', accent: '#38bdf8', count: Object.keys(store.last).length, lead: '直近でコピーしたものを新しい順に表示しています。' }
    ];
  }

  function allCatEntries() {
    return pseudoCats().concat(CATS.map(function (c) {
      return { id: c.id, name: c.name, icon: c.icon, accent: c.accent, count: catCount(c.id), lead: c.lead };
    }));
  }

  function renderCats() {
    var entries = allCatEntries();

    $('catbar').innerHTML = entries.map(function (c) {
      return '<button class="catchip' + (state.cat === c.id ? ' on' : '') + '" data-cat="' + c.id +
        '" style="--c:' + c.accent + '">' + c.icon + ' ' + esc(c.name) + ' <em>' + c.count + '</em></button>';
    }).join('');

    $('sideCats').innerHTML = entries.map(function (c) {
      return '<li><button class="side-cat' + (state.cat === c.id ? ' on' : '') + '" data-cat="' + c.id +
        '" style="--c:' + c.accent + '"><span class="ic">' + c.icon + '</span><span class="nm">' +
        esc(c.name) + '</span><span class="ct">' + c.count + '</span></button></li>';
    }).join('');

    $('bsCats').innerHTML = entries.map(function (c) {
      return '<button class="catchip' + (state.cat === c.id ? ' on' : '') + '" data-cat="' + c.id +
        '" style="--c:' + c.accent + '">' + c.icon + ' ' + esc(c.name) + ' <em>' + c.count + '</em></button>';
    }).join('');
  }

  function renderTags() {
    var counts = {};
    ITEMS.forEach(function (it) {
      it.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var html = TAGS.map(function (t) {
      return '<button class="tagchip' + (state.tags.indexOf(t.id) !== -1 ? ' on' : '') + '" data-tag="' +
        esc(t.id) + '" style="--c:' + t.color + '">' + esc(t.id) +
        '<span style="opacity:.6;font-size:11px">' + (counts[t.id] || 0) + '</span></button>';
    }).join('');
    $('sideTags').innerHTML = html;
    $('bsTags').innerHTML = html;

    var label = state.tagMode === 'and' ? 'すべて含む' : 'いずれか';
    $('tagMode').textContent = label;
    $('tagModeM').textContent = label;
  }

  function renderActiveFilters() {
    var box = $('activeFilters');
    var bits = [];
    if (state.q) {
      bits.push('<button class="af" data-clear="q">検索 <b>' + esc(state.q) + '</b><span>✕</span></button>');
    }
    state.tags.forEach(function (t) {
      bits.push('<button class="af" data-clear="tag" data-tag="' + esc(t) + '">タグ <b>' + esc(t) + '</b><span>✕</span></button>');
    });
    if (state.cat !== 'all') {
      var e = allCatEntries().filter(function (c) { return c.id === state.cat; })[0];
      if (e) bits.push('<button class="af" data-clear="cat">ジャンル <b>' + esc(e.name) + '</b><span>✕</span></button>');
    }
    box.innerHTML = bits.join('');

    var n = (state.q ? 1 : 0) + state.tags.length + (state.cat !== 'all' ? 1 : 0);
    var badge = $('filterCount');
    badge.textContent = n;
    badge.hidden = n === 0;
  }

  function cardHTML(item) {
    var cat = CAT_BY_ID[item.cat];
    var chars = itemChars(item);
    var slots = slotCount(item);
    var used = store.used[item.id] || 0;

    var meta = [];
    meta.push(chars.toLocaleString('ja-JP') + '字');
    if (item.type === 'collection') meta.push(item.blocks.length + 'パーツ');
    if (slots) meta.push('<span class="hot">入力欄 ' + slots + '</span>');
    if (used) meta.push('使用 ' + used + '回');
    if (hasDraft(item)) meta.push('<span class="draft">✏️ 編集中（未保存）</span>');
    var delReq = findReq('delete', item.id, null);
    var blockDels = store.reqs.filter(function (r) {
      return r.kind === 'delete' && r.clipId === item.id && normPart(r.part) !== null;
    }).length;
    if (delReq) meta.push('<span class="reqd">🗑 削除を申請中</span>');
    else if (blockDels) meta.push('<span class="reqd">🗑 ' + blockDels + 'パーツの削除を申請中</span>');
    if (hasReq('edit', item.id)) meta.push('<span class="reqe">📝 変更を申請中</span>');
    if (item.private) meta.push('<span class="lock">🔒 個人情報あり</span>');

    var body;
    if (item.type === 'collection') {
      var show = item.blocks.slice(0, 3);
      body = '<div class="rows">' + show.map(function (b, i) {
        var pending = !!findReq('delete', item.id, i);
        return '<div class="row' + (pending ? ' pending' : '') + '">' +
          '<span class="row-label" title="' + esc(b.label) + '">' + esc(b.label) + '</span>' +
          '<button class="row-copy" data-copyblock="' + i + '">コピー</button>' +
          '<button class="row-del' + (pending ? ' on' : '') + '" data-reqdelblock="' + i + '" ' +
            'title="' + (pending ? '削除申請を取り消す' : 'このパーツの削除を申請') + '" aria-label="このパーツの削除を申請">🗑</button>' +
        '</div>';
      }).join('') + '</div>';
      if (item.blocks.length > 3) {
        body += '<button class="more" data-open>＋ ほか' + (item.blocks.length - 3) + '件をすべて見る</button>';
      }
    } else {
      body = '';
    }

    var actions = (item.type === 'collection'
      ? '<button class="btn ghost grow" data-open>すべて開く</button>'
      : '<button class="btn primary grow" data-copyall>コピー</button>' +
        '<button class="btn ghost" data-open>開く</button>') +
      '<button class="btn ghost req-btn' + (delReq ? ' on' : '') + '" data-reqdel ' +
        'title="' + (delReq ? '削除申請を取り消す' : 'このクリップの削除を申請する') + '" ' +
        'aria-label="削除を申請">🗑</button>';

    return '<article class="card" data-id="' + item.id + '" style="--c:' + cat.accent + '">' +
      '<div class="card-head">' +
        '<span class="card-ic">' + cat.icon + '</span>' +
        '<h3 class="card-title" data-open>' + esc(item.title) + '</h3>' +
        '<button class="fav' + (isFav(item.id) ? ' on' : '') + '" data-fav aria-label="お気に入り">' +
          (isFav(item.id) ? '★' : '☆') + '</button>' +
      '</div>' +
      '<p class="card-summary">' + esc(item.summary) + '</p>' +
      (body || '') +
      '<div class="chips">' + item.tags.map(function (t) {
        return '<span class="chip" style="--c:' + (TAG_COLOR[t] || '#888') + '">' + esc(t) + '</span>';
      }).join('') + '</div>' +
      '<div class="card-meta">' + meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>' +
      '<div class="card-actions">' + actions + '</div>' +
    '</article>';
  }

  function render() {
    renderCats();
    renderTags();
    renderActiveFilters();

    var list = visibleItems();
    var entry = allCatEntries().filter(function (c) { return c.id === state.cat; })[0];

    $('viewTitle').textContent = entry ? entry.name : 'すべて';
    $('viewCount').textContent = list.length + ' / ' + ITEMS.length + ' 件';
    $('viewLead').textContent = state.q ? '「' + state.q + '」の検索結果' : (entry ? entry.lead : '');

    $('grid').innerHTML = list.map(cardHTML).join('');
    $('empty').hidden = list.length !== 0;
    $('grid').hidden = list.length === 0;

    // 0件のとき「ジャンル・タグを外せば見つかる」を案内する
    if (list.length === 0) {
      var savedCat = state.cat, savedTags = state.tags;
      state.cat = 'all';
      state.tags = [];
      var wide = ITEMS.filter(matches).length;
      state.cat = savedCat;
      state.tags = savedTags;

      var btn = $('emptyWide');
      var narrowed = savedCat !== 'all' || savedTags.length > 0;
      if (wide > 0 && narrowed) {
        btn.hidden = false;
        btn.textContent = 'すべてのジャンルから探す（' + wide + '件）';
        $('emptySub').textContent = 'いま選んでいるジャンル／タグの中にはありませんでした。';
      } else {
        btn.hidden = true;
        $('emptySub').textContent = 'キーワードを短くするか、絞り込みを外してみてください。';
      }
    }

    $('footStats').textContent =
      ITEMS.length + '件 / ' + CATS.length + 'ジャンル / ' + TAGS.length + 'タグ ・ データ更新 ' + DATA.generatedAt;
  }

  /* -------------------------------------------------------------- 詳細画面 */
  var current = null;   // 表示中のアイテム
  var drafts = {};      // その場の編集内容（メモリのみ・リロードで消える）

  function draftKey(id, i) { return id + '::' + (i == null ? 'body' : i); }

  function hasDraft(item) {
    if (item.type === 'collection') {
      for (var i = 0; i < item.blocks.length; i++) if (isEdited(item, i)) return true;
      return false;
    }
    return isEdited(item, null);
  }

  function getText(item, i) {
    var k = draftKey(item.id, i);
    if (drafts[k] != null) return drafts[k];
    return i == null ? item.body : item.blocks[i].text;
  }

  function isEdited(item, i) {
    var k = draftKey(item.id, i);
    return drafts[k] != null && drafts[k] !== (i == null ? item.body : item.blocks[i].text);
  }

  var editing = {};   // { 'id::i': true }

  function openDetail(id) {
    current = ITEMS.filter(function (it) { return it.id === id; })[0];
    if (!current) return;
    editing = {};
    var cat = CAT_BY_ID[current.cat];

    var sheet = document.querySelector('#detail .sheet');
    sheet.style.setProperty('--c', cat.accent);

    $('sheetCat').textContent = cat.icon + ' ' + cat.name;
    $('sheetTitle').textContent = current.title;
    $('sheetSummary').textContent = current.summary;
    $('sheetTags').innerHTML = current.tags.map(function (t) {
      return '<span class="chip" style="--c:' + (TAG_COLOR[t] || '#888') + '">' + esc(t) + '</span>';
    }).join('');

    var note = $('sheetNote');
    if (current.note) { note.textContent = '💡 ' + current.note; note.hidden = false; }
    else { note.hidden = true; }

    $('sheetFav').textContent = isFav(current.id) ? '★' : '☆';
    $('sheetFav').classList.toggle('on', isFav(current.id));

    renderSheetBody();

    $('detail').hidden = false;
    document.body.classList.add('locked');
    sheet.scrollTop = 0;
  }

  function closeDetail() {
    $('detail').hidden = true;
    document.body.classList.remove('locked');
    current = null;
    render();
  }

  function partHTML(item, i, label, no) {
    var text = getText(item, i);
    var key = draftKey(item.id, i);
    var on = !!editing[key];
    var edited = isEdited(item, i);
    var slots = findSlots(text).length;

    var head = label == null ? '' :
      '<div class="block-head"><span class="block-no">' + no + '</span>' +
      '<span class="block-label">' + esc(label) + '</span></div>';

    var editReq = findReq('edit', item.id, i);
    var partDel = i == null ? null : findReq('delete', item.id, i);

    var tools =
      '<div class="tools">' +
        '<button class="btn primary sm" data-part="' + i + '" data-act="copy">' +
          (edited ? '編集した内容をコピー' : 'コピー') + '</button>' +
        '<button class="btn ghost sm" data-part="' + i + '" data-act="edit">' +
          (on ? '編集をとじる' : '✏️ 編集してコピー') + '</button>' +
        '<button class="btn ghost sm" data-part="' + i + '" data-act="tonote">📝 メモへ</button>' +
        (on ? '<button class="btn ghost sm" data-part="' + i + '" data-act="slot">▶ 空欄へ</button>' : '') +
        (edited ? '<button class="btn ghost sm req-mark" data-part="' + i + '" data-act="req">📝 ' +
          (editReq ? '変更申請を上書き' : '変更を申請') + '</button>' : '') +
        (edited ? '<button class="btn ghost sm" data-part="' + i + '" data-act="reset">元に戻す</button>' : '') +
        (i == null ? '' :
          '<button class="btn ghost sm req-btn-wide' + (partDel ? ' on' : '') + '" data-part="' + i + '" data-act="reqdelpart">' +
          (partDel ? '🗑 削除申請を取り消す' : '🗑 このパーツの削除を申請') + '</button>') +
        '<span class="spacer"></span>' +
        '<span class="stat">' + text.length.toLocaleString('ja-JP') + '字' +
          (slots ? ' ・ 入力欄 ' + slots : '') + (edited ? ' ・ 編集中' : '') +
          (editReq ? ' ・ 📝 申請済み' : '') + (partDel ? ' ・ 🗑 削除申請中' : '') + '</span>' +
      '</div>';

    var content = on
      ? '<div class="edit-banner">✏️ ここでの書き換えは<b>保存されません</b>。閉じるかリロードすると元に戻ります。コピーだけして使ってください。</div>' +
        '<textarea class="editor" data-editor="' + i + '" spellcheck="false">' + esc(text) + '</textarea>'
      : '<div class="pre-wrap"><pre class="pre">' + highlight(text) + '</pre></div>';

    if (label == null) return tools + content;
    return '<section class="block">' + head + '<div class="block-body">' + tools + content + '</div></section>';
  }

  function renderSheetBody() {
    var item = current;
    if (!item) return;
    var html = '';

    if (item.type === 'collection') {
      html += '<div class="tools">' +
        '<button class="btn ghost sm" data-act="copyall">まとめて全部コピー（' + item.blocks.length + 'パーツ）</button>' +
        '<button class="btn ghost sm" data-act="allnote">📝 まとめてメモへ</button>' +
        '<span class="spacer"></span>' +
        '<span class="stat">パーツごとにコピーできます</span>' +
      '</div>';
      html += item.blocks.map(function (b, i) {
        return partHTML(item, i, b.label, i + 1);
      }).join('');
    } else {
      html += partHTML(item, null, null, 0);
    }

    var delReq = findReq('delete', item.id, null);
    html += '<div class="sheet-reqbar">' +
      '<span class="stat">直したい・いらないと思ったら、申請リストに入れて最後にまとめてAIへ渡せます。</span>' +
      '<button class="btn ghost sm req-btn-wide' + (delReq ? ' on' : '') + '" data-act="reqdel">' +
        (delReq ? '🗑 削除申請を取り消す' : '🗑 このクリップの削除を申請') + '</button>' +
      '<button class="btn ghost sm" data-act="openreq">📮 申請リスト（' + reqCount() + '）</button>' +
    '</div>';

    $('sheetBody').innerHTML = html;
  }

  function partIndex(v) { return v === 'null' || v === '' || v == null ? null : Number(v); }

  function syncEditors() {
    var eds = $('sheetBody').querySelectorAll('[data-editor]');
    Array.prototype.forEach.call(eds, function (ed) {
      var i = partIndex(ed.getAttribute('data-editor'));
      drafts[draftKey(current.id, i)] = ed.value;
    });
  }

  var slotCursor = {};

  $('sheetBody').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn || !current) return;
    var act = btn.getAttribute('data-act');

    if (act === 'reqdel') {
      toggleDeleteReq(current);
      renderSheetBody();
      return;
    }
    if (act === 'openreq') { openReqSheet(); return; }
    if (act === 'allnote') {
      syncEditors();
      appendToNote(current.blocks.map(function (b, k) {
        return b.label + '\n' + getText(current, k);
      }).join('\n\n'), current.title);
      return;
    }
    if (act === 'copyall') {
      syncEditors();
      var joined = current.blocks.map(function (b, i) {
        return b.label + '\n' + getText(current, i);
      }).join('\n\n----------------------------------------\n\n');
      doCopy(joined, current.id, btn, 'すべてのパーツをコピーしました');
      return;
    }

    var i = partIndex(btn.getAttribute('data-part'));
    var key = draftKey(current.id, i);

    if (act === 'copy') {
      syncEditors();
      doCopy(getText(current, i), current.id, btn, 'コピーしました');
      return;
    }
    if (act === 'edit') {
      syncEditors();
      if (editing[key]) delete editing[key];
      else { editing[key] = true; if (drafts[key] == null) drafts[key] = getText(current, i); }
      renderSheetBody();
      if (editing[key]) {
        var ed = $('sheetBody').querySelector('[data-editor="' + (i == null ? 'null' : i) + '"]');
        if (ed) { ed.focus(); ed.setSelectionRange(0, 0); }
      }
      return;
    }
    if (act === 'reqdelpart') {
      toggleDeleteReq(current, i);
      renderSheetBody();
      return;
    }
    if (act === 'tonote') {
      syncEditors();
      appendToNote(getText(current, i), current.title);
      return;
    }
    if (act === 'req') {
      syncEditors();
      submitEditReq(current, i);
      return;
    }
    if (act === 'reset') {
      delete drafts[key];
      renderSheetBody();
      toast('元の内容に戻しました', 'warn');
      return;
    }
    if (act === 'slot') {
      var ed2 = $('sheetBody').querySelector('[data-editor="' + (i == null ? 'null' : i) + '"]');
      if (!ed2) return;
      var slots = findSlots(ed2.value);
      if (!slots.length) { toast('入力欄は見つかりませんでした', 'warn'); return; }
      var c = (slotCursor[key] || 0) % slots.length;
      slotCursor[key] = c + 1;
      var s = slots[c];
      ed2.focus();
      ed2.setSelectionRange(s.index, s.index + s.length);
      // 選択位置までスクロール
      var before = ed2.value.slice(0, s.index).split('\n').length;
      ed2.scrollTop = Math.max(0, (before - 4) * 22);
      toast((c + 1) + ' / ' + slots.length + ' 番目の入力欄');
      return;
    }
  });

  $('sheetBody').addEventListener('input', function (ev) {
    if (ev.target.matches('[data-editor]')) {
      var i = partIndex(ev.target.getAttribute('data-editor'));
      drafts[draftKey(current.id, i)] = ev.target.value;
    }
  });

  $('sheetFav').addEventListener('click', function () {
    if (!current) return;
    toggleFav(current.id);
    $('sheetFav').textContent = isFav(current.id) ? '★' : '☆';
    $('sheetFav').classList.toggle('on', isFav(current.id));
  });

  /* ------------------------------------------------------------ カード操作 */
  $('grid').addEventListener('click', function (ev) {
    var card = ev.target.closest('.card');
    if (!card) return;
    var id = card.getAttribute('data-id');
    var item = ITEMS.filter(function (it) { return it.id === id; })[0];
    if (!item) return;

    if (ev.target.closest('[data-fav]')) {
      toggleFav(id);
      var b = ev.target.closest('[data-fav]');
      b.textContent = isFav(id) ? '★' : '☆';
      b.classList.toggle('on', isFav(id));
      if (state.cat === 'fav' || state.sort === 'recommend') render();
      return;
    }
    if (ev.target.closest('[data-reqdel]')) {
      toggleDeleteReq(item, null);
      render();
      return;
    }
    var rdb = ev.target.closest('[data-reqdelblock]');
    if (rdb) {
      toggleDeleteReq(item, Number(rdb.getAttribute('data-reqdelblock')));
      render();
      return;
    }
    if (ev.target.closest('[data-copyall]')) {
      doCopy(item.body, id, ev.target.closest('[data-copyall]'), 'コピーしました');
      return;
    }
    var rc = ev.target.closest('[data-copyblock]');
    if (rc) {
      var i = Number(rc.getAttribute('data-copyblock'));
      doCopy(item.blocks[i].text, id, rc, item.blocks[i].label + ' をコピー');
      return;
    }
    if (ev.target.closest('[data-open]')) { openDetail(id); return; }
  });

  /* ------------------------------------------------------------ 絞り込み操作 */
  function pickCat(id) {
    state.cat = id;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function pickTag(t) {
    var i = state.tags.indexOf(t);
    if (i === -1) state.tags.push(t); else state.tags.splice(i, 1);
    render();
  }

  ['catbar', 'sideCats', 'bsCats'].forEach(function (id) {
    $(id).addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cat]');
      if (b) pickCat(b.getAttribute('data-cat'));
    });
  });

  ['sideTags', 'bsTags'].forEach(function (id) {
    $(id).addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-tag]');
      if (b) pickTag(b.getAttribute('data-tag'));
    });
  });

  $('activeFilters').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-clear]');
    if (!b) return;
    var kind = b.getAttribute('data-clear');
    if (kind === 'q') { state.q = ''; $('search').value = ''; $('searchClear').hidden = true; }
    if (kind === 'cat') state.cat = 'all';
    if (kind === 'tag') pickTag(b.getAttribute('data-tag'));
    render();
  });

  function toggleTagMode() {
    state.tagMode = state.tagMode === 'or' ? 'and' : 'or';
    store.tagMode = state.tagMode;
    save();
    render();
  }
  $('tagMode').addEventListener('click', toggleTagMode);
  $('tagModeM').addEventListener('click', toggleTagMode);

  function resetAll() {
    state.q = '';
    state.cat = 'all';
    state.tags = [];
    $('search').value = '';
    $('searchClear').hidden = true;
    render();
  }
  $('emptyReset').addEventListener('click', resetAll);
  $('bsReset').addEventListener('click', resetAll);

  $('emptyWide').addEventListener('click', function () {
    state.cat = 'all';
    state.tags = [];
    render();
  });

  var searchTimer = null;
  $('search').addEventListener('input', function (ev) {
    var v = ev.target.value;
    $('searchClear').hidden = !v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.q = v.trim(); render(); }, 110);
  });

  $('searchClear').addEventListener('click', function () {
    $('search').value = '';
    $('searchClear').hidden = true;
    state.q = '';
    render();
    $('search').focus();
  });

  $('brandHome').addEventListener('click', function (ev) {
    ev.preventDefault();
    resetAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ------------------------------------------------------------ オーバーレイ */
  function openOverlay(id) {
    $(id).hidden = false;
    document.body.classList.add('locked');
  }
  function closeOverlay(id) {
    $(id).hidden = true;
    var open = document.querySelectorAll('.overlay:not([hidden])').length;
    if (!open) document.body.classList.remove('locked');
  }

  document.addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-close]');
    if (!c) return;
    var ov = c.closest('.overlay');
    if (!ov) return;
    if (ov.id === 'detail') { closeDetail(); return; }
    closeOverlay(ov.id);
    if (ov.id === 'reqSheet') render();
  });

  $('filterBtn').addEventListener('click', function () { openOverlay('filterSheet'); });

  /* ---------------------------------------------------------------- テーマ */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', store.theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', store.theme === 'light' ? '#eef1f7' : '#090a0e');
  }
  $('themeBtn').addEventListener('click', function () {
    store.theme = store.theme === 'dark' ? 'light' : 'dark';
    save();
    applyTheme();
  });

  /* ------------------------------------------------------------------ 使い方 */
  var TOUR = [
    {
      emoji: '📋',
      h: 'ようこそ',
      p: 'これは「自分でクリップを作って保存する」アプリではありません。<br>よく使うプロンプト・定型文・リンクが<b>最初から' + ITEMS.length + '件</b>入っていて、探してコピーするだけの道具です。',
      list: null
    },
    {
      emoji: '🔎',
      h: '探し方は3つ',
      p: '目的に近い方法でどうぞ。PCでもスマホでも同じように使えます。',
      list: [
        '<b>ジャンル</b>：上のカラフルなボタン（画像・議事録・リンク集…）',
        '<b>タグ</b>：M-CITY / 穴埋めあり / 短文 など。複数選べます',
        '<b>検索</b>：本文の中身まで一致します。PCなら <b>/</b> キーで一発移動'
      ]
    },
    {
      emoji: '⚡️',
      h: 'コピーは1タップ',
      p: 'カードの「コピー」で全文が入ります。',
      list: [
        '<b>リンク集やコピペ集</b>は、行ごとに個別のコピーボタンつき',
        '<b>★</b>を押すと、お気に入りとして先頭に並びます',
        'よく使うものは「よく使う順」で自動的に上がってきます'
      ]
    },
    {
      emoji: '✏️',
      h: 'その場で書き換えてコピー',
      p: '開いたあとの「<b>✏️ 編集してコピー</b>」で、一部だけ書き換えてからコピーできます。',
      list: [
        '書き換えた内容は<b>保存されません</b>（閉じれば元通り）',
        '黄色くマークされた場所が<b>入力欄</b>。「▶ 空欄へ」で順番にジャンプ',
        '元データは常にきれいなまま。安心して上書きしてください'
      ]
    },
    {
      emoji: '📝',
      h: '書く場所もあります',
      p: '右上の<b>📝</b>はマークダウンのメモ帳です。ここだけは<b>自由に書けて自動保存</b>されます。',
      list: [
        'クリップの詳細から<b>📝 メモへ</b>で、組み合わせたいものをどんどん貯められます',
        '<b>編集／プレビュー</b>を切り替え。パソコンなら書きながら右に清書が出ます',
        '<b>✨ 書式つきでコピー</b>でGoogleドキュメントに見た目のまま貼れます',
        '<b>🗑 クリアして履歴へ</b>で消しても、<b>履歴タブ</b>からいつでも戻せます'
      ]
    },
    {
      emoji: '📮',
      h: '直したくなったら「申請」',
      p: '中身を直接いじって保存はできませんが、<b>お願いを溜めて1本のプロンプトにする</b>ことができます。',
      list: [
        '<b>🗑</b>（カード右下）で削除の申請、編集後の<b>📝 変更を申請</b>で書き換えの申請',
        '<b>＋ 新しいクリップを追加申請</b>で追加のお願いもできます',
        '右上の<b>📮</b>を開くと、全部まとめた<b>AIエージェント用プロンプト</b>ができています',
        'そのままコピーしてAIに渡せば <b>data.js</b> を書き換えてくれます'
      ]
    }
  ];

  var tourStep = 0;

  function renderTour() {
    var t = TOUR[tourStep];
    $('tourStage').innerHTML =
      '<div class="tour-emoji">' + t.emoji + '</div>' +
      '<div class="tour-h">' + t.h + '</div>' +
      '<p class="tour-p">' + t.p + '</p>' +
      (t.list ? '<ul class="tour-list">' + t.list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '');
    $('tourDots').innerHTML = TOUR.map(function (_, i) {
      return '<i class="' + (i === tourStep ? 'on' : '') + '"></i>';
    }).join('');
    $('tourPrev').style.visibility = tourStep === 0 ? 'hidden' : 'visible';
    $('tourNext').textContent = tourStep === TOUR.length - 1 ? 'はじめる' : 'つぎへ';
  }

  function openTour() {
    tourStep = 0;
    renderTour();
    openOverlay('tour');
  }

  $('tourNext').addEventListener('click', function () {
    if (tourStep === TOUR.length - 1) {
      store.tour = true;
      save();
      closeOverlay('tour');
      return;
    }
    tourStep++;
    renderTour();
  });

  $('tourPrev').addEventListener('click', function () {
    if (tourStep > 0) { tourStep--; renderTour(); }
  });

  $('helpBtn').addEventListener('click', openTour);
  $('footHelp').addEventListener('click', openTour);

  /* ======================================================================
     マークダウンメモ帳
     クリップは読み取り専用だが、ここだけは自由に書けて自動保存される。
     消した内容は履歴に退避され、あとから復元できる。
     ====================================================================== */

  /* ------------------------------------------------- Markdown → HTML */
  function safeUrl(u) { return /^(https?:\/\/|mailto:|#|\.?\/)/i.test(String(u).trim()); }

  function mdInline(src) {
    var s = esc(src);
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\uE000C' + (codes.length - 1) + '\uE000'; });

    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, alt, url) {
      return safeUrl(url) ? '<img src="' + url + '" alt="' + alt + '" loading="lazy">' : m;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, t, url) {
      return safeUrl(url) ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + t + '</a>' : m;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>"')\]]+)/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });

    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

    s = s.replace(/\uE000C(\d+)\uE000/g, function (_, i) { return '<code>' + codes[Number(i)] + '</code>'; });
    return s;
  }

  function renderList(items, cur, level) {
    var ordered = items[cur.i].ordered;
    var tag = ordered ? 'ol' : 'ul';
    var out = '<' + tag + '>';
    var open = false;
    while (cur.i < items.length && items[cur.i].indent >= level) {
      var it = items[cur.i];
      if (it.indent > level) {
        out += renderList(items, cur, it.indent);   // 開いている li の中に入る
        continue;
      }
      if (open) out += '</li>';
      if (it.task) {
        out += '<li class="task"><input type="checkbox" disabled' + (it.checked ? ' checked' : '') +
          '><span>' + mdInline(it.text) + '</span>';
      } else {
        out += '<li>' + mdInline(it.text);
      }
      open = true;
      cur.i++;
    }
    if (open) out += '</li>';
    return out + '</' + tag + '>';
  }

  function mdToHtml(src) {
    if (!src || !src.trim()) return '';
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = '';
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // コードブロック
      var fence = line.match(/^\s*(```+|~~~+)\s*([^\s`~]*)/);
      if (fence) {
        var mark = fence[1].charAt(0);
        var buf = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + (mark === '`' ? '`' : '~') + '{' + fence[1].length + ',}\\s*$').test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        i++;
        out += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
        continue;
      }

      // 見出し
      var h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (h) {
        var lv = Math.min(h[1].length, 4);
        out += '<h' + lv + '>' + mdInline(h[2].replace(/\s+#+\s*$/, '')) + '</h' + lv + '>';
        i++;
        continue;
      }

      // 水平線
      if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) { out += '<hr>'; i++; continue; }

      // 表
      if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        var cells = function (row) {
          return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
        };
        var head = cells(line);
        i += 2;
        var body = '';
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()) {
          body += '<tr>' + cells(lines[i]).map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>';
          i++;
        }
        out += '<table><thead><tr>' + head.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + body + '</tbody></table>';
        continue;
      }

      // 引用
      if (/^\s{0,3}>/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
        out += '<blockquote>' + mdToHtml(q.join('\n')) + '</blockquote>';
        continue;
      }

      // 箇条書き / 番号付き / チェックリスト
      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])) {
          var m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          var body2 = m[3];
          var task = body2.match(/^\[([ xX])\]\s+(.*)$/);
          items.push({
            indent: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
            ordered: /\d/.test(m[2]),
            task: !!task,
            checked: !!task && task[1].toLowerCase() === 'x',
            text: task ? task[2] : body2
          });
          i++;
        }
        out += renderList(items, { i: 0 }, items[0].indent);
        continue;
      }

      // 段落
      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^\s{0,3}(#{1,6}\s|>|```|~~~)/.test(lines[i]) &&
             !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
             !/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      if (para.length) out += '<p>' + mdInline(para.join('\n')).replace(/\n/g, '<br>') + '</p>';
    }
    return out;
  }

  /* ------------------------------------------------------- 状態と保存 */
  var note = store.note;

  // 旧アプリのメモ履歴を初回だけ取り込む
  if (!note.seeded) {
    var legacy = window.CLIP_NOTEPAD_LEGACY;
    if (Array.isArray(legacy) && legacy.length) {
      note.history = note.history.concat(legacy).sort(function (a, b) { return b.at - a.at; });
    }
    note.seeded = true;
    save();
  }

  var HIST_MAX = 40;

  function pushHistory(content, reason) {
    if (!content || !content.trim()) return false;
    var top = note.history[0];
    if (top && top.content === content) return false;   // 同じものを続けて積まない
    note.history = [{
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      content: content,
      at: Date.now(),
      reason: reason || 'manual'
    }].concat(note.history).slice(0, HIST_MAX);
    save();
    return true;
  }

  function noteChars() { return note.content.length; }

  function updateNoteDot() {
    $('noteDot').hidden = !note.content.trim();
  }

  /* ------------------------------------------------------------ 画面 */
  var noteTab = 'edit';
  var noteSaveTimer = null;
  var previewTimer = null;

  var TOOLS = [
    { k: 'h', label: 'H', title: '見出し', run: function (t) { return linePrefix(t, '## '); } },
    { k: 'b', label: '<b>B</b>', title: '太字', run: function (t) { return wrap(t, '**', '**'); } },
    { k: 'i', label: '<i>I</i>', title: '斜体', run: function (t) { return wrap(t, '*', '*'); } },
    { k: 's', label: '<s>S</s>', title: '打ち消し', run: function (t) { return wrap(t, '~~', '~~'); } },
    { k: 'ul', label: '•', title: '箇条書き', run: function (t) { return linePrefix(t, '- '); } },
    { k: 'ol', label: '1.', title: '番号付き', run: function (t) { return linePrefix(t, '1. '); } },
    { k: 'task', label: '☑', title: 'やることリスト', run: function (t) { return linePrefix(t, '- [ ] '); } },
    { k: 'quote', label: '❝', title: '引用', run: function (t) { return linePrefix(t, '> '); } },
    { k: 'code', label: '&lt;/&gt;', title: 'コード', run: function (t) { return wrap(t, '`', '`'); } },
    { k: 'link', label: '⊂⊃', title: 'リンク', run: function (t) { return wrap(t, '[', '](https://)'); } },
    { k: 'hr', label: '—', title: '区切り線', run: function (t) { return { text: t.before + '\n---\n' + t.after, at: t.before.length + 5 }; } }
  ];

  function selection() {
    var ed = $('noteEditor');
    return {
      before: ed.value.slice(0, ed.selectionStart),
      sel: ed.value.slice(ed.selectionStart, ed.selectionEnd),
      after: ed.value.slice(ed.selectionEnd)
    };
  }

  function wrap(t, l, r) {
    var body = t.sel || '';
    return { text: t.before + l + body + r + t.after, at: t.before.length + l.length + body.length };
  }

  function linePrefix(t, prefix) {
    // 選択が無ければ、いまの行の先頭に付ける
    var startLine = t.before.lastIndexOf('\n') + 1;
    var head = t.before.slice(0, startLine);
    var target = t.before.slice(startLine) + (t.sel || '');
    var lines = target.split('\n').map(function (l) { return l ? prefix + l : prefix; });
    var next = lines.join('\n');
    return { text: head + next + t.after, at: head.length + next.length };
  }

  function renderNoteTools() {
    $('noteTools').innerHTML = TOOLS.map(function (t) {
      return '<button class="note-tool" type="button" data-tool="' + t.k + '" title="' + t.title + '">' + t.label + '</button>';
    }).join('');
  }

  function setNoteTab(tab) {
    noteTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.note-tab'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    $('notePaneEdit').hidden = tab !== 'edit';
    $('notePanePreview').hidden = tab !== 'preview';
    $('notePaneHistory').hidden = tab !== 'history';
    if (tab === 'preview') renderPreview($('notePreview'));
    if (tab === 'history') renderNoteHistory();
    renderNoteFoot();
  }

  /* --------------------------------------------- 入力欄とプレビューの連動
     どちらかをスクロールすると、もう片方の同じ位置へ合わせる（旧アプリと同じ挙動）。
     追従側が動くと相手の scroll イベントも鳴るので、
     「いま人が触っている側」を覚えておいて、その間だけ逆向きの同期を止める。 */
  var scrollDriver = null;
  var scrollDriverTimer = null;

  function syncScroll(source, target, force) {
    if (!target.clientHeight) return;                 // スマホでプレビューが隠れているとき
    if (!force) {
      if (scrollDriver && scrollDriver !== source) return;
      scrollDriver = source;
      clearTimeout(scrollDriverTimer);
      scrollDriverTimer = setTimeout(function () { scrollDriver = null; }, 140);
    }
    var sMax = Math.max(0, source.scrollHeight - source.clientHeight);
    var tMax = Math.max(0, target.scrollHeight - target.clientHeight);
    target.scrollTop = sMax > 0 ? (source.scrollTop / sMax) * tMax : 0;
  }

  (function bindScrollSync() {
    var ed = $('noteEditor');
    var pv = $('noteLivePreview');
    ed.addEventListener('scroll', function () { syncScroll(ed, pv); }, { passive: true });
    pv.addEventListener('scroll', function () { syncScroll(pv, ed); }, { passive: true });
    // 入力やクリックでキャレットが動いて textarea がスクロールしたときも合わせる
    ed.addEventListener('keyup', function () { syncScroll(ed, pv); });
    ed.addEventListener('click', function () { syncScroll(ed, pv); });
  })();

  function renderPreview(el) {
    var html = mdToHtml(note.content);
    var live = el === $('noteLivePreview');
    el.innerHTML = html || '<p class="note-empty">まだ何も書かれていません。</p>';
    // 書き換えでプレビューが先頭へ戻ってしまうので、入力欄の位置へ合わせ直す
    if (live) syncScroll($('noteEditor'), el, true);
  }

  function renderNoteFoot() {
    var n = noteChars();
    if (noteTab === 'history') {
      $('noteFoot').innerHTML =
        '<button class="btn ghost" id="noteHistClear" type="button">履歴を全部消す</button>' +
        '<span class="stat">' + note.history.length + ' / ' + HIST_MAX + ' 件</span>';
      return;
    }
    $('noteFoot').innerHTML =
      '<button class="btn primary" data-note="copy" type="button">📋 コピー</button>' +
      '<button class="btn ghost" data-note="copyrich" type="button">✨ 書式つきでコピー</button>' +
      '<button class="btn ghost" data-note="stash" type="button">💾 履歴に保存</button>' +
      '<button class="btn ghost" data-note="clear" type="button">🗑 クリアして履歴へ</button>' +
      '<span class="stat">' + n.toLocaleString('ja-JP') + '字</span>';
  }

  function histWhy(r) {
    return { legacy: '旧アプリ', clear: 'クリア時', restore: '復元前', manual: '手動保存', append: '追記前' }[r] || '保存';
  }

  function renderNoteHistory() {
    $('noteHistCount').textContent = note.history.length;
    var box = $('noteHistory');
    if (!note.history.length) {
      box.innerHTML = '<div class="req-empty">履歴はまだありません。<br>' +
        '「💾 履歴に保存」や「🗑 クリアして履歴へ」を押すと、そのときの内容がここに残ります。</div>';
      return;
    }
    box.innerHTML = '<p class="note-hist-lead">新しい順・最大' + HIST_MAX + '件。' +
      '復元すると、いま書いている内容は先に履歴へ退避されるので消えません。</p>' +
      note.history.map(function (h) {
        var d = new Date(h.at);
        var when = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
          String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        var peek = h.content.slice(0, 200);
        return '<div class="hist-item">' +
          '<div class="hist-top">' +
            '<span class="hist-when">' + when + '</span>' +
            '<span class="hist-why' + (h.reason === 'legacy' ? ' legacy' : '') + '">' + histWhy(h.reason) + '</span>' +
            '<span class="hist-meta">' + h.content.length.toLocaleString('ja-JP') + '字</span>' +
          '</div>' +
          '<div class="hist-peek">' + esc(peek) + (h.content.length > 200 ? ' …' : '') + '</div>' +
          '<div class="hist-btns">' +
            '<button class="btn sm primary" data-hist="restore" data-id="' + h.id + '">この内容に戻す</button>' +
            '<button class="btn sm ghost" data-hist="append" data-id="' + h.id + '">末尾に追記</button>' +
            '<button class="btn sm ghost" data-hist="copy" data-id="' + h.id + '">コピー</button>' +
            '<button class="btn sm ghost" data-hist="del" data-id="' + h.id + '">削除</button>' +
          '</div>' +
        '</div>';
      }).join('');
  }

  function setNoteContent(next, why) {
    if (note.content.trim() && note.content !== next) pushHistory(note.content, why || 'restore');
    note.content = next;
    save();
    $('noteEditor').value = next;
    updateNoteDot();
    renderPreview($('noteLivePreview'));
    if (noteTab === 'preview') renderPreview($('notePreview'));
    renderNoteFoot();
    renderNoteHistory();
  }

  function openNote(tab) {
    $('noteEditor').value = note.content;
    renderNoteTools();
    renderPreview($('noteLivePreview'));
    renderNoteHistory();
    setNoteTab(tab || 'edit');
    $('noteStatus').textContent = '自動保存';
    openOverlay('noteSheet');
    if (!tab || tab === 'edit') setTimeout(function () { $('noteEditor').focus(); }, 60);
  }

  $('noteBtn').addEventListener('click', function () { openNote('edit'); });

  document.querySelector('.note-tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-tab]');
    if (b) setNoteTab(b.getAttribute('data-tab'));
  });

  $('noteEditor').addEventListener('input', function (ev) {
    note.content = ev.target.value;
    updateNoteDot();
    $('noteStatus').textContent = '保存中…';
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(function () {
      if (save()) $('noteStatus').textContent = '保存しました';
    }, 350);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      renderPreview($('noteLivePreview'));
      renderNoteFoot();
    }, 180);
  });

  $('noteTools').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-tool]');
    if (!b) return;
    var tool = TOOLS.filter(function (t) { return t.k === b.getAttribute('data-tool'); })[0];
    if (!tool) return;
    var ed = $('noteEditor');
    var r = tool.run(selection());
    ed.value = r.text;
    ed.focus();
    ed.setSelectionRange(r.at, r.at);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });

  $('noteFoot').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-note]');
    if (b) {
      var act = b.getAttribute('data-note');
      if (act === 'copy') { doCopy(note.content, null, b, 'メモをコピーしました'); return; }
      if (act === 'copyrich') { copyRich(mdToHtml(note.content), note.content, b); return; }
      if (act === 'stash') {
        if (pushHistory(note.content, 'manual')) {
          renderNoteHistory();
          $('noteHistCount').textContent = note.history.length;
          toast('💾 いまの内容を履歴に保存しました');
        } else {
          toast('保存する内容がありません（または直前と同じです）', 'warn');
        }
        return;
      }
      if (act === 'clear') {
        if (!note.content.trim()) { toast('メモは空です', 'warn'); return; }
        pushHistory(note.content, 'clear');
        note.content = '';
        save();
        $('noteEditor').value = '';
        updateNoteDot();
        renderPreview($('noteLivePreview'));
        renderNoteFoot();
        renderNoteHistory();
        $('noteHistCount').textContent = note.history.length;
        toast('🗑 履歴に退避してクリアしました（履歴タブから戻せます）', 'warn');
        return;
      }
    }
    if (ev.target.closest('#noteHistClear')) {
      if (!note.history.length) return;
      if (!window.confirm('履歴 ' + note.history.length + '件をすべて削除します。元に戻せません。よろしいですか？')) return;
      note.history = [];
      save();
      renderNoteHistory();
      $('noteHistCount').textContent = '0';
      renderNoteFoot();
      toast('履歴を全部消しました', 'warn');
    }
  });

  $('noteHistory').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-hist]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    var h = note.history.filter(function (x) { return x.id === id; })[0];
    if (!h) return;
    var act = b.getAttribute('data-hist');

    if (act === 'copy') { doCopy(h.content, null, b, 'この履歴をコピーしました'); return; }
    if (act === 'restore') {
      setNoteContent(h.content, 'restore');
      setNoteTab('edit');
      toast('この内容に戻しました（直前の内容も履歴に残っています）');
      return;
    }
    if (act === 'append') {
      var next = note.content.trim() ? note.content.replace(/\s+$/, '') + '\n\n' + h.content : h.content;
      setNoteContent(next, 'append');
      setNoteTab('edit');
      toast('メモの末尾に追記しました');
      return;
    }
    if (act === 'del') {
      note.history = note.history.filter(function (x) { return x.id !== id; });
      save();
      renderNoteHistory();
      $('noteHistCount').textContent = note.history.length;
      renderNoteFoot();
      toast('履歴を1件削除しました', 'warn');
    }
  });

  /* 書式つきコピー（Googleドキュメントなどに見た目のまま貼れる） */
  function copyRich(html, text, btn) {
    var done = function () {
      if (btn) {
        var old = btn.textContent;
        btn.textContent = '✓ コピー済み';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = old; btn.classList.remove('done'); }, 1400);
      }
      toast('✨ 書式つきでコピーしました');
    };
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      var item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(done).catch(function () {
        doCopy(text, null, btn, 'この環境では書式なしでコピーしました');
      });
      return;
    }
    doCopy(text, null, btn, 'この環境では書式なしでコピーしました');
  }

  /* クリップ → メモへ追記 */
  function appendToNote(text, label) {
    var next = note.content.trim() ? note.content.replace(/\s+$/, '') + '\n\n' + text : text;
    if (note.content.trim()) pushHistory(note.content, 'append');
    note.content = next;
    save();
    updateNoteDot();
    toast('📝 メモに追加しました' + (label ? '：' + label : ''));
  }

  /* ======================================================================
     申請（削除 / 変更 / 追加）
     ユーザーが押した「お願い」を溜めて、AIエージェント用の1本のプロンプトにする。
     data.js を書き換えるのはAI側。このアプリ自体はデータを一切書き換えない。
     ====================================================================== */

  var KIND = {
    delete: { label: '削除', color: '#ef4444', icon: '🗑' },
    edit:   { label: '変更', color: '#6366f1', icon: '📝' },
    add:    { label: '追加', color: '#16a34a', icon: '✨' }
  };

  function newRid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function normPart(p) { return (p === undefined || p === null || p === '') ? null : Number(p); }

  function findReq(kind, clipId, part) {
    var want = normPart(part);
    for (var i = 0; i < store.reqs.length; i++) {
      var r = store.reqs[i];
      if (r.kind !== kind) continue;
      if (kind === 'add') continue;
      if (r.clipId !== clipId) continue;
      if (normPart(r.part) !== want) continue;
      return r;
    }
    return null;
  }

  /* そのクリップに何らかの申請があるか（カードの表示用） */
  function hasReq(kind, clipId) {
    return store.reqs.some(function (r) { return r.kind === kind && r.clipId === clipId; });
  }

  function removeReq(rid) {
    store.reqs = store.reqs.filter(function (r) { return r.rid !== rid; });
    save();
  }

  function pushReq(req) {
    req.rid = newRid();
    req.at = Date.now();
    req.memo = req.memo || '';
    store.reqs.push(req);
    save();
  }

  function reqCount() { return store.reqs.length; }

  function updateReqBadge() {
    var n = reqCount();
    var b = $('reqCount');
    b.textContent = n;
    b.hidden = n === 0;

    var banner = $('reqBanner');
    banner.hidden = n === 0;
    if (n) {
      var d = store.reqs.filter(function (r) { return r.kind === 'delete'; }).length;
      var e = store.reqs.filter(function (r) { return r.kind === 'edit'; }).length;
      var a = store.reqs.filter(function (r) { return r.kind === 'add'; }).length;
      var bits = [];
      if (d) bits.push('削除' + d);
      if (e) bits.push('変更' + e);
      if (a) bits.push('追加' + a);
      banner.innerHTML = '<span class="rb-ic">📮</span><span class="rb-main">申請が ' + n + ' 件たまっています' +
        '<span class="rb-sub">' + bits.join('・') + ' ／ AIエージェント用のプロンプトができています</span></span>' +
        '<span class="rb-go">確認する →</span>';
    }
  }

  $('reqBanner').addEventListener('click', function () { openReqSheet(); });

  /* 削除申請（押すたびに 追加 / 取り消し）
     part を渡すと「そのパーツだけ削除」の申請になる（リンク集の1本、コピペ集の1項目など） */
  function toggleDeleteReq(item, part) {
    var p = normPart(part);
    var ex = findReq('delete', item.id, p);
    if (ex) {
      removeReq(ex.rid);
      toast('削除申請を取り消しました', 'warn');
      updateReqBadge();
      return;
    }

    if (p === null) {
      // クリップごと消すなら、同じクリップのパーツ削除申請は不要になる
      var dropped = store.reqs.filter(function (r) {
        return r.kind === 'delete' && r.clipId === item.id && normPart(r.part) !== null;
      }).length;
      if (dropped) {
        store.reqs = store.reqs.filter(function (r) {
          return !(r.kind === 'delete' && r.clipId === item.id && normPart(r.part) !== null);
        });
      }
      pushReq({ kind: 'delete', clipId: item.id, title: item.title, cat: item.cat, part: null });
      toast('🗑 「' + item.title + '」の削除を申請リストに入れました' +
        (dropped ? '（パーツ単位の申請 ' + dropped + '件はまとめました）' : ''));
    } else {
      if (findReq('delete', item.id, null)) {
        toast('このクリップ自体の削除を申請中です。先にそちらを取り消してください', 'warn');
        return;
      }
      pushReq({
        kind: 'delete', clipId: item.id, title: item.title, cat: item.cat,
        part: p, partLabel: item.blocks[p].label
      });
      toast('🗑 「' + item.blocks[p].label + '」の削除を申請リストに入れました');
    }
    updateReqBadge();
  }

  /* 変更申請（編集した本文をそのまま申請） */
  function submitEditReq(item, part) {
    var after = getText(item, part);
    var before = part == null ? item.body : item.blocks[part].text;
    if (after === before) { toast('本文が元のままです。先に編集してください', 'warn'); return; }

    var ex = findReq('edit', item.id, part);
    if (ex) {
      ex.after = after;
      ex.at = Date.now();
      save();
      toast('📝 変更申請を最新の内容に更新しました');
    } else {
      pushReq({
        kind: 'edit',
        clipId: item.id,
        title: item.title,
        cat: item.cat,
        part: part,
        partLabel: part == null ? null : item.blocks[part].label,
        after: after
      });
      toast('📝 「' + item.title + '」の変更を申請リストに入れました');
    }
    updateReqBadge();
    renderSheetBody();
  }

  /* ------------------------------------------------------- プロンプト生成 */
  function fenceFor(text) {
    var runs = String(text).match(/`{3,}/g) || [];
    var n = 3;
    runs.forEach(function (s) { if (s.length >= n) n = s.length + 1; });
    return new Array(n + 1).join('`');
  }

  function fenced(text) {
    var f = fenceFor(text);
    return f + 'text\n' + text + '\n' + f;
  }

  function buildPrompt() {
    var reqs = store.reqs;
    if (!reqs.length) return '';

    var dels = reqs.filter(function (r) { return r.kind === 'delete'; });
    var eds = reqs.filter(function (r) { return r.kind === 'edit'; });
    var adds = reqs.filter(function (r) { return r.kind === 'add'; });
    // クリップごと消すものだけが件数に影響する（パーツ削除は件数が変わらない）
    var wholeDels = dels.filter(function (r) { return normPart(r.part) === null; }).length;
    var partDels = dels.length - wholeDels;
    var finalCount = ITEMS.length - wholeDels + adds.length;

    var L = [];
    L.push('# 新マルチクリップボード｜データ更新のお願い（全' + reqs.length + '件）');
    L.push('');
    L.push('あなたは静的Webアプリ「新マルチクリップボード」のデータ管理担当です。');
    L.push('このアプリに表示される内容は、すべて `' + REPO.file + '` の `window.CLIP_DATA` に入っています。');
    L.push('下の「依頼一覧」のとおりに書き換えてください。');
    L.push('');
    L.push('## 0. まず最新版を取ってくる（いちばん最初に必ず実行）');
    L.push('');
    L.push('このアプリは Codex・Claude Code など**複数のAIから交代で編集されます**。');
    L.push('手元にある古いファイルを元に書き換えると、他のAIが入れた変更を丸ごと消してしまいます。');
    L.push('**編集を始める前に、必ず GitHub の最新版を取り込んでください。**');
    L.push('');
    L.push('- リポジトリ：' + REPO.url);
    L.push('- ブランチ：`' + REPO.branch + '`');
    L.push('- 対象フォルダ：`' + REPO.dir + '/`');
    L.push('- 編集するファイル：`' + REPO.file + '`');
    L.push('');
    L.push('すでにローカルにクローンがある場合：');
    L.push('');
    L.push('```bash');
    L.push('git switch ' + REPO.branch);
    L.push('git fetch origin');
    L.push('git pull --rebase origin ' + REPO.branch);
    L.push('git log --oneline -3 -- ' + REPO.dir);
    L.push('```');
    L.push('');
    L.push('クローンが無い場合：');
    L.push('');
    L.push('```bash');
    L.push('git clone ' + REPO.clone);
    L.push('cd ' + REPO.clone.split('/').pop().replace(/\.git$/, ''));
    L.push('```');
    L.push('');
    L.push('取り込むときの注意：');
    L.push('');
    L.push('- `git status` で作業ツリーがきれいなことを確認してください。');
    L.push('- 未コミットの変更やコンフリクトが残っている場合は、**勝手に消したり上書きしたりせず**、状況を報告して止まってください。');
    L.push('- pull したあとの `' + REPO.file + '` を**唯一の正**として扱ってください。手元のキャッシュや、以前の会話で見た内容を使わないでください。');
    L.push('- git が使えない環境（ブラウザだけ等）の場合は、自分で書き換えを始める前に「最新の `' + REPO.file + '` をください」と依頼者に伝えて止まってください。');
    L.push('- 下の依頼一覧に書かれた「変更前の字数」や対象IDが最新版と食い違う場合は、**その場で上書きせず**、どこがどう違うかを報告して確認を取ってください。');
    L.push('');
    L.push('## 守ること');
    L.push('1. 変更してよいファイルは `' + REPO.file + '` だけです。同じフォルダの `index.html` / `styles.css` / `app.js` / `notepad-legacy.js` や、リポジトリ内の他のフォルダは触らないでください。');
    L.push('2. 依頼一覧に書かれていないもの（他のクリップ・`categories`・`tags` の定義）は一切変更しないでください。');
    L.push('3. 既存の `id` は変更しないでください。');
    L.push('4. 本文は、指定されたテキストを**一字一句そのまま**入れてください。要約・整形・改行の調整・全角半角の統一などをしないでください。');
    L.push('5. `cat` は `categories[].id` のいずれか、`tags` は `tags[].id` のいずれかにしてください。');
    L.push('   新しいカテゴリやタグが必要だと思った場合は、勝手に作らず先に確認してください。');
    L.push('6. 並び順（`items` の配列順）は、指定がない限り変えないでください。');
    L.push('');
    L.push('## データ構造（参考）');
    L.push('```js');
    L.push('window.CLIP_DATA = {');
    L.push('  categories: [{ id, name, icon, accent, lead }],');
    L.push('  tags: [{ id, color }],');
    L.push('  items: [{');
    L.push('    id,          // 一意。英小文字とハイフン');
    L.push('    cat,         // categories[].id');
    L.push('    title,');
    L.push('    summary,     // カードに出る1〜2行の説明');
    L.push('    tags: [],    // tags[].id');
    L.push('    type,        // "single" なら body / "collection" なら blocks');
    L.push('    body,        // type: "single"');
    L.push('    blocks: [{ label, text }],  // type: "collection"');
    L.push('    note,        // 任意の注意書き');
    L.push('    private      // 任意。個人情報を含む印');
    L.push('  }]');
    L.push('};');
    L.push('```');
    L.push('');
    L.push('現在の登録数：**' + ITEMS.length + '件**。');
    L.push('この依頼をすべて反映すると **' + finalCount + '件** になります。');
    L.push('（クリップ削除 ' + wholeDels + '件 ／ パーツ削除 ' + partDels + '件 ／ 本文変更 ' + eds.length +
      '件 ／ 追加 ' + adds.length + '件）');
    if (partDels) {
      L.push('※パーツ削除はクリップの `blocks` から要素を抜くだけなので、`items` の件数は変わりません。');
    }
    L.push('');
    L.push('---');
    L.push('');
    L.push('## 依頼一覧');

    var n = 0;

    dels.forEach(function (r) {
      n++;
      var p = normPart(r.part);
      if (p === null) {
        L.push('');
        L.push('### ' + n + '. 【削除】' + r.title);
        L.push('');
        L.push('- 対象 id：`' + r.clipId + '`');
        L.push('- `items` 配列から、この要素を**まるごと削除**してください。');
      } else {
        L.push('');
        L.push('### ' + n + '. 【パーツ削除】' + r.title + ' ＞ ' + r.partLabel);
        L.push('');
        L.push('- 対象 id：`' + r.clipId + '`');
        L.push('- 対象の場所：`blocks[' + p + ']`（' + (p + 1) + '番目のパーツ「' + r.partLabel + '」）');
        L.push('- `blocks` 配列から**この要素だけ**を削除してください。クリップ自体は残します。');
        L.push('- 同じクリップで複数のパーツを消す場合は、**添字がずれる**ので後ろのパーツから消すか、ラベルで特定してください。');
        L.push('- 削除の結果 `blocks` が空になる場合は、勝手にクリップごと消さず、報告して止まってください。');
      }
      if (r.memo) L.push('- 補足：' + r.memo);
    });

    eds.forEach(function (r) {
      n++;
      var it = ITEMS.filter(function (x) { return x.id === r.clipId; })[0];
      L.push('');
      L.push('### ' + n + '. 【本文の変更】' + r.title);
      L.push('');
      L.push('- 対象 id：`' + r.clipId + '`');
      if (r.part == null) {
        L.push('- 対象の場所：`body`（本文まるごと）');
      } else {
        L.push('- 対象の場所：`blocks[' + r.part + '].text`（' + (r.part + 1) + '番目のパーツ「' + r.partLabel + '」）');
      }
      L.push('- 下のテキストで**完全に置き換えて**ください（差分ではなく全文です）。');
      if (r.memo) L.push('- 補足：' + r.memo);
      L.push('');
      L.push('変更後の本文：');
      L.push('');
      L.push(fenced(r.after));
      if (it) {
        L.push('');
        L.push('<!-- 変更前は ' + (r.part == null ? it.body.length : it.blocks[r.part].text.length) +
          '字、変更後は ' + r.after.length + '字 -->');
      }
    });

    adds.forEach(function (r) {
      n++;
      var a = r.add;
      var cat = CAT_BY_ID[a.cat];
      L.push('');
      L.push('### ' + n + '. 【新規追加】' + a.title);
      L.push('');
      L.push('- `items` 配列の**末尾に追加**してください。');
      L.push('- `id`：内容に合う英小文字＋ハイフンで新しく付けてください（既存と重複しないこと）。');
      L.push('- `cat`：`' + a.cat + '`（' + (cat ? cat.name : '') + '）');
      L.push('- `tags`：' + (a.tags.length ? a.tags.map(function (t) { return '`' + t + '`'; }).join('、') : '内容を見て、既存タグの中から適切なものを付けてください'));
      L.push('- `summary`：' + (a.summary ? a.summary : '未記入です。本文を読んで、カード用に1〜2行の説明を作ってください'));
      L.push('- `type`：`single`（本文1本）');
      if (r.memo) L.push('- 補足：' + r.memo);
      L.push('');
      L.push('本文：');
      L.push('');
      L.push(fenced(a.body));
    });

    L.push('');
    L.push('---');
    L.push('');
    L.push('## 終わったら確認すること');
    L.push('- `' + REPO.file + '` が構文エラーなく読めること。例：');
    L.push('  ```bash');
    L.push('  node -e "global.window={};require(\'./' + REPO.file + '\');const d=window.CLIP_DATA;console.log(\'items\',d.items.length)"');
    L.push('  ```');
    L.push('- 上のコマンドで `items` が **' + (ITEMS.length - dels.length + adds.length) + '** になっていること。');
    L.push('- すべての `cat` が `categories[].id` に、すべての `tags` が `tags[].id` に含まれていること。');
    L.push('- `id` の重複がないこと。');
    L.push('- 依頼していないクリップの本文が1文字も変わっていないこと（`git diff` で確認）。');
    L.push('');
    L.push('## 反映（コミットとプッシュ）');
    L.push('');
    L.push('確認が通ったら、`' + REPO.dir + '/` の変更だけをコミットして push してください。');
    L.push('他のフォルダの未コミット変更を巻き込まないよう、`git add` はパスを指定してください。');
    L.push('');
    L.push('```bash');
    L.push('git add ' + REPO.file);
    L.push('git commit -m "Update clipboard data (削除' + dels.length + ' / 変更' + eds.length + ' / 追加' + adds.length + ')"');
    L.push('git pull --rebase origin ' + REPO.branch + '   # push前にもう一度最新を取り込む');
    L.push('git push origin ' + REPO.branch);
    L.push('```');
    L.push('');
    L.push('- push 直前の `git pull --rebase` を省略しないでください。作業中に他のAIが更新している場合があります。');
    L.push('- コンフリクトが出た場合は、**自分の変更を優先して強制上書きせず**、内容を報告して止まってください。');
    L.push('');
    L.push('## デプロイ（公開反映）');
    L.push('');
    L.push('push しただけでは公開ページは変わりません。最後にデプロイまで実行してください。');
    L.push('');
    L.push('**必ず同梱のデプロイスクリプトを使ってください。**');
    L.push('`vercel deploy` を直接叩くと、無認証で見えるエイリアスが復活したまま放置されます。');
    L.push('');
    L.push('```bash');
    L.push('cd ' + REPO.dir);
    L.push('bash ./deploy.sh          # Windows の PowerShell なら: pwsh ./deploy.ps1');
    L.push('```');
    L.push('');
    L.push('スクリプトは「本番デプロイ → 公開エイリアス削除 → 状態検証」まで自動でやります。');
    L.push('');
    L.push('- URL：' + REPO.site + '（Vercelログイン必須。個人用サイトです）');
    L.push('- `' + REPO.dir + '/.vercel/` にプロジェクトのひも付けが入っています。消さないでください。');
    L.push('- Vercel にログインしていない場合は、勝手にアカウントを作らず、その旨を報告して止まってください。');
    L.push('');
    L.push('### なぜスクリプト経由なのか（重要・セキュリティ）');
    L.push('');
    L.push('このサイトには個人情報を含むクリップがあるため、**誰でも見られるURLを持たせていません**。');
    L.push('ところが本番デプロイのたびに `' + REPO.publicAlias + '` という**無認証で見えるエイリアスが自動で復活します**（検証済み）。');
    L.push('スクリプトを使わなかった場合は、必ず自分で消してください。');
    L.push('');
    L.push('```bash');
    L.push('curl -s -o /dev/null -w "%{http_code}\\n" https://' + REPO.publicAlias + '/');
    L.push('# 200 が返ったら公開されてしまっているので、下を実行して消す');
    L.push('npx vercel@latest alias rm ' + REPO.publicAlias + ' --yes --scope ' + REPO.vercelScope);
    L.push('# もう一度叩いて 404 になることを確認する');
    L.push('```');
    L.push('');
    L.push('- 正しい状態：`' + REPO.publicAlias + '` は **404**、`' + REPO.site.replace(/^https?:\/\/|\/$/g, '') + '` は **302**（ログインへリダイレクト）。');
    L.push('- 302 が返るのが正常です。エラーだと思って「保護を外して200にする」ことは**絶対にしないでください**。');
    L.push('- 中身の目視確認はブラウザのログインが必要なため、依頼者が行います。あなたは上の件数の検算までで構いません。');
    L.push('');
    L.push('');
    L.push('## 最後に報告すること');
    L.push('- 取り込んだ最新版のコミット（`git log --oneline -1`）');
    L.push('- 削除した id / 変更した id / 追加した id の一覧');
    L.push('- 反映前と反映後の件数');
    L.push('- push したコミットのハッシュ');
    L.push('- `' + REPO.publicAlias + '` が 404 のままか（復活していたら消したかどうか）');
    L.push('- 判断に迷って手を止めた点があれば、その内容');
    L.push('');
    L.push('<!-- このプロンプトは「新マルチクリップボード」の申請リストから自動生成されました -->');

    return L.join('\n');
  }

  /* ------------------------------------------------------- 申請リスト画面 */
  function reqItemHTML(r, no) {
    var k = KIND[r.kind];
    var name, desc, peek = '';

    if (r.kind === 'delete') {
      var dp = normPart(r.part);
      if (dp === null) {
        name = r.title;
        desc = 'このクリップを丸ごと削除する（id: ' + r.clipId + '）';
      } else {
        name = r.title + ' ＞ ' + r.partLabel;
        desc = (dp + 1) + '番目のパーツだけを削除する（クリップ自体は残す）';
      }
    } else if (r.kind === 'edit') {
      name = r.title;
      desc = (r.part == null ? '本文' : (r.part + 1) + '番目のパーツ「' + r.partLabel + '」') +
        ' を書き換える（' + r.after.length.toLocaleString('ja-JP') + '字）';
      peek = r.after.slice(0, 220);
    } else {
      name = r.add.title;
      var c = CAT_BY_ID[r.add.cat];
      desc = '新しく追加する ／ ' + (c ? c.icon + ' ' + c.name : r.add.cat) +
        (r.add.tags.length ? ' ／ ' + r.add.tags.join('・') : '') +
        '（' + r.add.body.length.toLocaleString('ja-JP') + '字）';
      peek = r.add.body.slice(0, 220);
    }

    return '<div class="req-item" style="--k:' + k.color + '">' +
      '<div class="req-main">' +
        '<span class="req-kind">' + k.icon + ' ' + k.label + '</span>' +
        '<div class="req-name">' + no + '. ' + esc(name) + '</div>' +
        '<div class="req-desc">' + esc(desc) + '</div>' +
        (peek ? '<div class="req-peek">' + esc(peek) + (peek.length >= 220 ? ' …' : '') + '</div>' : '') +
        '<input class="req-memo" data-memo="' + r.rid + '" type="text" placeholder="補足・お願い（任意）" value="' + esc(r.memo || '') + '">' +
      '</div>' +
      '<button class="req-del" data-reqdel-rid="' + r.rid + '" aria-label="この申請を取り消す">✕</button>' +
    '</div>';
  }

  function renderReqSheet() {
    var body = $('reqBody');
    var foot = $('reqFoot');
    var reqs = store.reqs;

    var html = '<div class="tools">' +
      '<button class="btn ghost sm" id="reqAddBtn" type="button">＋ 新しいクリップを追加申請</button>' +
      '<span class="spacer"></span>' +
      '<span class="stat">' + reqs.length + '件</span>' +
    '</div>';

    if (!reqs.length) {
      html += '<div class="req-empty">' +
        'まだ申請はありません。<br>' +
        'カードの <b>🗑</b> で削除、詳細の <b>✏️ 編集してコピー</b> で書き換えたあとの <b>📝 変更を申請</b>、<br>' +
        '上の <b>＋ 新しいクリップを追加申請</b> から溜められます。' +
      '</div>';
      body.innerHTML = html;
      foot.innerHTML = '<button class="btn ghost grow" data-close type="button">とじる</button>';
      return;
    }

    ['delete', 'edit', 'add'].forEach(function (kind) {
      var group = reqs.filter(function (r) { return r.kind === kind; });
      if (!group.length) return;
      html += '<h3 class="req-group-title">' + KIND[kind].icon + ' ' + KIND[kind].label + '（' + group.length + '件）</h3>';
      group.forEach(function (r) {
        html += reqItemHTML(r, reqs.indexOf(r) + 1);
      });
    });

    var prompt = buildPrompt();
    html += '<div class="prompt-wrap">' +
      '<div class="prompt-head">' +
        '<h3>AIエージェント用プロンプト</h3>' +
        '<span class="spacer"></span>' +
        '<span class="stat">' + prompt.length.toLocaleString('ja-JP') + '字</span>' +
      '</div>' +
      '<div class="pre-wrap"><pre class="pre" id="reqPrompt">' + esc(prompt) + '</pre></div>' +
    '</div>';

    body.innerHTML = html;

    foot.innerHTML =
      '<button class="btn primary grow" id="reqCopy" type="button">📋 プロンプトをコピー</button>' +
      '<button class="btn ghost" id="reqClear" type="button">申請を全部消す</button>';
  }

  function openReqSheet() {
    renderReqSheet();
    openOverlay('reqSheet');
  }

  $('reqBtn').addEventListener('click', openReqSheet);

  $('reqBody').addEventListener('click', function (ev) {
    var del = ev.target.closest('[data-reqdel-rid]');
    if (del) {
      removeReq(del.getAttribute('data-reqdel-rid'));
      updateReqBadge();
      renderReqSheet();
      render();
      toast('申請を1件取り消しました', 'warn');
      return;
    }
    if (ev.target.closest('#reqAddBtn')) { openAddSheet(); }
  });

  $('reqBody').addEventListener('input', function (ev) {
    var m = ev.target.closest('[data-memo]');
    if (!m) return;
    var rid = m.getAttribute('data-memo');
    store.reqs.forEach(function (r) { if (r.rid === rid) r.memo = m.value; });
    save();
    // プロンプトだけ差し替える（入力中に画面が飛ばないように）
    var pre = $('reqPrompt');
    if (pre) pre.textContent = buildPrompt();
  });

  $('reqFoot').addEventListener('click', function (ev) {
    if (ev.target.closest('#reqCopy')) {
      doCopy(buildPrompt(), null, ev.target.closest('#reqCopy'), 'プロンプトをコピーしました');
      return;
    }
    if (ev.target.closest('#reqClear')) {
      if (!store.reqs.length) return;
      if (!window.confirm('申請 ' + store.reqs.length + '件をすべて取り消します。よろしいですか？')) return;
      store.reqs = [];
      save();
      updateReqBadge();
      renderReqSheet();
      render();
      toast('申請をすべて取り消しました', 'warn');
    }
  });

  /* --------------------------------------------------------- 追加申請フォーム */
  var addTags = [];

  function renderAddTags() {
    $('addTags').innerHTML = TAGS.map(function (t) {
      return '<button class="tagchip' + (addTags.indexOf(t.id) !== -1 ? ' on' : '') + '" data-addtag="' +
        esc(t.id) + '" style="--c:' + t.color + '" type="button">' + esc(t.id) + '</button>';
    }).join('');
  }

  function openAddSheet() {
    $('addCat').innerHTML = CATS.map(function (c) {
      return '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.name) + '</option>';
    }).join('');
    addTags = [];
    renderAddTags();
    $('addTitleInput').value = '';
    $('addSummary').value = '';
    $('addBody').value = '';
    $('addMemo').value = '';
    openOverlay('addSheet');
    setTimeout(function () { $('addTitleInput').focus(); }, 60);
  }

  $('addBtn').addEventListener('click', openAddSheet);

  $('addTags').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-addtag]');
    if (!b) return;
    var t = b.getAttribute('data-addtag');
    var i = addTags.indexOf(t);
    if (i === -1) addTags.push(t); else addTags.splice(i, 1);
    b.classList.toggle('on', addTags.indexOf(t) !== -1);
  });

  $('addSubmit').addEventListener('click', function () {
    var title = $('addTitleInput').value.trim();
    var body = $('addBody').value.replace(/\s+$/, '');
    if (!title) { toast('タイトルを入れてください', 'warn'); $('addTitleInput').focus(); return; }
    if (!body.trim()) { toast('本文を入れてください', 'warn'); $('addBody').focus(); return; }

    pushReq({
      kind: 'add',
      memo: $('addMemo').value.trim(),
      add: {
        title: title,
        cat: $('addCat').value,
        tags: addTags.slice(),
        summary: $('addSummary').value.trim(),
        body: body
      }
    });
    updateReqBadge();
    closeOverlay('addSheet');
    toast('✨ 「' + title + '」の追加を申請リストに入れました');
    if ($('reqSheet').hidden) openReqSheet(); else renderReqSheet();
  });

  /* --------------------------------------------------------------- キー操作 */
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (!$('noteSheet').hidden && (ev.key === 's' || ev.key === 'S') && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      if (pushHistory(note.content, 'manual')) {
        renderNoteHistory();
        $('noteHistCount').textContent = note.history.length;
        toast('💾 いまの内容を履歴に保存しました');
      }
      return;
    }

    if (ev.key === 'Escape') {
      if (!$('noteSheet').hidden) { closeOverlay('noteSheet'); return; }
      if (!$('addSheet').hidden) { closeOverlay('addSheet'); return; }
      if (!$('reqSheet').hidden) { closeOverlay('reqSheet'); render(); return; }
      if (!$('detail').hidden) { closeDetail(); return; }
      if (!$('filterSheet').hidden) { closeOverlay('filterSheet'); return; }
      if (!$('tour').hidden) { closeOverlay('tour'); return; }
      if (typing) { ev.target.blur(); return; }
      if (state.q || state.tags.length || state.cat !== 'all') resetAll();
      return;
    }

    if (typing) return;

    if (ev.key === '/' || (ev.key === 'k' && (ev.metaKey || ev.ctrlKey))) {
      ev.preventDefault();
      $('search').focus();
      $('search').select();
      return;
    }
    if (ev.key === 'm' || ev.key === 'M') {
      ev.preventDefault();
      openNote('edit');
    }
  });

  /* ------------------------------------------------------------------ 起動 */
  $('sort').value = state.sort;
  $('sort').addEventListener('change', function (ev) {
    state.sort = ev.target.value;
    store.sort = state.sort;
    save();
    render();
  });

  applyTheme();
  updateReqBadge();
  updateNoteDot();
  render();

  if (!store.tour) {
    setTimeout(openTour, 420);
  }
})();
