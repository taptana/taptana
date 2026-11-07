// Prototipo de ejemplo. Carrito en localStorage, sin servidor, sin nada real.
(function () {
  const PRODUCTS = [
    { id: 'monstera', name: 'Monstera deliciosa', price: 89, tags: ['interior', 'grande'], emoji: '🌿', color: '#dcebd8', description: 'La clásica de hojas grandes y agujereadas. Crece rápido con buena luz.' },
    { id: 'pothos', name: 'Pothos dorado', price: 35, tags: ['interior'], emoji: '🍃', color: '#e6efd9', description: 'Casi indestructible. Ideal para estantes y colgantes.' },
    { id: 'echeveria', name: 'Echeveria', price: 22, tags: ['suculenta'], emoji: '🪴', color: '#e8e4d6', description: 'Roseta compacta. Mucho sol, poca agua.' },
    { id: 'sansevieria', name: 'Lengua de suegra', price: 58, tags: ['interior', 'grande'], emoji: '🌱', color: '#d9e9e1', description: 'Purifica el aire y aguanta semanas sin riego.' },
    { id: 'aloe', name: 'Aloe vera', price: 28, tags: ['suculenta'], emoji: '🌵', color: '#e4ecd4', description: 'Útil y decorativa. Sol directo y riego escaso.' },
    { id: 'ficus', name: 'Ficus lyrata', price: 149, tags: ['interior', 'grande'], emoji: '🌳', color: '#d8e6d4', description: 'Hojas en forma de violín. Protagonista de cualquier sala.' },
  ];
  const SIZE_FACTOR = { S: 1, M: 1.6, L: 2.4 };
  const SIZE_LABEL = { S: 'Pequeña', M: 'Mediana', L: 'Grande' };

  const money = (n) => 'S/ ' + Math.round(n);
  const readCart = () => { try { return JSON.parse(localStorage.getItem('verde:cart') || '[]'); } catch { return []; } };
  const writeCart = (cart) => { localStorage.setItem('verde:cart', JSON.stringify(cart)); renderCount(); };
  const renderCount = () => {
    const n = readCart().reduce((a, i) => a + i.qty, 0);
    document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = String(n); });
  };
  renderCount();

  // ── Home ───────────────────────────────────────────────────────────
  const grid = document.getElementById('productos');
  if (grid) {
    const render = (filter) => {
      grid.innerHTML = PRODUCTS
        .filter((p) => filter === 'todas' || p.tags.includes(filter))
        .map((p) => `
          <a class="card" href="producto.html?id=${p.id}" data-product="${p.id}">
            <div class="thumb" style="background:${p.color}">${p.emoji}</div>
            <div class="body"><p class="name">${p.name}</p><p class="price">${money(p.price)}</p></div>
          </a>`).join('');
    };
    render('todas');
    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        render(chip.dataset.filter);
      });
    });
  }

  // ── Producto ───────────────────────────────────────────────────────
  const productEl = document.getElementById('producto');
  if (productEl) {
    const id = new URLSearchParams(location.search).get('id');
    const product = PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];
    let size = 'S';
    const priceEl = productEl.querySelector('[data-price]');
    const updatePrice = () => { priceEl.textContent = money(product.price * SIZE_FACTOR[size]); };
    productEl.querySelector('[data-name]').textContent = product.name;
    productEl.querySelector('[data-description]').textContent = product.description;
    document.title = product.name + ' · Verde';
    updatePrice();
    productEl.querySelectorAll('.slide').forEach((s) => { s.style.background = s.dataset.color; s.textContent = product.emoji; });

    const track = productEl.querySelector('.gallery-track');
    const dots = productEl.querySelectorAll('.dots span');
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, j) => d.classList.toggle('is-active', i === j));
    }, { passive: true });

    productEl.querySelectorAll('.option').forEach((btn) => {
      btn.addEventListener('click', () => {
        productEl.querySelectorAll('.option').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        size = btn.dataset.size;
        updatePrice();
      });
    });

    document.getElementById('agregar').addEventListener('click', () => {
      const cart = readCart();
      const key = product.id + ':' + size;
      const existing = cart.find((i) => i.key === key);
      if (existing) existing.qty += 1;
      else cart.push({ key, id: product.id, size, qty: 1 });
      writeCart(cart);
      location.href = 'carrito.html';
    });
  }

  // ── Carrito ────────────────────────────────────────────────────────
  const itemsEl = document.getElementById('items');
  if (itemsEl) {
    const render = () => {
      const cart = readCart();
      document.getElementById('vacio').hidden = cart.length > 0;
      document.getElementById('resumen').hidden = cart.length === 0;
      document.getElementById('form-envio').hidden = cart.length === 0;
      document.querySelector('.sticky-bar').hidden = cart.length === 0;
      let subtotal = 0;
      itemsEl.innerHTML = cart.map((item) => {
        const p = PRODUCTS.find((x) => x.id === item.id);
        const unit = p.price * SIZE_FACTOR[item.size];
        subtotal += unit * item.qty;
        return `
          <div class="item" data-key="${item.key}">
            <div class="thumb" style="background:${p.color}">${p.emoji}</div>
            <div><p class="name">${p.name}</p><p class="meta">${SIZE_LABEL[item.size]} · ${money(unit)}</p></div>
            <div class="qty">
              <button type="button" data-dec aria-label="Quitar uno">−</button>
              <span>${item.qty}</span>
              <button type="button" data-inc aria-label="Agregar uno">+</button>
            </div>
          </div>`;
      }).join('');
      const envio = subtotal >= 80 || subtotal === 0 ? 0 : 12;
      document.querySelector('[data-subtotal]').textContent = money(subtotal);
      document.querySelector('[data-envio]').textContent = envio ? money(envio) : 'Gratis';
      document.querySelector('[data-total]').textContent = money(subtotal + envio);
    };
    render();
    itemsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const key = btn.closest('.item').dataset.key;
      const cart = readCart();
      const item = cart.find((i) => i.key === key);
      if (btn.hasAttribute('data-inc')) item.qty += 1;
      if (btn.hasAttribute('data-dec')) item.qty -= 1;
      writeCart(cart.filter((i) => i.qty > 0));
      render();
    });

    document.getElementById('form-envio').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      let valid = true;
      form.querySelectorAll('[required]').forEach((field) => {
        const ok = field.type === 'checkbox' ? field.checked : field.value.trim().length > 0;
        field.classList.toggle('is-invalid', !ok);
        if (!ok) valid = false;
      });
      document.getElementById('error').hidden = valid;
      if (!valid) return;
      localStorage.setItem('verde:order', String(1000 + Math.floor(Math.random() * 9000)));
      writeCart([]);
      location.href = 'gracias.html';
    });
  }

  // ── Gracias ────────────────────────────────────────────────────────
  const orderEl = document.querySelector('[data-order]');
  if (orderEl) orderEl.textContent = '#' + (localStorage.getItem('verde:order') || '1234');
})();
