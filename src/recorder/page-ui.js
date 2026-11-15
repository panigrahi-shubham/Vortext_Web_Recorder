// TPHub in-page UI: toolbar (top frame only), hover outline + tooltip, and the menus for
// Assert / Wait for / Inspect / Drag modes. Everything lives in a CLOSED shadow root so
// page CSS cannot touch it and page scripts (and Playwright locators) cannot see into it.
/* eslint-disable */
(function () {
  var T = window.__tphub;
  if (!T || T.uiInstalled) return;
  T.uiInstalled = true;
  var TOP = window === window.top;
  var CFG = T.cfg || {};

  function call(cmd, payload) {
    if (typeof window.__tphubCall !== 'function') return Promise.resolve(null);
    try { return window.__tphubCall(cmd, payload); } catch (e) { return Promise.resolve(null); }
  }

  var host, root, outline, tip, menu, bar;
  var state = { steps: 0, status: 'recording', clickStyle: 'locator' };

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif;font-size:12px}',
    '.outline{position:fixed;pointer-events:none;border:2px solid #3c6df0;background:rgba(60,109,240,.08);border-radius:3px;z-index:2147483646;display:none}',
    '.outline.src{border-color:#a855f7;background:rgba(168,85,247,.12)}',
    '.tip{position:fixed;pointer-events:none;max-width:560px;background:#111827;color:#f9fafb;padding:6px 8px;border-radius:6px;z-index:2147483647;display:none;box-shadow:0 4px 14px rgba(0,0,0,.3)}',
    '.tip code{font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}',
    '.score{display:inline-block;min-width:30px;text-align:center;border-radius:10px;padding:0 6px;margin-right:6px;font-weight:600;color:#111}',
    '.green{background:#4ade80}.amber{background:#fbbf24}.red{background:#f87171}',
    '.warn{color:#fbbf24;margin-top:3px}',
    '.bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:4px;align-items:center;background:#111827;color:#f9fafb;padding:6px;border-radius:10px;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,.35);user-select:none;flex-wrap:wrap;max-width:96vw}',
    '.bar button,.bar select{background:#1f2937;color:#f9fafb;border:1px solid #374151;border-radius:6px;padding:4px 8px;cursor:pointer}',
    '.bar button:hover{background:#374151}',
    '.bar button.on{background:#3c6df0;border-color:#3c6df0}',
    '.bar .rec{width:9px;height:9px;border-radius:50%;background:#ef4444;display:inline-block;margin:0 4px}',
    '.bar .rec.paused{background:#9ca3af}',
    '.bar .count{padding:0 6px;color:#d1d5db}',
    '.bar .sep{width:1px;height:20px;background:#374151;margin:0 2px}',
    '.menu{position:fixed;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:2147483647;min-width:300px;max-width:520px;max-height:85vh;overflow:auto;padding:4px;display:none}',
    '.menu .head{padding:6px 8px;font-weight:600;border-bottom:1px solid #e5e7eb;margin-bottom:4px}',
    '.menu .head code{font-weight:400;font-family:Consolas,Menlo,monospace;word-break:break-all}',
    '.menu .item{padding:5px 8px;border-radius:5px;cursor:pointer;display:flex;justify-content:space-between;gap:10px}',
    '.menu .item:hover{background:#eef2ff}',
    '.menu .item small{color:#6b7280;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.menu .item.disabled{color:#9ca3af;cursor:default}',
    '.menu input{width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;margin:2px 0}',
    '.menu .row{padding:4px 8px}',
    '.menu .btn{background:#3c6df0;color:#fff;border:0;border-radius:5px;padding:4px 10px;cursor:pointer;margin-top:4px}',
    '.menu .cand{padding:4px 8px;font-family:Consolas,Menlo,monospace;font-size:11px;border-bottom:1px solid #f3f4f6}',
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function install() {
    if (host && host.isConnected) return;
    host = document.createElement('tphub-overlay');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647';
    root = host.attachShadow({ mode: 'closed' });
    var style = el('style');
    style.textContent = CSS;
    root.appendChild(style);
    outline = el('div', 'outline');
    tip = el('div', 'tip');
    menu = el('div', 'menu');
    root.appendChild(outline);
    root.appendChild(tip);
    root.appendChild(menu);
    if (TOP) buildBar();
    (document.documentElement || document.body).appendChild(host);
  }

  // ---------------------------------------------------------------- toolbar
  var MODES = [
    ['record', 'Record', 'Clicks, typing and selections become steps'],
    ['actions', 'Actions', 'Click an element to type/paste text, copy a value, press keys or choose an option'],
    ['assert', 'Assert', 'Click an element to add a check (nothing is clicked)'],
    ['waitfor', 'Wait for', 'Click an element to wait until it is visible or hidden'],
    ['inspect', 'Inspect', 'Hover to see the chosen locator, click for all candidates'],
    ['hover', 'Hover', 'Click an element to record a hover'],
    ['scroll', 'Scroll', 'Click an element to record scrolling it into view'],
    ['drag', 'Drag', 'Click the source, then the drop target'],
    ['pause', 'Pause', 'Stop recording while you set up the page'],
  ];
  var modeButtons = {};
  var recDot, countEl, styleSel;
  function buildBar() {
    bar = el('div', 'bar');
    bar.setAttribute('data-tphub-bar', '1');
    recDot = el('span', 'rec');
    bar.appendChild(recDot);
    bar.appendChild(el('strong', '', 'TPHub'));
    countEl = el('span', 'count', '0 steps');
    bar.appendChild(countEl);
    bar.appendChild(el('span', 'sep'));
    MODES.forEach(function (m) {
      var b = el('button', '', m[1]);
      b.title = m[2];
      b.setAttribute('data-mode', m[0]);
      b.addEventListener('click', function () { setMode(m[0]); });
      modeButtons[m[0]] = b;
      bar.appendChild(b);
    });
    bar.appendChild(el('span', 'sep'));
    styleSel = el('select');
    styleSel.title = 'Click style for new clicks';
    [['locator', 'Locator'], ['fallback', 'Locator + point'], ['coords', 'Point only']].forEach(function (o) {
      var opt = el('option', '', o[1]);
      opt.value = o[0];
      styleSel.appendChild(opt);
    });
    styleSel.addEventListener('change', function () { call('setClickStyle', styleSel.value); });
    bar.appendChild(styleSel);
    [['undo', 'Undo'], ['clear', 'Clear'], ['save', 'Save'], ['debug', 'Debug snapshot']].forEach(function (c) {
      var b = el('button', '', c[1]);
      b.setAttribute('data-cmd', c[0]);
      b.addEventListener('click', function () {
        // no window.confirm(): page dialogs are captured by the recorder. Ask for a second click instead.
        if (c[0] === 'clear' && !b.getAttribute('data-armed')) {
          b.setAttribute('data-armed', '1');
          b.textContent = 'Click again to clear';
          setTimeout(function () { b.removeAttribute('data-armed'); b.textContent = c[1]; }, 2500);
          return;
        }
        if (c[0] === 'clear') { b.removeAttribute('data-armed'); b.textContent = c[1]; }
        call(c[0]).then(function (r) { if (r && typeof r.steps === 'number') updateCount(r.steps); flash(b); });
      });
      bar.appendChild(b);
    });
    root.appendChild(bar);
    refreshBar();
  }
  function flash(b) {
    b.classList.add('on');
    setTimeout(function () { b.classList.remove('on'); }, 400);
  }
  function updateCount(n) {
    state.steps = n;
    if (countEl) countEl.textContent = n + (n === 1 ? ' step' : ' steps');
  }
  function refreshBar() {
    if (!bar) return;
    for (var k in modeButtons) modeButtons[k].classList.toggle('on', k === T.mode);
    recDot.classList.toggle('paused', T.mode === 'pause');
    if (styleSel && state.clickStyle) styleSel.value = state.clickStyle;
  }
  function setMode(m) {
    T.mode = m;
    hideMenu();
    T.dragSource = null;
    outline.classList.remove('src');
    refreshBar();
    call('setMode', m);
  }
  T.onModeChanged = function () {
    install();
    hideMenu();
    T.dragSource = null;
    refreshBar();
  };
  T.onState = function (s) {
    install();
    if (s.mode && s.mode !== T.mode) T.mode = s.mode;
    if (typeof s.steps === 'number') updateCount(s.steps);
    if (s.clickStyle) state.clickStyle = s.clickStyle;
    refreshBar();
  };

  // ---------------------------------------------------------------- outline + tooltip
  function showOutline(target, src) {
    var r = target.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = r.left - 2 + 'px';
    outline.style.top = r.top - 2 + 'px';
    outline.style.width = r.width + 4 + 'px';
    outline.style.height = r.height + 4 + 'px';
    outline.classList.toggle('src', !!src);
  }
  function hideHover() {
    outline.style.display = 'none';
    tip.style.display = 'none';
  }
  function color(score) {
    return score >= 75 ? 'green' : score >= 45 ? 'amber' : 'red';
  }
  function placeTip(r) {
    tip.style.display = 'block';
    var top = r.bottom + 6;
    if (top + tip.offsetHeight > window.innerHeight) top = Math.max(4, r.top - tip.offsetHeight - 6);
    tip.style.top = top + 'px';
    tip.style.left = Math.max(4, Math.min(r.left, window.innerWidth - tip.offsetWidth - 8)) + 'px';
  }
  function renderTip(target, res) {
    tip.innerHTML = '';
    if (!res || res.busy) {
      tip.appendChild(el('span', '', res && res.busy ? 'recorder busy…' : '…'));
    } else if (res.best) {
      var line = el('div');
      var sc = el('span', 'score ' + color(res.best.score), String(res.best.score));
      line.appendChild(sc);
      line.appendChild(el('code', '', res.best.kind === 'coords' ? 'no unique locator: coordinate click' : res.best.code));
      tip.appendChild(line);
      (res.best.warnings || []).slice(0, 2).forEach(function (w) { tip.appendChild(el('div', 'warn', '! ' + w)); });
    }
    placeTip(target.getBoundingClientRect());
  }

  var hoverEl = null;
  var hoverTimer = null;
  var cache = new WeakMap();
  function inspect(target) {
    var c = cache.get(target);
    if (c && Date.now() - c.t < 4000) return Promise.resolve(c.r);
    return call('inspect', T.describe(target, true)).then(function (r) {
      if (r && !r.busy) cache.set(target, { t: Date.now(), r: r });
      return r;
    });
  }
  window.addEventListener('mousemove', function (e) {
    if (!host) install();
    if (T.mode === 'pause' || menu.style.display === 'block') return;
    var raw = T.deepTarget(e);
    if (!raw || T.isOwnUi(raw)) { hideHover(); hoverEl = null; return; }
    var target = T.retarget(raw);
    if (target === hoverEl) return;
    hoverEl = target;
    showOutline(target, false);
    tip.style.display = 'none';
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      if (hoverEl !== target) return;
      renderTip(target, null);
      inspect(target).then(function (r) { if (hoverEl === target) renderTip(target, r); });
    }, CFG.tooltipDelay || 160);
  }, true);
  window.addEventListener('scroll', function () { hideHover(); hoverEl = null; }, true);
  document.addEventListener('mouseleave', function () { hideHover(); hoverEl = null; });

  // ---------------------------------------------------------------- menus
  function hideMenu() {
    if (menu) { menu.style.display = 'none'; menu.innerHTML = ''; }
  }
  function openMenu(x, y, title, code) {
    menu.innerHTML = '';
    var head = el('div', 'head', title);
    if (code) { head.appendChild(el('br')); head.appendChild(el('code', '', code)); }
    menu.appendChild(head);
    menu.style.display = 'block';
    menu.style.left = Math.min(x, window.innerWidth - 260) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 40) + 'px';
    return menu;
  }
  function fitMenu() {
    var r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - r.height - 8) + 'px';
  }
  function item(label, hint, onPick, disabled) {
    var it = el('div', 'item' + (disabled ? ' disabled' : ''));
    it.appendChild(el('span', '', label));
    if (hint) it.appendChild(el('small', '', hint));
    if (!disabled) it.addEventListener('click', function (ev) { ev.stopPropagation(); onPick(); });
    menu.appendChild(it);
    return it;
  }
  function inputRow(placeholders, values, onOk, buttonLabel) {
    menu.innerHTML = menu.firstChild ? menu.firstChild.outerHTML : '';
    var row = el('div', 'row');
    var inputs = placeholders.map(function (p, i) {
      var inp = el('input');
      inp.placeholder = p;
      inp.value = values[i] || '';
      row.appendChild(inp);
      return inp;
    });
    var ok = el('button', 'btn', buttonLabel || 'Add check');
    ok.addEventListener('click', function (ev) { ev.stopPropagation(); onOk(inputs.map(function (i) { return i.value; })); });
    inputs[inputs.length - 1].addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); ok.click(); } });
    row.appendChild(ok);
    menu.appendChild(row);
    setTimeout(function () { inputs[0].focus(); }, 0);
  }
  function stablePartJs(t) {
    var pieces = t.split(/[$€£₹¥]\s?[\d.,]+|\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?|#?\s?\d[\d.,]*%?/gi)
      .map(function (p) { return p.replace(/\s+/g, ' ').replace(/^[\s:()[\],.\-|/#]+|[\s:()[\],.\-|/#]+$/g, '').trim(); })
      .filter(function (p) { return p.length >= 2; });
    return pieces.sort(function (a, b) { return b.length - a.length; })[0] || t.trim();
  }
  function emitAssert(type, target, expected, attrName) {
    hideMenu();
    T.emit({ type: 'assert', assertType: type, target: target ? T.describe(target, true) : null, expected: expected, attrName: attrName });
  }

  function openAssertMenu(target, e) {
    var tag = target.tagName.toLowerCase();
    var text = (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
    var isField = tag === 'input' || tag === 'textarea' || tag === 'select';
    var isCheck = target.type === 'checkbox' || target.type === 'radio' || target.getAttribute('role') === 'checkbox' || target.getAttribute('role') === 'switch';
    openMenu(e.clientX + 4, e.clientY + 4, 'Add a check', '…');
    inspect(target).then(function (r) {
      var head = menu.querySelector('.head code');
      if (head && r && r.best) head.textContent = r.best.code + '   [' + r.best.score + ']';
    });
    item('is visible', '', function () { emitAssert('visible', target); });
    item('is hidden', '', function () { emitAssert('hidden', target); });
    item('is enabled', '', function () { emitAssert('enabled', target); });
    item('is disabled', '', function () { emitAssert('disabled', target); });
    if (isField) item('is editable', '', function () { emitAssert('editable', target); });
    if (isCheck) {
      item('is checked', '', function () { emitAssert('checked', target); });
      item('is unchecked', '', function () { emitAssert('unchecked', target); });
    }
    item('is focused', '', function () { emitAssert('focused', target); });
    if (!isField && text) {
      item('text equals', '"' + text.slice(0, 40) + '"', function () { emitAssert('textEquals', target, text); });
      item('text contains…', '"' + stablePartJs(text).slice(0, 40) + '"', function () {
        inputRow(['text the element should contain'], [stablePartJs(text)], function (v) { emitAssert('textContains', target, v[0]); });
      });
    }
    if (isField) item('value equals', '"' + String(target.value).slice(0, 40) + '"', function () { emitAssert('valueEquals', target, String(target.value)); });
    item('attribute equals…', '', function () {
      inputRow(['attribute name', 'value'], ['aria-label', target.getAttribute('aria-label') || ''], function (v) { emitAssert('attributeEquals', target, v[1], v[0]); });
    });
    var countItem = item('count of similar items', 'checking…', function () {}, true);
    call('count', T.describe(target, false)).then(function (r) {
      if (!r) { countItem.querySelector('small').textContent = 'not a repeated item'; return; }
      var fresh = item('count equals', r.count + ' × ' + r.code.replace(/^page\./, ''), function () { emitAssert('countEquals', target, r.count); });
      countItem.replaceWith(fresh);
    });
    item('URL matches', location.pathname, function () { emitAssert('urlMatches', null); });
    item('title matches', '"' + document.title.slice(0, 40) + '"', function () { emitAssert('titleMatches', null, document.title); });
    if (CFG.screenshots) item('matches screenshot', 'toHaveScreenshot', function () { emitAssert('screenshot', target); });
    if (CFG.axe) item('page has no accessibility violations', '@axe-core/playwright', function () { emitAssert('a11y', null); });
    else item('accessibility check', 'install @axe-core/playwright to enable', function () {}, true);
    fitMenu();
  }

  function openWaitMenu(target, e) {
    openMenu(e.clientX + 4, e.clientY + 4, 'Wait for this element');
    item('wait until visible', 'expect(...).toBeVisible()', function () { hideMenu(); T.emit({ type: 'waitVisible', target: T.describe(target, true) }); });
    item('wait until hidden', 'expect(...).not.toBeVisible()', function () { hideMenu(); T.emit({ type: 'waitHidden', target: T.describe(target, true) }); });
    fitMenu();
  }

  function openActions(target, e) {
    openMenu(e.clientX + 4, e.clientY + 4, 'Author an action', 'Choose an action for this element');
    function author(type, extra) {
      var payload = Object.assign({ type: type, target: T.describe(target, true), secret: T.isSecretField(target) }, extra || {});
      call('author', payload).then(function (r) {
        if (r && r.ok) hideMenu();
        else { var warning = el('div', 'row', 'Action failed: ' + (r && r.error || 'could not record')); warning.style.color = '#b91c1c'; menu.appendChild(warning); fitMenu(); }
      }).catch(function (err) { menu.appendChild(el('div', 'row', 'Action failed: ' + err.message)); fitMenu(); });
    }
    if (T.isTextField(target)) {
      var row = el('div', 'row');
      var text = el('textarea');
      text.placeholder = 'Type or paste text here (Ctrl+V). Multiple lines and Unicode supported.';
      text.setAttribute('aria-label', 'Text to enter');
      text.style.cssText = 'width:100%;min-height:80px;resize:vertical;user-select:text';
      row.appendChild(text);
      var method = el('select');
      method.setAttribute('aria-label', 'Text entry method');
      [['fill','Replace / paste text'],['type','Replace, then type characters'],['append','Append characters']].forEach(function (m) { var opt=el('option','',m[1]);opt.value=m[0];method.appendChild(opt); });
      row.appendChild(method);
      var delay = el('input'); delay.type='number'; delay.min='0'; delay.max='1000'; delay.value='0'; delay.title='Delay between characters in milliseconds';delay.setAttribute('aria-label','Typing delay in milliseconds');
      row.appendChild(el('div','','Typing delay (ms, character modes only)')); row.appendChild(delay);
      var apply = el('button','btn','Apply text');
      apply.addEventListener('click', function () { author('fill',{value:text.value,inputMode:method.value,typingDelay:Math.max(0,Math.min(1000,Number(delay.value)||0))}); });
      row.appendChild(apply);menu.appendChild(row);
      item('Clear field','fill an empty string',function () { author('fill',{value:'',inputMode:'fill'}); });
      item('Paste recorder clipboard','replace field using the last Copy action',function () { author('pasteText'); });
    }
    item('Copy value / text','portable recorder clipboard; no system permission needed',function () { author('copyText'); });
    if (target.tagName.toLowerCase() === 'select') {
      var optionsRow=el('div','row'), select=el('select');select.multiple=target.multiple;
      Array.from(target.options).forEach(function (o) { var opt=el('option','',o.label);opt.value=o.value;opt.disabled=o.disabled;opt.selected=o.selected;select.appendChild(opt); });
      optionsRow.appendChild(select);
      var choose=el('button','btn','Apply selection');choose.addEventListener('click',function () { author('select',{values:Array.from(select.selectedOptions).map(function (o) { return o.value; })}); });
      optionsRow.appendChild(choose);menu.appendChild(optionsRow);
    }
    if (target.type==='checkbox' || target.type==='radio' || ['checkbox','radio','switch'].indexOf(target.getAttribute('role'))>=0) {
      item('Check / enable','check()',function () { author('check'); });
      if(target.type!=='radio' && target.getAttribute('role')!=='radio') item('Uncheck / disable','uncheck()',function () { author('uncheck'); });
    }
    ['Enter','Tab','Escape','ArrowDown','ArrowUp','ControlOrMeta+A'].forEach(function (key) { item('Press '+key,'keyboard action',function () { author('press',{key:key}); }); });
    item('Press custom key / shortcut','e.g. ControlOrMeta+End or Shift+Tab',function () {
      inputRow(['Key or shortcut'],['Enter'],function (v) { author('press',{key:v[0]}); },'Press key');
    });
    fitMenu();
  }

  function openInspect(target, e) {
    openMenu(e.clientX + 4, e.clientY + 4, 'Locator candidates (best first)');
    inspect(target).then(function (r) {
      if (!r || r.busy) { menu.appendChild(el('div', 'cand', 'recorder busy, try again')); return; }
      [r.best].concat(r.alternatives || []).forEach(function (c) {
        var row = el('div', 'cand');
        row.appendChild(el('span', 'score ' + color(c.score), String(c.score)));
        row.appendChild(document.createTextNode(c.kind === 'coords' ? '(coordinate click)' : c.code));
        if (!c.usable && c.warnings && c.warnings.length) row.appendChild(el('div', 'warn', c.warnings[c.warnings.length - 1]));
        menu.appendChild(row);
      });
      fitMenu();
    });
  }

  T.onDragSource = function (target) {
    if (target) showOutline(target, true);
    else outline.classList.remove('src');
  };
  T.onModeClick = function (target, e) {
    install();
    switch (T.mode) {
      case 'actions': return openActions(target, e);
      case 'assert': return openAssertMenu(target, e);
      case 'waitfor': return openWaitMenu(target, e);
      case 'inspect': return openInspect(target, e);
    }
  };
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu && menu.style.display === 'block') { hideMenu(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('mousedown', function (e) {
    if (menu && menu.style.display === 'block' && !T.isOwnUi(T.deepTarget(e))) hideMenu();
  }, true);

  // ---------------------------------------------------------------- test hooks
  // The UI is in a closed shadow root, so tests cannot query it. These helpers return
  // screen rectangles so a test can click the real toolbar with page.mouse.
  T.uiRect = function (kind, value) {
    install();
    var node = null;
    if (kind === 'mode') node = modeButtons[value];
    else if (kind === 'cmd') node = bar && bar.querySelector('[data-cmd="' + value + '"]');
    else if (kind === 'style') node = styleSel;
    else if (kind === 'menu') {
      var items = menu.querySelectorAll('.item,.btn');
      for (var i = 0; i < items.length; i++) if (items[i].textContent.indexOf(value) === 0) { node = items[i]; break; }
    }
    else if (kind === 'authorText') node = menu.querySelector('textarea');
    else if (kind === 'authorMethod') node = menu.querySelector('select');
    else if (kind === 'authorDelay') node = menu.querySelector('input[type=number]');
    if (!node) return null;
    var r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  };
  T.uiText = function (kind) {
    if (kind === 'tip') return tip && tip.style.display === 'block' ? tip.textContent : '';
    if (kind === 'menu') return menu && menu.style.display === 'block' ? menu.textContent : '';
    if (kind === 'count') return countEl ? countEl.textContent : '';
    return '';
  };

  // ---------------------------------------------------------------- boot
  function boot() {
    install();
    call('hello').then(function (s) { if (s) T.onState(s); });
  }
  if (document.documentElement) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
  // re-attach if a framework wipes <html> children
  setInterval(function () { if (host && !host.isConnected) { host = null; install(); } }, 1000);
})();
