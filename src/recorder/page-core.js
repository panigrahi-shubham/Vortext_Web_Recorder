// TPHub in-page core. Plain JavaScript on purpose: it is injected as text into every
// frame, so it must not depend on any TypeScript/esbuild helper.
// Exposes window.__tphub with: describe, snapshot, register/getTarget, settle info, event capture.
/* eslint-disable */
(function () {
  if (window.__tphub) return;
  var CFG = window.__tphubConfig || {};
  var TESTID = CFG.testIdAttr || 'data-testid';
  var HOST_TAG = 'tphub-overlay';

  var T = (window.__tphub = {
    cfg: CFG,
    mode: CFG.mode || 'record',
    capture: !!CFG.capture,
    suppress: 0,
    lastMutation: performance.now(),
    mutationCount: 0,
  });

  // ------------------------------------------------------------------ registry
  var nextId = 1;
  var idByEl = new WeakMap();
  var elById = new Map();
  T.register = function (el) {
    if (!el) return 0;
    var id = idByEl.get(el);
    if (id) return id;
    id = nextId++;
    idByEl.set(el, id);
    elById.set(id, typeof WeakRef !== 'undefined' ? new WeakRef(el) : { deref: function () { return el; } });
    if (elById.size > 5000) {
      var first = elById.keys().next().value;
      elById.delete(first);
    }
    return id;
  };
  T.getTarget = function (id) {
    var r = elById.get(id);
    return r ? r.deref() || null : null;
  };

  // ------------------------------------------------------------------ helpers
  function norm(s) {
    return (s || '').replace(/[\s ]+/g, ' ').trim();
  }
  function clip(s, n) {
    s = norm(s);
    return s.length > n ? s.slice(0, n) : s;
  }
  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    var root = el.parentNode;
    if (root && root.host) return root.host; // shadow root -> host
    return null;
  }
  function isOwnUi(el) {
    for (var n = el; n; n = parentOf(n)) if (n.tagName && n.tagName.toLowerCase() === HOST_TAG) return true;
    return false;
  }
  T.isOwnUi = isOwnUi;
  function rootOf(el) {
    return el.getRootNode ? el.getRootNode() : document;
  }
  function byId(el, id) {
    var root = rootOf(el);
    return (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id);
  }
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      // display: contents and similar: check children
      if (getComputedStyle(el).display !== 'contents') return false;
    }
    var st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.visibility === 'collapse' || st.display === 'none') return false;
    return true;
  }
  T.isVisible = isVisible;
  function isHiddenForA11y(el) {
    for (var n = el; n && n.nodeType === 1; n = parentOf(n)) {
      if (n.getAttribute('aria-hidden') === 'true') return true;
      if (n.hidden) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ roles
  var TEXT_INPUTS = { text: 1, email: 1, tel: 1, url: 1, password: 1, '': 1, date: 1, 'datetime-local': 1, month: 1, week: 1, time: 1 };
  function implicitRole(el) {
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    switch (tag) {
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : null;
      case 'button':
        return 'button';
      case 'input':
        if (type === 'hidden') return null;
        if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
        if (type === 'file' || type === 'color') return null;
        if (TEXT_INPUTS[type] !== undefined || !type) return el.hasAttribute('list') ? 'combobox' : 'textbox';
        return 'textbox';
      case 'select':
        return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
      case 'textarea':
        return 'textbox';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return 'heading';
      case 'img':
        return el.getAttribute('alt') === '' ? 'presentation' : 'img';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'aside': return 'complementary';
      case 'header': return insideSectioning(el) ? null : 'banner';
      case 'footer': return insideSectioning(el) ? null : 'contentinfo';
      case 'form': return el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('name') ? 'form' : null;
      case 'section': return el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ? 'region' : null;
      case 'article': return 'article';
      case 'table': return 'table';
      case 'thead': case 'tbody': case 'tfoot': return 'rowgroup';
      case 'tr': return 'row';
      case 'td': return 'cell';
      case 'th': return el.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
      case 'ul': case 'ol': case 'menu': return 'list';
      case 'li': return 'listitem';
      case 'dialog': return 'dialog';
      case 'option': return 'option';
      case 'progress': return 'progressbar';
      case 'meter': return 'meter';
      case 'output': return 'status';
      case 'hr': return 'separator';
      case 'fieldset': return 'group';
      case 'details': return 'group';
      case 'figure': return 'figure';
      case 'p': return 'paragraph';
    }
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) return 'textbox';
    return null;
  }
  function insideSectioning(el) {
    for (var n = el.parentElement; n; n = n.parentElement) {
      var t = n.tagName.toLowerCase();
      if (t === 'article' || t === 'aside' || t === 'main' || t === 'nav' || t === 'section') return true;
    }
    return false;
  }
  function getRole(el) {
    var explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit) return explicit;
    return implicitRole(el);
  }
  T.getRole = getRole;

  // ------------------------------------------------------------------ accessible name (simplified accname)
  var NAME_FROM_CONTENT = {
    button: 1, link: 1, heading: 1, cell: 1, gridcell: 1, columnheader: 1, rowheader: 1, checkbox: 1, radio: 1,
    option: 1, tab: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1, treeitem: 1, switch: 1, tooltip: 1, row: 1,
    sectionhead: 1,
  };
  function textFromContent(el, depth) {
    if (depth > 30) return '';
    var out = [];
    var kids = el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) out.push(n.nodeValue);
      else if (n.nodeType === 1) {
        var tag = n.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'template' || tag === HOST_TAG) continue;
        if (n.getAttribute('aria-hidden') === 'true' || n.hidden) continue;
        var st = getComputedStyle(n);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        if (n.getAttribute('aria-label')) { out.push(' ' + n.getAttribute('aria-label') + ' '); continue; }
        if (tag === 'img') { out.push(' ' + (n.getAttribute('alt') || '') + ' '); continue; }
        if (tag === 'input' || tag === 'textarea') { out.push(' ' + (n.value || '') + ' '); continue; }
        if (tag === 'select') { var o = n.selectedOptions && n.selectedOptions[0]; out.push(' ' + (o ? o.textContent : '') + ' '); continue; }
        var block = st.display !== 'inline' && st.display !== 'contents';
        if (block) out.push(' ');
        out.push(textFromContent(n, depth + 1));
        if (block) out.push(' ');
      }
    }
    // slotted content
    if (el.tagName && el.tagName.toLowerCase() === 'slot' && el.assignedNodes) {
      var an = el.assignedNodes();
      for (var j = 0; j < an.length; j++) out.push(an[j].nodeType === 3 ? an[j].nodeValue : textFromContent(an[j], depth + 1));
    }
    return out.join('');
  }
  function labelText(el) {
    var labels = el.labels ? Array.prototype.slice.call(el.labels) : [];
    if (!labels.length) return '';
    return norm(labels.map(function (l) {
      // exclude the control's own value from a wrapping label
      var clone = l.cloneNode(true);
      var ctrls = clone.querySelectorAll('input,select,textarea,button');
      for (var i = 0; i < ctrls.length; i++) ctrls[i].remove();
      return clone.textContent;
    }).join(' '));
  }
  function accessibleName(el, role) {
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var parts = lb.split(/\s+/).map(function (id) {
        var t = byId(el, id);
        return t ? (t.getAttribute('aria-label') || textFromContent(t, 0)) : '';
      });
      var s = norm(parts.join(' '));
      if (s) return s;
    }
    var al = norm(el.getAttribute('aria-label'));
    if (al) return al;
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && (type === 'button' || type === 'submit' || type === 'reset')) {
      return norm(el.value) || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '');
    }
    if (tag === 'input' && type === 'image') return norm(el.getAttribute('alt')) || norm(el.getAttribute('title')) || 'Submit';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var l = labelText(el);
      if (l) return l;
      return norm(el.getAttribute('title')) || norm(el.getAttribute('placeholder'));
    }
    if (tag === 'img' || tag === 'area') return norm(el.getAttribute('alt')) || norm(el.getAttribute('title'));
    if (tag === 'fieldset') { var lg = el.querySelector('legend'); if (lg) return norm(lg.textContent); }
    if (tag === 'table') { var cap = el.querySelector('caption'); if (cap) return norm(cap.textContent); }
    if (tag === 'figure') { var fc = el.querySelector('figcaption'); if (fc) return norm(fc.textContent); }
    if (role && NAME_FROM_CONTENT[role]) {
      var c = norm(textFromContent(el, 0));
      if (c) return c;
    }
    return norm(el.getAttribute('title'));
  }
  T.accessibleName = accessibleName;

  function visibleText(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return '';
    var t = el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent;
    return clip(t, 120);
  }

  // ------------------------------------------------------------------ class/name heuristics (light copy of rank.ts)
  function looksGenerated(n) {
    if (!n || n.length > 40) return true;
    return /^[a-f0-9]{8,}$/i.test(n) || /(?=[a-f0-9]*\d)(?=[a-f0-9]*[a-f])[a-f0-9]{6,}/i.test(n) || /^(css|sc)-/i.test(n) ||
      /^jsx-\d/.test(n) || /^ember\d/i.test(n) || /^:.*:$/.test(n) || /__[A-Za-z0-9_-]{5,}$/.test(n) || /\d+$/.test(n) || /^\d/.test(n) ||
      /^ng-/.test(n) || /^makeStyles-/.test(n);
  }
  function stableClassList(el) {
    var list = [];
    var cl = el.classList || [];
    for (var i = 0; i < cl.length; i++) {
      var c = cl[i];
      if (c.length >= 3 && !looksGenerated(c) && !/[:[\]/!@]/.test(c)) list.push(c);
    }
    return list;
  }

  // ------------------------------------------------------------------ repeated containers
  function signature(el) {
    return el.tagName.toLowerCase() + '|' + (getRole(el) || '');
  }
  function sameKind(a, b) {
    if (signature(a) !== signature(b)) return false;
    var ca = a.classList, cb = b.classList;
    if (!ca.length && !cb.length) return true;
    for (var i = 0; i < ca.length; i++) if (cb.contains(ca[i])) return true;
    return false;
  }
  function siblingsLike(el) {
    var p = el.parentElement || (el.parentNode && el.parentNode.host ? el.parentNode : null);
    if (!p) return [el];
    var kids = p.children;
    var out = [];
    for (var i = 0; i < kids.length; i++) if (kids[i] === el || sameKind(kids[i], el)) out.push(kids[i]);
    return out;
  }
  function textOf(el) {
    var t = el.innerText !== undefined ? el.innerText : el.textContent;
    // include open shadow DOM text (Playwright's hasText sees it too)
    if (el.shadowRoot) t = (el.shadowRoot.textContent || '') + ' ' + (t || '');
    return norm(t);
  }
  function anchorFor(container, sibs, excludeText) {
    var others = sibs.filter(function (s) { return s !== container; }).map(textOf);
    function okText(t) {
      t = norm(t);
      if (t.length < 2 || t.length > 60) return false;
      if (excludeText && t.toLowerCase() === excludeText.toLowerCase()) return false;
      for (var i = 0; i < others.length; i++) if (others[i].indexOf(t) !== -1) return false;
      return true;
    }
    var PREF = 'h1,h2,h3,h4,h5,h6,a,[class*="name" i],[class*="title" i],th,td,strong,b,label,[data-testid]';
    var preferred = Array.prototype.slice.call(container.querySelectorAll(PREF));
    if (container.shadowRoot) preferred = Array.prototype.slice.call(container.shadowRoot.querySelectorAll(PREF)).concat(preferred);
    var best = null;
    for (var i = 0; i < preferred.length; i++) {
      var t = textOf(preferred[i]);
      if (okText(t) && !/\d{4,}|[$€£₹]\s?\d/.test(t)) { best = t; break; }
    }
    if (best) return best;
    // any short leaf text
    var walker = document.createTreeWalker(container.shadowRoot || container, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var pe = node.parentElement;
      if (pe && pe.closest && pe.closest('button,[role=button],select,option,textarea,input') && container.contains(pe.closest('button,[role=button],select,option,textarea,input'))) continue;
      var tt = norm(node.nodeValue);
      if (okText(tt) && !/\d{3,}|[$€£₹]\s?\d/.test(tt)) return tt;
    }
    return null;
  }
  function repeatInfo(el, ownName) {
    var n = el;
    for (var level = 0; n && level < 8; level++) {
      var tag = n.tagName ? n.tagName.toLowerCase() : '';
      if (tag === 'body' || tag === 'html') break;
      var nRole = getRole(n);
      var isCell = nRole === 'cell' || nRole === 'gridcell' || nRole === 'columnheader' || nRole === 'rowheader';
      var sibs = isCell ? [] : siblingsLike(n);
      if (sibs.length >= 2) {
        var anchor = anchorFor(n, sibs, ownName);
        if (anchor) {
          return {
            containerRole: getRole(n),
            containerTag: tag,
            containerClasses: stableClassList(n),
            containerTestId: n.getAttribute(TESTID),
            siblings: sibs.length,
            anchorText: anchor,
            index: sibs.indexOf(n),
          };
        }
      }
      n = parentOf(n);
    }
    return null;
  }

  // ------------------------------------------------------------------ descriptor
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }
  function isTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      return TEXT_INPUTS[type] !== undefined || type === 'search' || type === 'number';
    }
    return !!el.isContentEditable;
  }
  T.isTextField = isTextField;

  function describeOne(el, withRepeat) {
    var role = getRole(el);
    var name = accessibleName(el, role);
    var tag = el.tagName.toLowerCase();
    var lbl = (tag === 'input' || tag === 'select' || tag === 'textarea') ? labelText(el) : '';
    if (!lbl && el.getAttribute('aria-labelledby')) lbl = name;
    var d = {
      tag: tag,
      role: role,
      name: clip(name, 200),
      text: visibleText(el),
      testId: el.getAttribute(TESTID),
      testIdAttr: TESTID,
      id: el.id || null,
      label: lbl || (el.getAttribute('aria-label') && (tag === 'input' || tag === 'select' || tag === 'textarea') ? norm(el.getAttribute('aria-label')) : null),
      placeholder: el.getAttribute('placeholder') || null,
      alt: tag === 'img' || tag === 'area' || (tag === 'input' && el.type === 'image') ? el.getAttribute('alt') || null : null,
      title: el.getAttribute('title') || null,
      inputType: tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : null,
      nameAttr: el.getAttribute('name') || null,
      classes: Array.prototype.slice.call(el.classList || []),
      rect: rectOf(el),
      editable: isTextField(el) && !el.readOnly && !el.disabled,
      checked: el.type === 'checkbox' || el.type === 'radio' ? !!el.checked : el.hasAttribute('aria-checked') ? el.getAttribute('aria-checked') === 'true' : null,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      inShadow: rootOf(el) !== document && !!rootOf(el).host,
      headingLevel: /^h[1-6]$/.test(tag) ? +tag[1] : el.getAttribute('aria-level') ? +el.getAttribute('aria-level') : null,
      repeat: withRepeat ? repeatInfo(el, name) : null,
      targetId: T.register(el),
    };
    return d;
  }
  T.describe = function (el, withAncestors) {
    var d = describeOne(el, true);
    if (withAncestors) {
      d.ancestors = [];
      var n = parentOf(el);
      for (var level = 1; n && level <= 3; level++) {
        if (n.tagName.toLowerCase() === 'body') break;
        var a = describeOne(n, true);
        a.level = level;
        d.ancestors.push(a);
        n = parentOf(n);
      }
    }
    return d;
  };

  /** Clicks on an icon inside a button should target the button. */
  var INTERACTIVE_SEL = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=checkbox],[role=radio],[role=option],[role=switch],[role=treeitem],[role=combobox]';
  T.retarget = function (el) {
    if (!el || el.nodeType !== 1) return el;
    var n = el;
    for (var level = 0; n && level <= 3; level++) {
      if (n.matches && n.matches(INTERACTIVE_SEL)) {
        if (n.tagName.toLowerCase() === 'label' && n.control) {
          var t = (n.control.getAttribute('type') || '').toLowerCase();
          if (t === 'checkbox' || t === 'radio') return n.control;
        }
        return n;
      }
      n = parentOf(n);
    }
    return el;
  };

  /** Deep target of an event (through open shadow roots). */
  T.deepTarget = function (e) {
    var p = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < p.length; i++) if (p[i] && p[i].nodeType === 1) return p[i];
    return e.target;
  };

  // ------------------------------------------------------------------ deep query (open shadow roots)
  function deepAll(root, sel, out) {
    out = out || [];
    var found = root.querySelectorAll(sel);
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    var all = root.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) if (all[j].shadowRoot) deepAll(all[j].shadowRoot, sel, out);
    return out;
  }
  T.deepAll = deepAll;

  function pathOf(el) {
    var parts = [];
    for (var n = el; n && n.nodeType === 1; ) {
      var p = n.parentElement;
      var tag = n.tagName.toLowerCase();
      if (tag === 'html') break;
      var idx = 1;
      if (p) {
        var kids = p.children;
        for (var i = 0; i < kids.length && kids[i] !== n; i++) if (kids[i].tagName === n.tagName) idx++;
      }
      parts.unshift(tag + ':' + idx);
      if (!p && n.parentNode && n.parentNode.host) {
        parts.unshift('>>');
        n = n.parentNode.host;
      } else n = p;
    }
    return parts.join('/');
  }
  T.pathOf = pathOf;

  // ------------------------------------------------------------------ interactive list for `check` and snapshots
  var INTERACTIVE_QUERY = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=switch],[role=menuitem],[role=option],[role=combobox],[role=textbox],[role=slider],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  T.interactiveElements = function () {
    return deepAll(document, INTERACTIVE_QUERY).filter(function (el) { return !isOwnUi(el) && isVisible(el); });
  };

  // ------------------------------------------------------------------ snapshot
  var VOLATILE_RE = /(spinner|loader|loading|skeleton|overlay|backdrop|modal|toast|snackbar|notification|flash-message|alert)/i;
  function volatileKind(el, role) {
    var cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
    if (role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true' || el.tagName.toLowerCase() === 'dialog') return /modal/i.test(cls) ? 'modal' : 'dialog';
    if (role === 'alert') return 'alert';
    if (/toast|snackbar|notification|flash-message/i.test(cls)) return 'toast';
    if (role === 'status' || el.getAttribute('aria-live') === 'polite' || el.getAttribute('aria-live') === 'assertive') return 'status';
    if (role === 'progressbar' || /spinner|loader|loading|skeleton/i.test(cls)) return 'spinner';
    if (/overlay|backdrop/i.test(cls)) return 'overlay';
    if (/modal/i.test(cls)) return 'modal';
    return null;
  }
  var SNAP_QUERY = INTERACTIVE_QUERY + ',h1,h2,h3,h4,h5,h6,[role=heading],img[alt],[role=dialog],[role=alertdialog],[role=alert],[role=status],[role=progressbar],[aria-live],dialog,output,[' + TESTID + '],[class*=badge i],[class*=count i],[class*=total i],[class*=message i],[class*=error i],[class*=toast i],[class*=snackbar i],[class*=spinner i],[class*=loader i],[class*=loading i],[class*=modal i],[class*=overlay i],[class*=title i],[id]';
  T.snapshot = function () {
    var els = deepAll(document, SNAP_QUERY);
    var seen = new Set();
    var out = [];
    for (var i = 0; i < els.length && out.length < 400; i++) {
      var el = els[i];
      if (seen.has(el) || isOwnUi(el)) continue;
      seen.add(el);
      var tag = el.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style') continue;
      if (!isVisible(el)) continue;
      var role = getRole(el);
      var vk = volatileKind(el, role);
      var interactive = el.matches(INTERACTIVE_QUERY);
      // plain elements with an id/class but no meaning: keep only short leaf texts (badges, totals, messages)
      if (!interactive && !vk && role !== 'heading' && tag !== 'img' && !el.hasAttribute(TESTID)) {
        if (el.children.length > 2) continue;
        var tx = textOf(el);
        if (!tx || tx.length > 80) continue;
      }
      var d = describeOne(el, interactive || !!el.hasAttribute(TESTID));
      out.push({
        key: pathOf(el),
        d: d,
        value: !isSecretField(el) && 'value' in el && (tag === 'input' || tag === 'textarea' || tag === 'select') ? String(el.value) : null,
        selected: el.hasAttribute('aria-selected') ? el.getAttribute('aria-selected') === 'true' : null,
        expanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') === 'true' : tag === 'details' ? el.open : null,
        pressed: el.hasAttribute('aria-pressed') ? el.getAttribute('aria-pressed') === 'true' : null,
        volatile: vk,
        landmark: role === 'heading' || !!vk,
        leaf: el.children.length === 0,
      });
    }
    // repeated groups (list items, rows, cards)
    var groups = new Map();
    var candidates = deepAll(document, 'tr,li,article,[role=row],[role=listitem],[role=article],[role=option],[class*=item i],[class*=card i],[class*=row i],[class*=product i],[class*=result i]');
    for (var g = 0; g < candidates.length; g++) {
      var c = candidates[g];
      if (isOwnUi(c) || !isVisible(c) || !c.parentElement) continue;
      var sib = siblingsLike(c);
      var r = getRole(c);
      var listy = r === 'row' || r === 'listitem' || r === 'article' || r === 'option';
      if (sib.length < (listy ? 1 : 2)) continue;
      var gk = pathOf(c.parentElement) + '|' + signature(c) + '|' + (stableClassList(c)[0] || '');
      if (!groups.has(gk)) {
        groups.set(gk, { key: gk, count: sib.filter(isVisible).length, role: r, tag: c.tagName.toLowerCase(), classes: stableClassList(c), testId: c.getAttribute(TESTID) });
      }
    }
    var active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return {
      url: location.href,
      title: document.title,
      elements: out,
      groups: Array.from(groups.values()),
      focusedKey: active && active !== document.body ? pathOf(active) : null,
    };
  };

  // ------------------------------------------------------------------ mutation tracking for settle detection
  function startObserver() {
    try {
      var mo = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          var t = r.target;
          if (r.type === 'attributes' && r.attributeName && r.attributeName.indexOf('data-tphub') === 0) continue;
          if (t && t.nodeType === 1 && t.tagName.toLowerCase() === HOST_TAG) continue;
          T.lastMutation = performance.now();
          T.mutationCount++;
          return;
        }
      });
      mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) {}
  }
  T.quietFor = function () {
    return performance.now() - T.lastMutation;
  };
  if (document.documentElement) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

  // ------------------------------------------------------------------ event capture
  function emit(evt) {
    if (typeof window.__tphubEmit === 'function') {
      try { window.__tphubEmit(evt); } catch (e) {}
    }
  }
  T.emit = emit;

  var lastValue = new WeakMap(); // value we already reported (or the value at focus time)
  var dirty = new Set();
  function fieldValue(el) {
    return el.isContentEditable ? el.innerText : el.value;
  }
  function isSecretField(el) {
    var t = (el.getAttribute('type') || '').toLowerCase();
    var n = ((el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('autocomplete') || '')).toLowerCase();
    return t === 'password' || /token|secret|apikey|api-key|api_key|otp|one-time-code|passcode|pin\b/.test(n);
  }
  T.isSecretField = isSecretField;
  function flushField(el) {
    if (!dirty.has(el)) return;
    dirty.delete(el);
    var v = fieldValue(el);
    var prev = lastValue.get(el);
    if (prev === v) return;
    lastValue.set(el, v);
    emit({ type: 'fill', target: T.describe(el, false), value: v, secret: isSecretField(el), applied: true, t: Date.now() });
  }
  T.flushFills = function () {
    Array.from(dirty).forEach(flushField);
  };

  function modifiers(e) {
    var m = [];
    if (e.ctrlKey) m.push('Control');
    if (e.metaKey) m.push('Meta');
    if (e.altKey) m.push('Alt');
    if (e.shiftKey) m.push('Shift');
    return m;
  }

  var pendingClick = null;
  function sendPendingClick() {
    if (!pendingClick) return;
    var p = pendingClick;
    pendingClick = null;
    clearTimeout(p.timer);
    emit(p.evt);
  }
  T.sendPendingClick = sendPendingClick;

  function clickEvent(type, e, el) {
    var target = T.retarget(el);
    var desc = T.describe(target, true);
    // the browser toggles a checkbox before dispatching "click": report the state before it
    if (type === 'click' && target.tagName && target.tagName.toLowerCase() === 'input' && target.type === 'checkbox') desc.checked = !target.checked;
    return {
      type: type,
      target: desc,
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      vw: window.innerWidth,
      vh: window.innerHeight,
      modifiers: modifiers(e),
      t: Date.now(),
    };
  }

  function wantsIntercept(e) {
    if (!T.capture || !e.isTrusted || T.suppress > 0) return false;
    if (T.mode === 'pause') return false;
    var el = T.deepTarget(e);
    if (!el || isOwnUi(el)) return false;
    if (T.mode === 'record') {
      if (isTextField(el)) return false; // typing and focusing work natively; we record the final value
      var tag = el.tagName.toLowerCase();
      if (tag === 'select' || tag === 'option' || (tag === 'input' && el.type === 'file')) return false;
      if (tag === 'label' && el.control && (el.control.tagName.toLowerCase() === 'select' || el.control.type === 'file' || isTextField(el.control))) return false;
    }
    return true;
  }

  function onMouse(e) {
    if (!wantsIntercept(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') {
      var el = T.deepTarget(e);
      if (T.mode !== 'record') {
        var tgt = T.retarget(el);
        if (T.mode === 'hover' || T.mode === 'scroll') {
          emit({ type: T.mode === 'hover' ? 'hover' : 'scrollIntoView', target: T.describe(tgt, true), t: Date.now() });
        } else if (T.mode === 'drag') {
          if (!T.dragSource) {
            T.dragSource = tgt;
            if (T.onDragSource) T.onDragSource(tgt);
          } else {
            var src = T.dragSource;
            T.dragSource = null;
            if (T.onDragSource) T.onDragSource(null);
            emit({ type: 'drag', target: T.describe(src, true), target2: T.describe(tgt, true), t: Date.now() });
          }
        } else if (T.onModeClick) T.onModeClick(tgt, e);
        return;
      }
      T.flushFills();
      if (e.detail >= 2 && pendingClick) {
        clearTimeout(pendingClick.timer);
        pendingClick = null;
        emit(clickEvent('dblclick', e, el));
        return;
      }
      sendPendingClick();
      var evt = clickEvent('click', e, el);
      pendingClick = { evt: evt, timer: setTimeout(sendPendingClick, CFG.dblclickWindow || 220) };
    } else if (e.type === 'contextmenu' && T.mode === 'record') {
      T.flushFills();
      sendPendingClick();
      emit(clickEvent('rightclick', e, T.deepTarget(e)));
    }
  }
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick'].forEach(function (t) {
    window.addEventListener(t, onMouse, true);
  });

  window.addEventListener('focusin', function (e) {
    var el = T.deepTarget(e);
    if (isTextField(el) && !lastValue.has(el)) lastValue.set(el, fieldValue(el));
  }, true);
  window.addEventListener('input', function (e) {
    if (!T.capture || T.suppress > 0 || T.mode === 'pause') return;
    var el = T.deepTarget(e);
    if (isTextField(el) && !isOwnUi(el)) {
      if (!lastValue.has(el)) lastValue.set(el, '');
      dirty.add(el);
    }
  }, true);
  window.addEventListener('focusout', function (e) {
    var el = T.deepTarget(e);
    if (dirty.has(el)) flushField(el);
  }, true);

  window.addEventListener('change', function (e) {
    if (!T.capture || T.suppress > 0 || T.mode === 'pause') return;
    var el = T.deepTarget(e);
    if (!el || isOwnUi(el)) return;
    var tag = el.tagName.toLowerCase();
    if (isTextField(el)) { if (dirty.has(el)) flushField(el); return; }
    sendPendingClick();
    if (tag === 'select') {
      T.flushFills();
      var vals = Array.prototype.slice.call(el.selectedOptions).map(function (o) { return o.value; });
      emit({ type: 'select', target: T.describe(el, false), values: vals, applied: true, t: Date.now() });
    } else if (tag === 'input' && el.type === 'file') {
      var names = Array.prototype.slice.call(el.files || []).map(function (f) { return f.name; });
      emit({ type: 'upload', target: T.describe(el, false), files: names, applied: true, t: Date.now() });
    } else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      // keyboard (space) toggles reach here; mouse toggles are intercepted and replayed
      emit({ type: el.checked ? 'check' : 'uncheck', target: T.describe(el, false), applied: true, t: Date.now() });
    }
  }, true);

  var EDIT_COMBOS = /^(Control|Meta)\+(a|c|v|x|z|y|ArrowLeft|ArrowRight|Backspace|Delete)$/i;
  window.addEventListener('keydown', function (e) {
    if (!T.capture || !e.isTrusted || T.suppress > 0 || T.mode !== 'record') return;
    var el = T.deepTarget(e);
    if (el && isOwnUi(el)) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].indexOf(e.key) !== -1) return;
    var mods = modifiers(e);
    var hasCombo = e.ctrlKey || e.metaKey || e.altKey;
    var special = e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab';
    if (!special && !hasCombo) return;
    var tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    if (e.key === 'Enter' && !hasCombo && (tag === 'textarea' || (el && el.isContentEditable))) return;
    var combo = mods.concat([e.key.length === 1 ? e.key : e.key]).join('+');
    if (isTextField(el) && EDIT_COMBOS.test(combo)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    T.flushFills();
    sendPendingClick();
    var focused = el && el !== document.body && el !== document.documentElement ? el : null;
    emit({ type: 'press', key: combo, target: focused ? T.describe(focused, false) : null, t: Date.now() });
  }, true);

  // Navigation-safe: report pending fills before the page goes away.
  window.addEventListener('pagehide', function () { try { T.flushFills(); sendPendingClick(); } catch (e) {} }, true);
})();
