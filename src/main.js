import { createClient } from '@supabase/supabase-js';
import './styles.css';

const app = document.querySelector('#app');
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const state = {
  session: null,
  profile: null,
  passwordRecovery: false,
  page: 'dashboard',
  orders: [],
  customers: [],
  profiles: [],
  search: '',
  status: '',
  toastTimer: null
};

const statusOptions = [
  'Falta diagnóstico',
  'En taller',
  'En reparación',
  'Pendiente a entregar',
  'Entregado'
];
const customerTypeOptions = ['VIP', 'Frecuente', 'Regular', 'Nuevo'];

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

const isAdmin = () => state.profile?.role === 'admin';
const normalized = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('es');

function showToast(message, type = 'success') {
  clearTimeout(state.toastTimer);
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.append(toast);
  state.toastTimer = setTimeout(() => toast.remove(), 4800);
}

function errorMessage(error) {
  return error?.message || 'Ocurrió un error inesperado. Inténtalo otra vez.';
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function money(value) {
  return new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: 'BOB',
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function badgeClass(value) {
  const status = normalized(value);
  if (status.includes('entregado') || status.includes('cancel')) return 'badge badge-green';
  if (status.includes('reparacion') || status.includes('trabaj')) return 'badge badge-blue';
  if (status.includes('pendiente')) return 'badge badge-amber';
  return 'badge badge-gray';
}

function setBusy(button, busy, label = 'Guardando…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function renderConfigError() {
  app.innerHTML = `
    <main class="setup-screen">
      <section class="setup-card">
        <div class="brand-mark">AVM</div>
        <p class="eyebrow">Control de taller</p>
        <h1>Falta conectar la base de datos</h1>
        <p>Configura las variables <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> local o en Netlify.</p>
        <p>Luego aplica el esquema de <code>supabase/schema.sql</code> en tu proyecto Supabase. Consulta <code>README.md</code> para los pasos.</p>
      </section>
    </main>`;
}

function renderLogin(message = '') {
  app.innerHTML = `
    <main class="login-layout">
      <section class="login-brand">
        <div class="brand-mark">AVM</div>
        <p class="eyebrow">Taller · Control operativo</p>
        <h1>Cada moto,<br />bajo control.</h1>
        <p>Órdenes, clientes y avances del taller desde cualquier lugar.</p>
        <div class="login-decoration"><span></span><span></span><span></span></div>
      </section>
      <section class="login-panel">
        <form id="login-form" class="login-card">
          <p class="eyebrow">Acceso seguro</p>
          <h2>Iniciar sesión</h2>
          <p class="muted">Ingresa con la cuenta que te habilitó el Administrador.</p>
          ${message ? `<div class="alert alert-error">${esc(message)}</div>` : ''}
          <label>Correo electrónico<input name="email" type="email" autocomplete="username" required /></label>
          <label>Contraseña<input name="password" type="password" autocomplete="current-password" required /></label>
          <button class="button button-primary button-wide" type="submit">Ingresar</button>
          <button class="text-button" type="button" data-action="forgot-password">¿Olvidaste tu contraseña? Contacta al Administrador.</button>
        </form>
      </section>
    </main>`;
}

function renderPasswordRecovery() {
  app.innerHTML = `
    <main class="setup-screen">
      <form id="recovery-form" class="login-card setup-card">
        <p class="eyebrow">Acceso seguro</p>
        <h1>Crear contraseña nueva</h1>
        <p>Elige una contraseña de al menos 8 caracteres para volver a ingresar.</p>
        <label>Nueva contraseña<input name="password" type="password" minlength="8" autocomplete="new-password" required /></label>
        <label>Repetir contraseña<input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required /></label>
        <button class="button button-primary button-wide" type="submit">Guardar contraseña</button>
      </form>
    </main>`;
}

function pageTitle() {
  return ({
    dashboard: ['Resumen', 'Lo que sucede hoy en el taller.'],
    orders: ['Órdenes de trabajo', isAdmin() ? 'Administra cada ingreso y avance.' : 'Las órdenes asignadas a tu cuenta.'],
    customers: ['Directorio de clientes', isAdmin() ? 'Historial y datos de contacto.' : 'Clientes de tus órdenes asignadas.'],
    team: ['Equipo', 'Cuentas y responsabilidades del taller.'],
    import: ['Importar Excel', 'Carga las dos pestañas del archivo de control.']
  })[state.page] || ['Resumen', ''];
}

function renderShell() {
  const [title, subtitle] = pageTitle();
  const initials = (state.profile?.display_name || state.session.user.email || 'U')
    .split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const nav = [
    ['dashboard', '◫', 'Resumen'],
    ['orders', '▤', 'Órdenes'],
    ['customers', '♙', 'Clientes'],
    ...(isAdmin() ? [['team', '♧', 'Equipo'], ['import', '⇧', 'Importar Excel']] : [])
  ];

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#" data-page="dashboard"><span class="brand-mark">AVM</span><span><b>AVM Taller</b><small>Control de operaciones</small></span></a>
        <div class="nav-caption">MENÚ PRINCIPAL</div>
        <nav class="main-nav" aria-label="Navegación principal">
          ${nav.map(([page, icon, label]) => `<button class="nav-item ${state.page === page ? 'active' : ''}" data-page="${page}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}
        </nav>
        <div class="sidebar-foot">
          <div class="connection"><span class="online-dot"></span> Conexión segura</div>
          <div class="sidebar-user"><span class="avatar">${esc(initials)}</span><span class="user-meta"><b>${esc(state.profile?.display_name || 'Usuario')}</b><small>${isAdmin() ? 'Administrador' : 'Técnico'}</small></span><button class="icon-button" title="Cerrar sesión" data-action="sign-out">↪</button></div>
        </div>
      </aside>
      <main class="main-content">
        <header class="topbar">
          <div><p class="eyebrow">${isAdmin() ? 'ADMINISTRACIÓN' : 'ESPACIO TÉCNICO'}</p><h1>${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div>
          <div class="topbar-actions"><span class="date-chip">${new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date())}</span><button class="icon-button mobile-signout" title="Cerrar sesión" data-action="sign-out">↪</button></div>
        </header>
        <section id="page-content" class="page-content">${renderCurrentPage()}</section>
      </main>
      <nav class="mobile-nav" aria-label="Navegación móvil">
        ${nav.map(([page, icon, label]) => `<button class="${state.page === page ? 'active' : ''}" data-page="${page}"><span>${icon}</span><small>${label}</small></button>`).join('')}
      </nav>
    </div>
    <div id="modal-root"></div>`;
}

function renderCurrentPage() {
  switch (state.page) {
    case 'orders': return renderOrders();
    case 'customers': return renderCustomers();
    case 'team': return renderTeam();
    case 'import': return renderImport();
    default: return renderDashboard();
  }
}

function renderDashboard() {
  const orders = state.orders;
  const count = (matcher) => orders.filter((order) => matcher(normalized(order.status))).length;
  const revenue = orders.reduce((total, order) => total + (Number(order.total_paid) || 0), 0);
  const metrics = [
    ['Órdenes registradas', orders.length, 'en el sistema', 'metric-dark'],
    ['Sin iniciar', count((s) => s.includes('diagnostico') || s.includes('sin iniciar')), 'falta diagnóstico', 'metric-amber'],
    ['En taller', count((s) => s.includes('en taller')), 'pendiente de iniciar trabajo', 'metric-blue'],
    ['En reparación', count((s) => s.includes('reparacion') || s.includes('trabaj')), 'trabajo activo', 'metric-blue'],
    ['Por entregar', count((s) => s.includes('pendiente')), 'pendientes', 'metric-amber'],
    ['Entregadas', count((s) => s.includes('entregado')), 'órdenes completadas', 'metric-green']
  ];
  const recent = [...orders].sort((a, b) => String(b.received_date || '').localeCompare(String(a.received_date || ''))).slice(0, 6);
  return `
    <div class="metric-grid">${metrics.map(([label, number, note, color]) => `<article class="metric-card ${color}"><span>${esc(label)}</span><strong>${number}</strong><small>${esc(note)}</small></article>`).join('')}</div>
    ${isAdmin() ? `<section class="panel revenue-strip"><div><p class="eyebrow">PAGOS REGISTRADOS</p><strong>${money(revenue)}</strong><small>Suma de pagos totales en órdenes visibles</small></div><div class="revenue-mark">Bs</div></section>` : ''}
    <section class="panel">
      <div class="panel-heading"><div><h2>Órdenes recientes</h2><p>Últimos ingresos registrados</p></div><button class="button button-quiet" data-page="orders">Ver todas <span>→</span></button></div>
      ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Orden</th><th>Cliente / Moto</th><th>Ingreso</th><th>Técnico</th><th>Estado</th></tr></thead><tbody>${recent.map(orderRow).join('')}</tbody></table></div>` : emptyState('Aún no hay órdenes registradas.')}
    </section>
    ${isAdmin() ? `<div class="quick-note"><span>✦</span><p><b>Acceso desde cualquier lugar</b><br />Comparte la URL publicada en Netlify con el equipo. Cada usuario verá únicamente la información autorizada para su cuenta.</p></div>` : ''}
  `;
}

function orderRow(order) {
  return `<tr>
    <td><b class="order-number">${esc(order.order_number || '—')}</b></td>
    <td><b>${esc(order.customer_name || 'Cliente sin nombre')}</b><small class="cell-sub">${esc(order.motorcycle || 'Moto no especificada')} · ${esc(order.plate || 'Sin placa')}</small></td>
    <td>${dateLabel(order.received_date)}</td>
    <td>${esc(order.technician_name || 'Sin asignar')}</td>
    <td><span class="${badgeClass(order.status)}">${esc(order.status || 'Sin estado')}</span></td>
    ${isAdmin() ? `<td><button class="icon-button" data-action="edit-order" data-id="${esc(order.id)}" aria-label="Editar orden">✎</button></td>` : ''}
  </tr>`;
}

function emptyState(message) {
  return `<div class="empty-state"><span class="empty-icon">⌁</span><p>${esc(message)}</p></div>`;
}

function renderOrders() {
  const query = normalized(state.search);
  const orders = state.orders.filter((order) => {
    const text = normalized([order.order_number, order.customer_name, order.phone, order.motorcycle, order.plate, order.technician_name].join(' '));
    return (!query || text.includes(query)) && (!state.status || order.status === state.status);
  });
  return `
    <section class="panel">
      <div class="toolbar-row">
        <div class="search-control"><span>⌕</span><input id="order-search" placeholder="Buscar por cliente, moto, placa u orden…" value="${esc(state.search)}" /></div>
        <select id="status-filter" aria-label="Filtrar por estado"><option value="">Todos los estados</option>${[...new Set(state.orders.map((order) => order.status).filter(Boolean))].sort().map((status) => `<option ${status === state.status ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select>
        ${isAdmin() ? `<button class="button button-primary" data-action="new-order">＋ Nueva orden</button>` : ''}
      </div>
      <div class="result-count">${orders.length} ${orders.length === 1 ? 'orden' : 'órdenes'}</div>
      ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>N° O.S.</th><th>Cliente / Moto</th><th>Fecha ingreso</th><th>Técnico</th><th>Estado</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>${orders.map(orderRow).join('')}</tbody></table></div>` : emptyState('No se encontraron órdenes con esos filtros.')}
    </section>`;
}

function renderCustomers() {
  return `<section class="panel">
    <div class="panel-heading"><div><h2>${state.customers.length} clientes</h2><p>${isAdmin() ? 'Directorio importado y clientes relacionados con órdenes.' : 'Solo se muestran clientes vinculados a tus asignaciones.'}</p></div>${isAdmin() ? '<button class="button button-primary" data-action="new-customer">＋ Nuevo cliente</button>' : ''}</div>
    ${state.customers.length ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Celular</th><th>Moto</th><th>Placa</th><th>Última visita</th><th>Tipo</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>${state.customers.map((customer) => `<tr><td><b>${esc(customer.full_name || 'Sin nombre')}</b></td><td>${esc(customer.phone || '—')}</td><td>${esc(customer.motorcycle || '—')}</td><td>${esc(customer.plate || '—')}</td><td>${dateLabel(customer.last_visit)}</td><td>${customer.customer_type ? `<span class="badge badge-gray">${esc(customer.customer_type)}</span>` : '—'}</td>${isAdmin() ? `<td><button class="icon-button" data-action="edit-customer" data-id="${esc(customer.id)}" aria-label="Editar cliente">✎</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : emptyState(isAdmin() ? 'No hay clientes todavía. Agrega uno o importa el Excel.' : 'No hay clientes visibles en tus órdenes asignadas.')}</section>`;
}

function renderTeam() {
  const profiles = state.profiles;
  return `<section class="panel">
    <div class="panel-heading"><div><h2>Cuentas del taller</h2><p>Crea cuentas y asigna sus permisos desde el Administrador.</p></div><button class="button button-primary" data-action="new-user">＋ Crear usuario</button></div>
    ${profiles.length ? `<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th></th></tr></thead><tbody>${profiles.map((profile) => `<tr><td><b>${esc(profile.display_name || 'Sin nombre')}</b></td><td>${esc(profile.email)}</td><td><span class="badge ${profile.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${profile.role === 'admin' ? 'Administrador' : 'Técnico'}</span></td><td><button class="icon-button" data-action="edit-profile" data-id="${esc(profile.id)}" aria-label="Editar perfil">✎</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No hay perfiles registrados.')}</section>
    <div class="quick-note"><span>ⓘ</span><p>La cuenta inicia sesión con su correo y contraseña. El Administrador define la contraseña inicial y puede establecer una nueva cuando sea necesario. No se envían correos.</p></div>`;
}

function renderImport() {
  return `<section class="panel import-panel">
    <div class="import-icon">⇧</div>
    <h2>Carga el archivo de control</h2>
    <p>Selecciona el Excel con las pestañas <b>Control diario</b> y <b>Directorio de Clientes</b>. Se importarán las órdenes y los datos de clientes que tengan nombre o teléfono. Las órdenes existentes del archivo se actualizarán.</p>
    <label class="file-drop" for="workbook-file"><span>＋</span><b>Seleccionar archivo .xlsx</b><small>El archivo se procesa en tu navegador y se envía directamente a tu proyecto Supabase.</small><input id="workbook-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></label>
    <div id="import-status" class="muted"></div>
    <div class="import-warning"><b>Antes de importar</b><span>Confirma que las cuentas técnicas ya existen. El nombre de la columna “TRABAJADO POR” se usa para vincular cada orden con una cuenta cuyo nombre coincida.</span></div>
  </section>`;
}

function openModal(title, body, size = '') {
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><p class="eyebrow">AVM TALLER</p><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" data-action="close-modal" aria-label="Cerrar">×</button></header>${body}</section></div>`;
  root.querySelector('input,select,textarea')?.focus();
}

function orderForm(order = {}) {
  const technicianOptions = state.profiles.filter((profile) => profile.role === 'tecnico')
    .map((profile) => `<option value="${esc(profile.id)}" ${profile.id === order.assigned_to ? 'selected' : ''}>${esc(profile.display_name || profile.email)}</option>`).join('');
  const options = [...new Set([...statusOptions, ...state.orders.map((item) => item.status).filter(Boolean)])];
  return `<form id="order-form" data-id="${esc(order.id || '')}" class="modal-form">
    <div class="form-grid">
      <label>N° de orden<input name="order_number" value="${esc(order.order_number)}" /></label>
      <label>Estado<select name="status">${options.map((status) => `<option ${status === order.status ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select></label>
      <label>Fecha de llegada<input name="received_date" type="date" value="${esc(order.received_date)}" /></label>
      <label>Día<input name="weekday" value="${esc(order.weekday)}" /></label>
      <label>Nombre del cliente<input name="customer_name" value="${esc(order.customer_name)}" /></label>
      <label>Teléfono / WhatsApp<input name="phone" inputmode="tel" value="${esc(order.phone)}" /></label>
      <label>Marca y modelo<input name="motorcycle" value="${esc(order.motorcycle)}" /></label>
      <label>Placa<input name="plate" value="${esc(order.plate)}" /></label>
      <label>Casco<input name="helmet" value="${esc(order.helmet)}" /></label>
      <label>Se encuentra en<input name="location" value="${esc(order.location)}" /></label>
      <label>Técnico asignado<select name="assigned_to"><option value="">Sin asignar</option>${technicianOptions}</select></label>
      <label>Trabajado por<input name="technician_name" value="${esc(order.technician_name)}" /></label>
      <label>Fecha de recojo<input name="pickup_date" type="date" value="${esc(order.pickup_date)}" /></label>
      <label>Repuestos comprados<input name="parts_description" value="${esc(order.parts_description)}" /></label>
      <label>Costo de repuestos (Bs)<input name="parts_cost" type="number" step="0.01" value="${esc(order.parts_cost ?? 0)}" /></label>
      <label>Adelanto (Bs)<input name="advance" type="number" step="0.01" value="${esc(order.advance ?? 0)}" /></label>
      <label>Pago total (Bs)<input name="total_paid" type="number" step="0.01" value="${esc(order.total_paid ?? 0)}" /></label>
      <label>Ganancia neta (Bs)<input name="net_profit" type="number" step="0.01" value="${esc(order.net_profit ?? 0)}" /></label>
      <label>Estado de pago<input name="payment_status" value="${esc(order.payment_status)}" /></label>
      <label class="field-wide">Detalle del arreglo / falla<textarea name="repair_description" rows="3">${esc(order.repair_description)}</textarea></label>
      <label class="field-wide">Observaciones<textarea name="observations" rows="3">${esc(order.observations)}</textarea></label>
    </div>
    <footer class="modal-actions"><button type="button" class="button button-quiet" data-action="close-modal">Cancelar</button><button type="submit" class="button button-primary">Guardar orden</button></footer>
  </form>`;
}

function customerForm(customer = {}) {
  const types = [...new Set([...customerTypeOptions, ...state.customers.map((item) => item.customer_type).filter(Boolean)])];
  return `<form id="customer-form" data-id="${esc(customer.id || '')}" class="modal-form">
    <div class="form-grid">
      <label>N° de cliente<input name="legacy_customer_number" value="${esc(customer.legacy_customer_number)}" /></label>
      <label>Nombre completo<input name="full_name" required value="${esc(customer.full_name)}" /></label>
      <label>Celular / WhatsApp<input name="phone" inputmode="tel" value="${esc(customer.phone)}" /></label>
      <label>Moto<input name="motorcycle" value="${esc(customer.motorcycle)}" /></label>
      <label>Placa<input name="plate" value="${esc(customer.plate)}" /></label>
      <label>Última visita<input name="last_visit" type="date" value="${esc(customer.last_visit)}" /></label>
      <label>Tipo de cliente<select name="customer_type"><option value="">Sin clasificar</option>${types.map((type) => `<option ${type === customer.customer_type ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select></label>
    </div>
    <footer class="modal-actions"><button type="button" class="button button-quiet" data-action="close-modal">Cancelar</button><button type="submit" class="button button-primary">Guardar cliente</button></footer>
  </form>`;
}

function renderApp() {
  if (state.passwordRecovery) return renderPasswordRecovery();
  if (!state.session) return renderLogin();
  if (!state.profile) {
    app.innerHTML = '<main class="setup-screen"><section class="setup-card"><div class="brand-mark">AVM</div><h1>Preparando tu cuenta</h1><p>Si el problema continúa, consulta al Administrador.</p></section></main>';
    return;
  }
  renderShell();
}

async function loadProfile() {
  const user = state.session.user;
  const profile = unwrap(await supabase.from('profiles')
    .select('id,email,display_name,role')
    .eq('id', user.id)
    .maybeSingle());
  if (!profile) throw new Error('Tu perfil todavía no está habilitado. Pide al Administrador que revise la cuenta en Supabase.');
  state.profile = profile;
}

async function loadData() {
  const [orders, customers] = await Promise.all([
    supabase.from(isAdmin() ? 'work_orders' : 'technician_work_orders').select('*').order('received_date', { ascending: false }),
    supabase.from('customers').select('*').order('full_name', { ascending: true })
  ]);
  state.orders = unwrap(orders) || [];
  state.customers = unwrap(customers) || [];
  if (isAdmin()) {
    state.profiles = unwrap(await supabase.from('profiles').select('id,email,display_name,role').order('display_name')) || [];
  } else {
    state.profiles = [];
  }
}

async function refresh() {
  if (!state.session) {
    state.profile = null;
    renderApp();
    return;
  }
  try {
    await loadProfile();
    if (!isAdmin() && ['team', 'import'].includes(state.page)) state.page = 'dashboard';
    await loadData();
    renderApp();
  } catch (error) {
    renderLogin(errorMessage(error));
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, 'Ingresando…');
  try {
    const data = new FormData(form);
    const result = await supabase.auth.signInWithPassword({
      email: data.get('email'),
      password: data.get('password')
    });
    if (result.error) throw result.error;
    state.session = result.data.session;
    await refresh();
  } catch (error) {
    renderLogin(errorMessage(error));
  } finally {
    setBusy(button, false);
  }
}

async function saveRecoveredPassword(event) {
  event.preventDefault();
  const form = event.target;
  const values = formValues(form);
  if (values.password !== values.confirm_password) {
    showToast('Las contraseñas no coinciden.', 'error');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, 'Actualizando…');
  try {
    const result = await supabase.auth.updateUser({ password: values.password });
    if (result.error) throw result.error;
    state.passwordRecovery = false;
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    await refresh();
    showToast('Contraseña actualizada.');
  } catch (error) {
    showToast(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function orderPayload(values) {
  const assignedTechnician = state.profiles.find((profile) => profile.id === values.assigned_to);
  return {
    order_number: values.order_number.trim() || null,
    status: values.status || null,
    received_date: values.received_date || null,
    weekday: values.weekday.trim() || null,
    customer_name: values.customer_name.trim() || null,
    phone: values.phone.trim() || null,
    motorcycle: values.motorcycle.trim() || null,
    plate: values.plate.trim() || null,
    helmet: values.helmet.trim() || null,
    location: values.location.trim() || null,
    technician_name: assignedTechnician?.display_name || values.technician_name.trim() || null,
    assigned_to: values.assigned_to || null,
    pickup_date: values.pickup_date || null,
    parts_description: values.parts_description.trim() || null,
    parts_cost: Number(values.parts_cost) || 0,
    advance: Number(values.advance) || 0,
    total_paid: Number(values.total_paid) || 0,
    net_profit: Number(values.net_profit) || 0,
    payment_status: values.payment_status.trim() || null,
    repair_description: values.repair_description.trim() || null,
    observations: values.observations.trim() || null
  };
}

async function saveOrder(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true);
  try {
    const payload = orderPayload(formValues(form));
    const existingOrder = state.orders.find((order) => order.id === form.dataset.id);
    const customerKey = makeCustomerKey(payload.customer_name, payload.phone, null);
    payload.customer_id = null;
    if (customerKey) {
      const customerRecord = {
        legacy_key: customerKey,
        full_name: payload.customer_name,
        phone: payload.phone,
        motorcycle: payload.motorcycle,
        plate: payload.plate,
        last_visit: payload.received_date
      };
      const customerResult = existingOrder?.customer_id
        ? await supabase.from('customers').update(customerRecord).eq('id', existingOrder.customer_id).select('id').single()
        : await supabase.from('customers').upsert(customerRecord, { onConflict: 'legacy_key' }).select('id').single();
      const customer = unwrap(customerResult);
      payload.customer_id = customer.id;
    }
    const id = form.dataset.id;
    const result = id
      ? await supabase.from('work_orders').update(payload).eq('id', id)
      : await supabase.from('work_orders').insert(payload);
    unwrap(result);
    document.querySelector('#modal-root').innerHTML = '';
    await loadData();
    renderApp();
    showToast(id ? 'Orden actualizada.' : 'Orden creada.');
  } catch (error) {
    showToast(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function saveCustomer(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true);
  try {
    const values = formValues(form);
    const existing = state.customers.find((customer) => customer.id === form.dataset.id);
    const legacyKey = makeCustomerKey(
      values.full_name,
      values.phone,
      existing?.legacy_key || `manual:${crypto.randomUUID()}`
    );
    const record = {
      legacy_key: legacyKey,
      legacy_customer_number: values.legacy_customer_number.trim() || null,
      full_name: values.full_name.trim(),
      phone: values.phone.trim() || null,
      motorcycle: values.motorcycle.trim() || null,
      plate: values.plate.trim() || null,
      last_visit: values.last_visit || null,
      customer_type: values.customer_type || null
    };
    const result = existing
      ? await supabase.from('customers').update(record).eq('id', existing.id)
      : await supabase.from('customers').insert(record);
    unwrap(result);
    document.querySelector('#modal-root').innerHTML = '';
    await loadData();
    renderApp();
    showToast(existing ? 'Cliente actualizado.' : 'Cliente agregado.');
  } catch (error) {
    showToast(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true);
  try {
    const values = formValues(form);
    unwrap(await supabase.from('profiles')
      .update({ display_name: values.display_name.trim(), role: values.role })
      .eq('id', form.dataset.id));
    document.querySelector('#modal-root').innerHTML = '';
    await loadProfile();
    if (!isAdmin() && ['team', 'import'].includes(state.page)) state.page = 'dashboard';
    await loadData();
    renderApp();
    showToast('Perfil actualizado.');
  } catch (error) {
    showToast(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function excelCell(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return value.result ?? '';
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text).join('');
    if ('text' in value) return value.text;
  }
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return value;
}

function textValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value).trim();
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime()) && value.getUTCFullYear() >= 1970) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value >= 25569) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000)).toISOString().slice(0, 10);
  }
  const text = textValue(value);
  if (!text || text === '-') return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = textValue(value).replace(/[^\d,.-]/g, '');
  const normalizedAmount = text.includes(',') && !text.includes('.')
    ? text.replace(',', '.')
    : text.replace(/,/g, '');
  const amount = Number.parseFloat(normalizedAmount);
  return Number.isFinite(amount) ? amount : 0;
}

function headerMap(sheet, rowNumber) {
  const row = sheet.getRow(rowNumber);
  const map = new Map();
  const seen = new Map();
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    const key = normalized(textValue(excelCell(cell)));
    if (!key) return;
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    map.set(`${key}#${occurrence}`, column);
    if (occurrence === 1) map.set(key, column);
  });
  return map;
}

function valueFor(row, headers, label, occurrence = 1) {
  const key = normalized(label);
  const column = occurrence === 1 ? headers.get(key) : headers.get(`${key}#${occurrence}`);
  return column ? excelCell(row.getCell(column)) : '';
}

function phoneDigits(phone) {
  return textValue(phone).replace(/\D/g, '');
}

function makeCustomerKey(name, phone, fallback) {
  const digits = phoneDigits(phone);
  const safeName = normalized(name);
  if (digits && safeName) return `contact:${digits}:${safeName}`;
  if (digits) return `phone:${digits}`;
  return safeName ? `name:${safeName}` : fallback;
}

async function importWorkbook(file) {
  const status = document.querySelector('#import-status');
  status.textContent = 'Leyendo el archivo…';
  try {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const orderSheet = workbook.worksheets.find((sheet) => normalized(sheet.name) === 'control diario');
    const directorySheet = workbook.worksheets.find((sheet) => normalized(sheet.name) === 'directorio de clientes');
    if (!orderSheet || !directorySheet) {
      throw new Error('El archivo debe tener las pestañas “Control diario” y “Directorio de Clientes”.');
    }

    const orderHeaders = headerMap(orderSheet, 5);
    const directoryHeaders = headerMap(directorySheet, 3);
    const customerMap = new Map();
    const orderRows = [];

    for (let rowNumber = 4; rowNumber <= directorySheet.rowCount; rowNumber += 1) {
      const row = directorySheet.getRow(rowNumber);
      const customerNumber = textValue(valueFor(row, directoryHeaders, 'N° Cliente'));
      const fullName = textValue(valueFor(row, directoryHeaders, 'Nombre Completo'));
      const phone = textValue(valueFor(row, directoryHeaders, 'Celular'));
      const motorcycle = textValue(valueFor(row, directoryHeaders, 'Moto'));
      const plate = textValue(valueFor(row, directoryHeaders, 'Placa'));
      const lastVisit = parseDate(valueFor(row, directoryHeaders, 'Última Visita'));
      const customerType = textValue(valueFor(row, directoryHeaders, 'Tipo de Cliente'));
      if (![customerNumber, fullName, phone, motorcycle, plate, lastVisit].some(Boolean)) continue;
      const key = makeCustomerKey(fullName, phone, `directory-row:${rowNumber}`);
      const record = {
        legacy_key: key,
        legacy_customer_number: customerNumber || null,
        full_name: fullName || null,
        phone: phone || null,
        motorcycle: motorcycle || null,
        plate: plate || null,
        last_visit: lastVisit,
        customer_type: customerType || null,
        source_row: rowNumber
      };
      customerMap.set(key, { ...customerMap.get(key), ...record });
    }

    const techByName = new Map(state.profiles
      .filter((profile) => profile.role === 'tecnico')
      .map((profile) => [normalized(profile.display_name), profile.id]));

    for (let rowNumber = 6; rowNumber <= orderSheet.rowCount; rowNumber += 1) {
      const row = orderSheet.getRow(rowNumber);
      const customerName = textValue(valueFor(row, orderHeaders, 'Nombre del Cliente'));
      const phone = textValue(valueFor(row, orderHeaders, 'Teléfono / WhatsApp'));
      const motorcycle = textValue(valueFor(row, orderHeaders, 'Marca y Modelo de Moto'));
      const repair = textValue(valueFor(row, orderHeaders, 'Detalle del Arreglo / Falla'));
      const orderNumber = textValue(valueFor(row, orderHeaders, 'N° O.S.'));
      if (![customerName, phone, motorcycle, repair, orderNumber].some(Boolean)) continue;

      const customerKey = makeCustomerKey(customerName, phone, '');
      if (customerKey) {
        const existing = customerMap.get(customerKey) || { legacy_key: customerKey };
        customerMap.set(customerKey, {
          ...existing,
          full_name: existing.full_name || customerName || null,
          phone: existing.phone || phone || null,
          motorcycle: existing.motorcycle || motorcycle || null,
          plate: existing.plate || textValue(valueFor(row, orderHeaders, 'Placa')) || null
        });
      }

      const technicianName = textValue(valueFor(row, orderHeaders, 'TRABAJADO POR:'));
      orderRows.push({
        source_key: `Control diario:${rowNumber}`,
        order_number: orderNumber || null,
        received_date: parseDate(valueFor(row, orderHeaders, 'Fecha de Llegada')),
        weekday: textValue(valueFor(row, orderHeaders, 'Día')) || null,
        customer_name: customerName || null,
        phone: phone || null,
        motorcycle: motorcycle || null,
        plate: textValue(valueFor(row, orderHeaders, 'Placa')) || null,
        helmet: textValue(valueFor(row, orderHeaders, 'Casco')) || null,
        repair_description: repair || null,
        location: textValue(valueFor(row, orderHeaders, 'Se encuentra en:')) || null,
        technician_name: technicianName || null,
        assigned_to: techByName.get(normalized(technicianName)) || null,
        status: textValue(valueFor(row, orderHeaders, 'Estado')) || null,
        pickup_date: parseDate(valueFor(row, orderHeaders, 'Dia de Recojo')),
        parts_description: textValue(valueFor(row, orderHeaders, 'Repuestos comprados')) || null,
        parts_cost: parseAmount(valueFor(row, orderHeaders, 'COSTO DE REPUESTOS')),
        advance: parseAmount(valueFor(row, orderHeaders, 'ADELANTO')),
        total_paid: parseAmount(valueFor(row, orderHeaders, 'PAGO TOTAL Bs.')),
        net_profit: parseAmount(valueFor(row, orderHeaders, 'Ganancia neta')),
        payment_status: textValue(valueFor(row, orderHeaders, 'Estado', 2)) || null,
        observations: textValue(valueFor(row, orderHeaders, 'Observaciones')) || null,
        customer_legacy_key: customerKey || null
      });
    }

    const customers = [...customerMap.values()];
    status.textContent = `Importando ${orderRows.length} órdenes y ${customers.length} clientes…`;
    const customerIds = new Map();
    if (customers.length) {
      const importedCustomers = unwrap(await supabase.from('customers')
        .upsert(customers, { onConflict: 'legacy_key' })
        .select('id,legacy_key'));
      for (const customer of importedCustomers) customerIds.set(customer.legacy_key, customer.id);
    }

    const records = orderRows.map(({ customer_legacy_key, ...order }) => ({
      ...order,
      customer_id: customer_legacy_key ? customerIds.get(customer_legacy_key) || null : null
    }));
    if (records.length) {
      unwrap(await supabase.from('work_orders')
        .upsert(records, { onConflict: 'source_key' }));
    }
    await loadData();
    renderApp();
    showToast(`Importación completada: ${records.length} órdenes y ${customers.length} clientes.`);
  } catch (error) {
    status.textContent = '';
    showToast(errorMessage(error), 'error');
  }
}

function editOrder(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!isAdmin()) return;
  openModal(order ? `Editar orden ${order.order_number || ''}` : 'Nueva orden', orderForm(order || {}), 'modal-large');
}

function editProfile(id) {
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile || !isAdmin()) return;
  const isCurrentAdmin = profile.id === state.session.user.id && profile.role === 'admin';
  const roleField = isCurrentAdmin
    ? `<input type="hidden" name="role" value="admin" /><label>Rol<input value="Administrador" disabled /></label>`
    : `<label>Rol<select name="role"><option value="tecnico" ${profile.role === 'tecnico' ? 'selected' : ''}>Técnico</option><option value="admin" ${profile.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label>`;
  openModal('Editar cuenta', `<form id="profile-form" data-id="${esc(profile.id)}" class="modal-form">
    <label>Nombre visible<input name="display_name" required value="${esc(profile.display_name)}" /></label>
    <label>Correo electrónico<input value="${esc(profile.email)}" disabled /></label>
    ${roleField}
    <footer class="modal-actions"><button type="button" class="button button-quiet" data-action="close-modal">Cancelar</button><button type="submit" class="button button-primary">Guardar</button></footer>
  </form>
  <div class="modal-form"><button type="button" class="button button-quiet" data-action="change-user-password" data-id="${esc(profile.id)}">Establecer nueva contraseña</button></div>`);
}

function changeUserPasswordForm(profile) {
  openModal('Establecer contraseña', `<form id="user-password-form" data-id="${esc(profile.id)}" class="modal-form">
    <p class="muted">Cuenta: <b>${esc(profile.display_name || profile.email)}</b> (${esc(profile.email)})</p>
    <label>Nueva contraseña<input name="password" type="password" minlength="8" autocomplete="new-password" required /></label>
    <label>Repetir contraseña<input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required /></label>
    <p class="muted">Comunica la nueva contraseña al usuario de forma privada.</p>
    <footer class="modal-actions"><button type="button" class="button button-quiet" data-action="close-modal">Cancelar</button><button type="submit" class="button button-primary">Guardar contraseña</button></footer>
  </form>`);
}

function createUserForm() {
  return `<form id="create-user-form" class="modal-form">
    <label>Nombre completo<input name="display_name" maxlength="80" autocomplete="name" required /></label>
    <label>Usuario (correo electrónico)<input name="email" type="email" maxlength="254" autocomplete="username" required /></label>
    <label>Contraseña inicial<input name="password" type="password" minlength="8" autocomplete="new-password" required /></label>
    <label>Repetir contraseña<input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required /></label>
    <label>Perfil<select name="role"><option value="tecnico" selected>Técnico</option><option value="admin">Administrador</option></select></label>
    <p class="muted">La cuenta quedará lista para ingresar sin confirmación por correo. Comparte las credenciales de forma privada.</p>
    <footer class="modal-actions"><button type="button" class="button button-quiet" data-action="close-modal">Cancelar</button><button type="submit" class="button button-primary">Crear cuenta</button></footer>
  </form>`;
}

async function createUser(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, 'Creando cuenta…');
  try {
    const values = formValues(form);
    if (values.password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (values.password !== values.confirm_password) throw new Error('Las contraseñas no coinciden.');
    const result = await supabase.functions.invoke('admin-create-user', {
      body: {
        action: 'create',
        email: values.email.trim(),
        display_name: values.display_name.trim(),
        role: values.role,
        password: values.password
      }
    });
    if (result.error) {
      if (result.error.context instanceof Response) {
        const details = await result.error.context.json();
        if (typeof details.error === 'string') throw new Error(details.error);
      }
      throw result.error;
    }
    document.querySelector('#modal-root').innerHTML = '';
    await loadData();
    renderApp();
    showToast(`Cuenta creada para ${values.email.trim()}. Comparte la contraseña inicial de forma privada.`);
  } catch (error) {
    showToast(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function setUserPassword(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  const values = formValues(form);
  if (values.password.length < 8) {
    showToast('La contraseña debe tener al menos 8 caracteres.', 'error');
    return;
  }
  if (values.password !== values.confirm_password) {
    showToast('Las contraseñas no coinciden.', 'error');
    return;
  }
  setBusy(button, true, 'Guardando…');
  try {
    const result = await supabase.functions.invoke('admin-create-user', {
      body: { action: 'set_password', user_id: form.dataset.id, password: values.password }
    });
    if (result.error) {
      if (result.error.context instanceof Response) {
        const details = await result.error.context.json();
        if (typeof details.error === 'string') throw new Error(details.error);
      }
      throw result.error;
    }
    document.querySelector('#modal-root').innerHTML = '';
    showToast('Contraseña actualizada. Comunícala al usuario de forma privada.');
  } catch (error) {
    showToast(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

document.addEventListener('submit', (event) => {
  if (event.target.id === 'login-form') handleLogin(event);
  if (event.target.id === 'recovery-form') saveRecoveredPassword(event);
  if (event.target.id === 'order-form') saveOrder(event);
  if (event.target.id === 'customer-form') saveCustomer(event);
  if (event.target.id === 'profile-form') saveProfile(event);
  if (event.target.id === 'create-user-form') createUser(event);
  if (event.target.id === 'user-password-form') setUserPassword(event);
});

document.addEventListener('click', async (event) => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    event.preventDefault();
    state.page = pageButton.dataset.page;
    renderApp();
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const { action, id } = actionButton.dataset;
  try {
    if (action === 'sign-out') {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
      state.session = null;
      state.profile = null;
      state.passwordRecovery = false;
      state.page = 'dashboard';
      state.orders = [];
      state.customers = [];
      state.profiles = [];
      renderApp();
    } else if (action === 'forgot-password') {
      showToast('Contacta al Administrador para que establezca una nueva contraseña.');
    } else if (action === 'new-order') {
      editOrder('');
    } else if (action === 'edit-order') {
      editOrder(id);
    } else if (action === 'new-customer') {
      openModal('Nuevo cliente', customerForm());
    } else if (action === 'edit-customer') {
      const customer = state.customers.find((item) => item.id === id);
      if (customer && isAdmin()) openModal('Editar cliente', customerForm(customer));
    } else if (action === 'edit-profile') {
      editProfile(id);
    } else if (action === 'change-user-password' && isAdmin()) {
      const profile = state.profiles.find((item) => item.id === id);
      if (profile) changeUserPasswordForm(profile);
    } else if (action === 'new-user' && isAdmin()) {
      openModal('Crear usuario', createUserForm());
    } else if (action === 'close-modal') {
      if (actionButton.classList.contains('modal-backdrop') && event.target !== actionButton) return;
      document.querySelector('#modal-root').innerHTML = '';
    }
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'order-search') {
    state.search = event.target.value;
    const content = document.querySelector('#page-content');
    const cursor = event.target.selectionStart;
    content.innerHTML = renderOrders();
    const next = document.querySelector('#order-search');
    next?.focus();
    next?.setSelectionRange(cursor, cursor);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'status-filter') {
    state.status = event.target.value;
    document.querySelector('#page-content').innerHTML = renderOrders();
  }
  if (event.target.id === 'workbook-file' && event.target.files?.[0]) {
    importWorkbook(event.target.files[0]);
  }
});

async function start() {
  if (!supabase) {
    renderConfigError();
    return;
  }
  state.passwordRecovery = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
  let authInitialized = false;
  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') state.passwordRecovery = true;
    if (!session) {
      state.passwordRecovery = false;
      state.profile = null;
      state.page = 'dashboard';
      state.orders = [];
      state.customers = [];
      state.profiles = [];
      if (authInitialized) renderApp();
      return;
    }
    if (authInitialized) window.setTimeout(() => refresh(), 0);
  });

  const result = await supabase.auth.getSession();
  if (result.error) {
    renderLogin(errorMessage(result.error));
    return;
  }
  state.session = result.data.session;
  await refresh();
  authInitialized = true;
}

start().catch((error) => {
  renderLogin(errorMessage(error));
});
