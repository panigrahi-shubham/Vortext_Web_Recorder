// Demo shop logic shared by the fixture pages. State lives in localStorage.
(function () {
  var PRODUCTS = [
    { id: 4, name: 'Trail Backpack', price: 29.99, desc: 'Carry everything with this rugged backpack.' },
    { id: 0, name: 'Bike Light', price: 9.99, desc: 'A red light that keeps you visible at night.' },
    { id: 1, name: 'Bolt T-Shirt', price: 15.99, desc: 'Soft cotton tee with a lightning print.' },
    { id: 5, name: 'Fleece Jacket', price: 49.99, desc: 'Warm mid-layer for cold mornings.' },
    { id: 2, name: 'Baby Onesie', price: 7.99, desc: 'Comfortable onesie for the smallest testers.' },
    { id: 3, name: 'Red Hoodie', price: 25.0, desc: 'Bright hoodie with a front pocket.' },
  ];
  function cart() {
    try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch (e) { return []; }
  }
  function saveCart(c) { localStorage.setItem('cart', JSON.stringify(c)); }
  function money(n) { return '$' + n.toFixed(2); }
  function updateBadge() {
    var b = document.querySelector('[data-testid="cart-badge"]');
    if (!b) return;
    var n = cart().length;
    b.textContent = String(n);
    b.hidden = n === 0;
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 4000);
  }
  function spinner(on) {
    var s = document.querySelector('.loading-spinner');
    if (s) s.hidden = !on;
  }
  window.shop = { PRODUCTS: PRODUCTS, cart: cart, saveCart: saveCart, money: money, updateBadge: updateBadge, toast: toast, spinner: spinner };

  window.renderInventory = function () {
    var list = document.getElementById('inventory');
    var sort = document.getElementById('sort');
    var items = PRODUCTS.slice();
    if (sort && sort.value === 'price') items.sort(function (a, b) { return a.price - b.price; });
    else items.sort(function (a, b) { return a.name.localeCompare(b.name); });
    list.innerHTML = '';
    items.forEach(function (p) {
      var inCart = cart().indexOf(p.id) !== -1;
      var li = document.createElement('li');
      li.className = 'inventory-item';
      li.innerHTML =
        '<img class="item-img" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="' + p.name + ' photo" width="60" height="60">' +
        '<div class="item-body"><h2 class="item-name"><a href="item.html?id=' + p.id + '">' + p.name + '</a></h2>' +
        '<p class="item-desc">' + p.desc + '</p>' +
        '<div class="pricebar"><span class="item-price">' + money(p.price) + '</span>' +
        '<button class="btn btn-' + (inCart ? 'remove' : 'add') + '" type="button">' + (inCart ? 'Remove' : 'Add to cart') + '</button></div></div>';
      li.querySelector('button').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        spinner(true);
        fetch('/api/cart/toggle?id=' + p.id).then(function (r) { return r.json(); }).then(function () {
          var c = cart();
          var i = c.indexOf(p.id);
          if (i === -1) { c.push(p.id); toast('Added ' + p.name + ' to your cart'); }
          else { c.splice(i, 1); toast('Removed ' + p.name + ' from your cart'); }
          saveCart(c);
          spinner(false);
          updateBadge();
          renderInventory();
        });
      });
      list.appendChild(li);
    });
    updateBadge();
  };

  window.renderCart = function () {
    var body = document.getElementById('cart-rows');
    var c = cart();
    body.innerHTML = '';
    c.forEach(function (id) {
      var p = PRODUCTS.filter(function (x) { return x.id === id; })[0];
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + p.name + '</td><td>1</td><td>' + money(p.price) + '</td><td><button type="button" class="btn">Remove</button></td>';
      tr.querySelector('button').addEventListener('click', function () {
        var cc = cart();
        cc.splice(cc.indexOf(id), 1);
        saveCart(cc);
        renderCart();
      });
      body.appendChild(tr);
    });
    var empty = document.getElementById('empty');
    if (empty) empty.hidden = c.length > 0;
    var total = c.reduce(function (s, id) { return s + PRODUCTS.filter(function (x) { return x.id === id; })[0].price; }, 0);
    var tot = document.getElementById('total');
    if (tot) tot.textContent = 'Total: ' + money(total);
    updateBadge();
  };
})();
