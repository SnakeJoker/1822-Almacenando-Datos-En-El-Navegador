const DATA_SOURCES = {
  users: '/data/users.json',
  assets: '/data/assets.json',
  ledger: '/data/ledger.json',
  config: '/data/config.json'
};

const clone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

let memory = {
  users: [],
  assets: [],
  ledger: [],
  config: {}
};

let pristine = {
  users: [],
  assets: [],
  ledger: [],
  config: {}
};

async function loadInitialData() {
  const [users, assets, ledger, config] = await Promise.all([
    fetch(DATA_SOURCES.users).then((res) => res.json()),
    fetch(DATA_SOURCES.assets).then((res) => res.json()),
    fetch(DATA_SOURCES.ledger).then((res) => res.json()),
    fetch(DATA_SOURCES.config).then((res) => res.json())
  ]);

  pristine = {
    users,
    assets,
    ledger,
    config
  };

  memory = {
    users: clone(users),
    assets: clone(assets),
    ledger: clone(ledger),
    config: clone(config)
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(loadInitialData());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await loadInitialData();
    await self.clients.claim();
  })());
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function findUser(username, password) {
  return memory.users.find((user) => user.username === username && user.password === password);
}

function findAsset(sku) {
  return memory.assets.find((asset) => asset.sku === sku);
}

function clampDecimals(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function decimalsCount(amount) {
  const [, decimals = ''] = String(amount).split('.');
  return decimals.length;
}

function effectiveWithdrawalLimit(asset) {
  const globalLimit = memory.config.globalMaxWithdrawalPerSKU ?? Infinity;
  const assetLimit = asset.maxWithdrawal ?? Infinity;
  return Math.min(globalLimit, assetLimit);
}

async function handleLogin(request) {
  const payload = await request.json();
  const { username, password } = payload;
  const user = findUser(username, password);
  if (!user) {
    return jsonResponse({ error: 'Credenciales inválidas.' }, 401);
  }
  const { password: _omit, ...safeUser } = user;
  return jsonResponse({ user: safeUser });
}

async function handleWithdraw(request) {
  const payload = await request.json();
  const sku = payload?.sku;
  const amount = Number(payload?.amount);
  if (!sku) {
    return jsonResponse({ error: 'SKU requerido.' }, 400);
  }
  const asset = findAsset(sku);
  if (!asset) {
    return jsonResponse({ error: 'SKU inexistente.' }, 404);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({ error: 'Monto inválido.' }, 400);
  }
  const decimalsAllowed = asset.decimals ?? 0;
  if (decimalsCount(payload.amount) > decimalsAllowed) {
    return jsonResponse({ error: `Este SKU solo permite ${decimalsAllowed} decimales.` }, 400);
  }

  const limit = effectiveWithdrawalLimit(asset);
  if (amount > limit) {
    return jsonResponse({ error: `El retiro supera el límite permitido (${limit}).` }, 400);
  }

  if (amount > asset.balance) {
    return jsonResponse({ error: 'Saldo insuficiente para el retiro solicitado.' }, 400);
  }

  const newBalance = clampDecimals(asset.balance - amount, decimalsAllowed);
  asset.balance = newBalance;
  const entry = {
    id: crypto.randomUUID(),
    sku: asset.sku,
    type: 'withdraw',
    amount,
    balanceAfter: newBalance,
    timestamp: new Date().toISOString(),
    note: `Retiro procesado por ${amount}`
  };
  memory.ledger.push(entry);

  return jsonResponse({ asset, entry });
}

async function handleDeposit(request) {
  if (!memory.config.depositsEnabled) {
    return jsonResponse({ error: 'Los depósitos están deshabilitados por configuración.' }, 403);
  }
  const payload = await request.json();
  const sku = payload?.sku;
  const amount = Number(payload?.amount);
  if (!sku) {
    return jsonResponse({ error: 'SKU requerido.' }, 400);
  }
  const asset = findAsset(sku);
  if (!asset) {
    return jsonResponse({ error: 'SKU inexistente.' }, 404);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({ error: 'Monto inválido.' }, 400);
  }
  const decimalsAllowed = asset.decimals ?? 0;
  if (decimalsCount(payload.amount) > decimalsAllowed) {
    return jsonResponse({ error: `Este SKU solo permite ${decimalsAllowed} decimales.` }, 400);
  }

  const newBalance = clampDecimals(asset.balance + amount, decimalsAllowed);
  asset.balance = newBalance;
  const entry = {
    id: crypto.randomUUID(),
    sku: asset.sku,
    type: 'deposit',
    amount,
    balanceAfter: newBalance,
    timestamp: new Date().toISOString(),
    note: `Depósito procesado por ${amount}`
  };
  memory.ledger.push(entry);

  return jsonResponse({ asset, entry });
}

async function handleReset() {
  memory = {
    users: clone(pristine.users),
    assets: clone(pristine.assets),
    ledger: clone(pristine.ledger),
    config: clone(pristine.config)
  };
  return jsonResponse({ ok: true });
}

async function handleApiRequest(url, request) {
  const { pathname } = url;
  try {
    if (pathname === '/api/login' && request.method === 'POST') {
      return await handleLogin(request);
    }
    if (pathname === '/api/config' && request.method === 'GET') {
      return jsonResponse(memory.config);
    }
    if (pathname === '/api/assets' && request.method === 'GET') {
      return jsonResponse(memory.assets);
    }
    if (pathname === '/api/ledger' && request.method === 'GET') {
      return jsonResponse(memory.ledger);
    }
    if (pathname === '/api/withdraw' && request.method === 'POST') {
      return await handleWithdraw(request);
    }
    if (pathname === '/api/deposit' && request.method === 'POST') {
      return await handleDeposit(request);
    }
    if (pathname === '/api/reset' && request.method === 'POST') {
      return await handleReset();
    }
    return jsonResponse({ error: 'Ruta no encontrada.' }, 404);
  } catch (error) {
    console.error('Error manejando API', error);
    return jsonResponse({ error: 'Error interno en el servicio simulado.' }, 500);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(url, event.request));
  }
});
