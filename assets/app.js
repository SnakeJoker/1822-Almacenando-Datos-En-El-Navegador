const state = {
  user: null,
  config: null,
  assets: [],
  ledger: [],
  inventoryPage: 1,
  ledgerPage: 1,
  inventoryPageSize: 5,
  ledgerPageSize: 7,
  searchTerm: '',
  ledgerFilter: 'ALL'
};

const dom = {
  views: {
    login: document.getElementById('loginView'),
    dashboard: document.getElementById('dashboardView'),
    inventory: document.getElementById('inventoryView'),
    ledger: document.getElementById('ledgerView')
  },
  navButtons: Array.from(document.querySelectorAll('.nav-btn')),
  protectedNav: document.querySelector('.main-nav[data-view="protected"]'),
  sessionInfo: document.querySelector('.session-info'),
  sessionUser: document.getElementById('sessionUser'),
  logoutBtn: document.getElementById('logoutBtn'),
  loginForm: document.getElementById('loginForm'),
  kpi: {
    totalBalance: document.getElementById('kpiTotalBalance'),
    activeSkus: document.getElementById('kpiActiveSkus'),
    lastMovement: document.getElementById('kpiLastMovement')
  },
  recentMovements: document.getElementById('recentMovements'),
  inventorySearch: document.getElementById('inventorySearch'),
  inventoryBody: document.getElementById('inventoryBody'),
  inventoryPagination: document.getElementById('inventoryPagination'),
  ledgerBody: document.getElementById('ledgerBody'),
  ledgerPagination: document.getElementById('ledgerPagination'),
  ledgerSkuFilter: document.getElementById('ledgerSkuFilter'),
  spinner: document.getElementById('globalSpinner'),
  spinnerCount: document.getElementById('spinnerCount'),
  toastContainer: document.getElementById('toastContainer'),
  dialogHost: document.getElementById('dialogHost')
};

const spinner = (() => {
  let count = 0;
  const timers = new Map();

  function updateVisibility() {
    dom.spinnerCount.textContent = count;
    if (count > 0) {
      dom.spinner.classList.remove('hidden');
    } else {
      dom.spinner.classList.add('hidden');
    }
  }

  function forceReset() {
    timers.forEach((timeout) => clearTimeout(timeout));
    timers.clear();
    count = 0;
    updateVisibility();
  }

  return {
    start() {
      count += 1;
      const token = Symbol('spinner');
      updateVisibility();
      const timeout = setTimeout(() => {
        console.warn('Spinner failsafe activado. Reiniciando contador.');
        forceReset();
      }, 8000);
      timers.set(token, timeout);
      return token;
    },
    stop(token) {
      if (!timers.has(token)) {
        return;
      }
      clearTimeout(timers.get(token));
      timers.delete(token);
      count = Math.max(0, count - 1);
      updateVisibility();
    },
    isActive() {
      return count > 0;
    },
    reset() {
      forceReset();
    }
  };
})();

async function apiFetch(url, options = {}) {
  const { silent = false, ...fetchOptions } = options;
  const token = spinner.start();
  let response;
  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
      ...fetchOptions
    });
  } finally {
    spinner.stop(token);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore json parsing error if no body
  }

  if (!response.ok) {
    const message = data?.error || response.statusText || 'Error inesperado';
    if (!silent) {
      showToast(message, 'error');
    }
    throw new Error(message);
  }

  return data;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<p>${message}</p>`;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 2500);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function setProtectedVisibility(visible) {
  if (visible) {
    dom.protectedNav.classList.add('visible');
    dom.sessionInfo.classList.add('visible');
  } else {
    dom.protectedNav.classList.remove('visible');
    dom.sessionInfo.classList.remove('visible');
  }
}

function switchView(target) {
  Object.entries(dom.views).forEach(([name, element]) => {
    element.classList.toggle('active', name === target);
  });
  dom.navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === target);
  });
}

function formatNumber(value, decimals = 2) {
  return Number(value).toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatTokenAmount(asset, amount) {
  const decimals = typeof asset.decimals === 'number' ? asset.decimals : 0;
  return `${formatNumber(amount, decimals)} ${asset.unit}`;
}

function renderDashboard() {
  const totalBalance = state.assets.reduce((acc, asset) => acc + Number(asset.balance), 0);
  dom.kpi.totalBalance.textContent = formatNumber(totalBalance, 2);
  dom.kpi.activeSkus.textContent = state.assets.length;

  const sortedLedger = [...state.ledger].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (sortedLedger.length > 0) {
    const latest = sortedLedger[0];
    dom.kpi.lastMovement.textContent = `${new Date(latest.timestamp).toLocaleString('es-ES')} · ${latest.type.toUpperCase()}`;
  } else {
    dom.kpi.lastMovement.textContent = 'Sin movimientos';
  }

  dom.recentMovements.innerHTML = '';
  sortedLedger.slice(0, 5).forEach((entry) => {
    const asset = state.assets.find((a) => a.sku === entry.sku);
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${entry.sku}</strong>
        <p>${asset ? asset.name : 'Activo desconocido'}</p>
      </div>
      <div class="text-right">
        <span class="badge ${entry.type}">${entry.type}</span>
        <p>${formatTokenAmount(asset || { unit: 'tokens', decimals: 2 }, entry.amount)}</p>
      </div>
    `;
    dom.recentMovements.appendChild(li);
  });
}

function paginate(items, page, perPage) {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * perPage;
  const end = start + perPage;
  return {
    items: items.slice(start, end),
    totalPages,
    currentPage
  };
}

function renderPagination(container, totalPages, currentPage, onChange) {
  container.innerHTML = '';
  if (totalPages <= 1) {
    return;
  }
  for (let page = 1; page <= totalPages; page += 1) {
    const button = document.createElement('button');
    button.className = `page-btn ${page === currentPage ? 'active' : ''}`;
    button.textContent = page;
    button.addEventListener('click', () => onChange(page));
    container.appendChild(button);
  }
}

function renderInventory() {
  const term = state.searchTerm.trim().toLowerCase();
  const filtered = state.assets.filter((asset) => {
    if (!term) return true;
    return asset.sku.toLowerCase().includes(term) || asset.name.toLowerCase().includes(term);
  });

  const { items, totalPages, currentPage } = paginate(filtered, state.inventoryPage, state.inventoryPageSize);
  state.inventoryPage = currentPage;

  dom.inventoryBody.innerHTML = '';
  items.forEach((asset) => {
    const row = document.createElement('tr');
    const effectiveLimit = Math.min(
      state.config.globalMaxWithdrawalPerSKU ?? Infinity,
      asset.maxWithdrawal ?? Infinity
    );
    const limitText = isFinite(effectiveLimit)
      ? `${formatNumber(effectiveLimit, asset.decimals ?? 0)} ${asset.unit}`
      : 'Sin límite';
    const decimalsInfo = asset.decimals ? `${asset.decimals} decimales` : 'Enteros';

    const depositDisabled = state.config && !state.config.depositsEnabled;

    row.innerHTML = `
      <td><strong>${asset.sku}</strong><br><span class="muted">${asset.unit}</span></td>
      <td>${asset.name}</td>
      <td>${formatTokenAmount(asset, asset.balance)}</td>
      <td>
        <div>${limitText}</div>
        <small class="muted">${decimalsInfo}</small>
      </td>
      <td>
        <div class="table-actions">
          <button class="action-btn" data-action="withdraw" data-sku="${asset.sku}">Retirar</button>
          <button class="action-btn" data-action="deposit" data-sku="${asset.sku}" title="${depositDisabled ? 'Los depósitos están deshabilitados por configuración' : 'Registrar depósito'}" ${depositDisabled ? 'disabled' : ''}>
            Depositar
            ${depositDisabled ? '<span class="tooltip">Deshabilitado por configuración</span>' : ''}
          </button>
        </div>
      </td>
    `;
    dom.inventoryBody.appendChild(row);
  });

  renderPagination(dom.inventoryPagination, totalPages, currentPage, (page) => {
    state.inventoryPage = page;
    renderInventory();
  });
}

function renderLedger() {
  const skuFilter = state.ledgerFilter;
  const filtered = state.ledger
    .filter((entry) => (skuFilter === 'ALL' ? true : entry.sku === skuFilter))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const { items, totalPages, currentPage } = paginate(filtered, state.ledgerPage, state.ledgerPageSize);
  state.ledgerPage = currentPage;

  dom.ledgerBody.innerHTML = '';
  items.forEach((entry) => {
    const asset = state.assets.find((a) => a.sku === entry.sku) || { unit: 'tokens', decimals: 2 };
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(entry.timestamp).toLocaleString('es-ES')}</td>
      <td>${entry.sku}</td>
      <td><span class="badge ${entry.type}">${entry.type}</span></td>
      <td>${formatTokenAmount(asset, entry.amount)}</td>
      <td>${formatTokenAmount(asset, entry.balanceAfter)}</td>
      <td>${entry.note || ''}</td>
    `;
    dom.ledgerBody.appendChild(row);
  });

  renderPagination(dom.ledgerPagination, totalPages, currentPage, (page) => {
    state.ledgerPage = page;
    renderLedger();
  });
}

function refreshLedgerFilterOptions() {
  dom.ledgerSkuFilter.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = 'ALL';
  allOption.textContent = 'Todos los SKUs';
  dom.ledgerSkuFilter.appendChild(allOption);
  state.assets.forEach((asset) => {
    const option = document.createElement('option');
    option.value = asset.sku;
    option.textContent = `${asset.sku} · ${asset.name}`;
    dom.ledgerSkuFilter.appendChild(option);
  });
  dom.ledgerSkuFilter.value = state.ledgerFilter;
}

async function performWithdraw(asset) {
  try {
    const amount = await openAmountDialog('withdraw', asset);
    if (!amount) {
      return;
    }
    const payload = { sku: asset.sku, amount };
    const data = await apiFetch('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    applyAssetUpdate(data.asset);
    appendLedgerEntry(data.entry);
    showToast('Retiro aplicado correctamente.', 'success');
    renderAll();
  } catch (error) {
    if (error?.message) {
      showToast(error.message, 'error');
    }
  }
}

async function performDeposit(asset) {
  try {
    const amount = await openAmountDialog('deposit', asset);
    if (!amount) {
      return;
    }
    await apiFetch('/api/deposit', {
      method: 'POST',
      body: JSON.stringify({ sku: asset.sku, amount })
    });
    showToast('Depósito aplicado.', 'success');
  } catch (error) {
    if (error?.message) {
      showToast(error.message, 'error');
    }
  }
}

function applyAssetUpdate(updated) {
  state.assets = state.assets.map((asset) => (asset.sku === updated.sku ? updated : asset));
}

function appendLedgerEntry(entry) {
  state.ledger.push(entry);
}

async function openAmountDialog(action, asset) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    const title = action === 'withdraw' ? 'Retirar tokens' : 'Depositar tokens';
    const actionLabel = action === 'withdraw' ? 'Retirar' : 'Depositar';
    const decimals = asset.decimals ?? 0;
    const step = decimals > 0 ? (1 / Math.pow(10, decimals)).toFixed(decimals) : '1';

    dialog.innerHTML = `
      <h3>${title}</h3>
      <p class="muted">${asset.sku} · ${asset.name}</p>
      <label>Monto (${asset.unit})
        <input type="number" min="${step}" step="${step}" value="" placeholder="0">
      </label>
      <div class="dialog-actions">
        <button class="secondary-btn" data-role="cancel">Cancelar</button>
        <button class="primary-btn" data-role="confirm">${actionLabel}</button>
      </div>
    `;

    const input = dialog.querySelector('input');

    const escListener = (event) => {
      if (event.key === 'Escape') {
        cleanup(null);
      }
    };

    const cleanup = (result) => {
      document.removeEventListener('keydown', escListener);
      backdrop.remove();
      resolve(result);
    };

    dialog.addEventListener('submit', (event) => event.preventDefault());
    dialog.querySelector('[data-role="cancel"]').addEventListener('click', () => cleanup(null));
    dialog.querySelector('[data-role="confirm"]').addEventListener('click', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0) {
        showToast('Ingresa un monto válido.', 'error');
        return;
      }
      cleanup(value);
    });

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        cleanup(null);
      }
    });

    document.addEventListener('keydown', escListener);

    backdrop.appendChild(dialog);
    dom.dialogHost.appendChild(backdrop);
    setTimeout(() => input.focus(), 50);
  });
}

function attachEventListeners() {
  dom.navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.target;
      switchView(target);
      if (target === 'inventory') {
        renderInventory();
      }
      if (target === 'ledger') {
        renderLedger();
      }
    });
  });

  dom.inventoryBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const asset = state.assets.find((item) => item.sku === button.dataset.sku);
    if (!asset) return;
    if (button.dataset.action === 'withdraw') {
      performWithdraw(asset);
    } else if (button.dataset.action === 'deposit') {
      if (button.disabled) {
        showToast('Los depósitos están deshabilitados.', 'error');
        return;
      }
      performDeposit(asset);
    }
  });

  dom.inventorySearch.addEventListener('input', (event) => {
    state.searchTerm = event.target.value;
    state.inventoryPage = 1;
    renderInventory();
  });

  dom.ledgerSkuFilter.addEventListener('change', (event) => {
    state.ledgerFilter = event.target.value;
    state.ledgerPage = 1;
    renderLedger();
  });

  dom.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(dom.loginForm);
    const credentials = Object.fromEntries(formData.entries());
    try {
      const { user } = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      state.user = user;
      dom.sessionUser.textContent = `${user.name} (${user.role})`;
      setProtectedVisibility(true);
      await bootstrapData();
      dom.loginForm.reset();
      switchView('dashboard');
      renderAll();
      showToast('Bienvenido al panel de inventario.', 'success');
    } catch (error) {
      if (error?.message) {
        showToast(error.message, 'error');
      }
    }
  });

  dom.logoutBtn.addEventListener('click', () => {
    state.user = null;
    state.config = null;
    state.assets = [];
    state.ledger = [];
    dom.sessionUser.textContent = '';
    setProtectedVisibility(false);
    switchView('login');
  });
}

async function bootstrapData() {
  const [config, assets, ledger] = await Promise.all([
    apiFetch('/api/config'),
    apiFetch('/api/assets'),
    apiFetch('/api/ledger')
  ]);
  state.config = config;
  state.assets = assets;
  state.ledger = ledger;
  refreshLedgerFilterOptions();
}

function renderAll() {
  renderDashboard();
  renderInventory();
  refreshLedgerFilterOptions();
  renderLedger();
}

window.addEventListener('unhandledrejection', (event) => {
  showToast(event.reason?.message || 'Error no controlado', 'error');
  if (spinner.isActive()) {
    console.warn('Unhandled rejection detectada. Ocultando spinner.');
    spinner.reset();
  }
});

async function runSelfTests() {
  const results = [];
  const log = (name, passed, details = '') => {
    const status = passed ? '✅' : '❌';
    console.log(`[SelfTest] ${status} ${name}${details ? ` → ${details}` : ''}`);
  };

  // Reset state before testing
  await apiFetch('/api/reset', { method: 'POST', silent: true }).catch(() => {});

  try {
    const successLogin = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
      silent: true
    });
    results.push(successLogin?.user?.username === 'admin');
    log('Login correcto', successLogin?.user?.username === 'admin');
  } catch (error) {
    results.push(false);
    log('Login correcto', false, error.message);
  }

  try {
    await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'incorrecto' }),
      silent: true
    });
    results.push(false);
    log('Login incorrecto', false, 'Debió fallar');
  } catch (error) {
    results.push(true);
    log('Login incorrecto', true);
  }

  await apiFetch('/api/reset', { method: 'POST', silent: true }).catch(() => {});

  try {
    const assets = await apiFetch('/api/assets', { silent: true });
    const config = await apiFetch('/api/config', { silent: true });
    const testAsset = assets.find((item) => item.maxWithdrawal && item.maxWithdrawal < (config.globalMaxWithdrawalPerSKU ?? Infinity)) || assets[0];
    const limit = Math.min(config.globalMaxWithdrawalPerSKU ?? Infinity, testAsset.maxWithdrawal ?? Infinity);
    const excessive = (Number.isFinite(limit) ? limit + (limit > 1 ? 1 : 0.5) : (testAsset.balance + 1));
    await apiFetch('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({ sku: testAsset.sku, amount: excessive }),
      silent: true
    });
    results.push(false);
    log('Retiro respeta límites', false, 'Se esperaba error por límite');
  } catch (error) {
    results.push(true);
    log('Retiro respeta límites', true);
  }

  await apiFetch('/api/reset', { method: 'POST', silent: true }).catch(() => {});

  try {
    const assets = await apiFetch('/api/assets', { silent: true });
    const decimalAsset = assets.find((item) => (item.decimals ?? 0) > 0) || assets[0];
    const allowedAmount = Number((1 / Math.pow(10, decimalAsset.decimals ?? 0)).toFixed(decimalAsset.decimals ?? 0));
    await apiFetch('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({ sku: decimalAsset.sku, amount: allowedAmount }),
      silent: true
    });
    await apiFetch('/api/reset', { method: 'POST', silent: true }).catch(() => {});
    results.push(true);
    log('Retiro con decimales permitidos', true);
  } catch (error) {
    results.push(false);
    log('Retiro con decimales permitidos', false, error.message);
  }

  try {
    const assets = await apiFetch('/api/assets', { silent: true });
    const decimalAsset = assets.find((item) => (item.decimals ?? 0) >= 0) || assets[0];
    const disallowedAmount = Number((1 / Math.pow(10, (decimalAsset.decimals ?? 0) + 2)).toFixed((decimalAsset.decimals ?? 0) + 2));
    await apiFetch('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({ sku: decimalAsset.sku, amount: disallowedAmount }),
      silent: true
    });
    results.push(false);
    log('Retiro con decimales no permitidos', false, 'Se esperaba error');
  } catch (error) {
    results.push(true);
    log('Retiro con decimales no permitidos', true);
  }

  await apiFetch('/api/reset', { method: 'POST', silent: true }).catch(() => {});

  try {
    const assets = await apiFetch('/api/assets', { silent: true });
    const asset = assets[0];
    await apiFetch('/api/deposit', {
      method: 'POST',
      body: JSON.stringify({ sku: asset.sku, amount: 10 }),
      silent: true
    });
    results.push(false);
    log('Depósito deshabilitado devuelve error', false, 'Se esperaba error');
  } catch (error) {
    results.push(true);
    log('Depósito deshabilitado devuelve error', true);
  }

  let spinnerCleared = false;
  try {
    const promises = [
      apiFetch('/api/assets', { silent: true }),
      apiFetch('/api/ledger', { silent: true })
    ];
    await Promise.allSettled(promises);
    spinnerCleared = !spinner.isActive();
    results.push(spinnerCleared);
    log('Spinner se libera tras operaciones concurrentes', spinnerCleared);
  } catch (error) {
    results.push(false);
    log('Spinner se libera tras operaciones concurrentes', false, error.message);
  }

  return results.every(Boolean);
}

window.runSelfTests = runSelfTests;

async function init() {
  attachEventListeners();
  switchView('login');
  setProtectedVisibility(false);

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.info('Service Worker registrado.');
    } catch (error) {
      console.error('No se pudo registrar el Service Worker', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
