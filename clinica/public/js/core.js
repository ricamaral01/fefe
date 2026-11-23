// Núcleo do app: API, sessão, templates seguros, utilidades de UI.

// ---------- templates com escape automático
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v == null ? '' : esc(v));
export const html = (strs, ...vals) => raw(strs.reduce((acc, s, i) => acc + s + (i < vals.length ? val(vals[i]) : ''), ''));

// ---------- sessão
export const session = {
  get token() { try { return localStorage.getItem('token'); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } },
  set(token, user) { try { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); } catch {} },
  setUser(user) { try { localStorage.setItem('user', JSON.stringify(user)); } catch {} },
  clear() { try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch {} },
};

// ---------- API
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Sem conexão com o servidor');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    session.clear();
    location.hash = '#/login';
    throw new Error(data.erro || 'Sessão expirada');
  }
  if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);
  return data;
}

// ---------- datas
export const hojeISO = () => new Date().toLocaleDateString('sv-SE');
export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
export const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
export const fmtDataLonga = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
export const fmtDataHora = (ts) => (ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtHora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export function idade(nasc) {
  if (!nasc) return null;
  const n = new Date(nasc + 'T12:00:00'), h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
  return a;
}

// ---------- rótulos
export const STATUS = {
  agendado: { t: 'Agendado', c: 'gray' },
  confirmado: { t: 'Confirmado', c: 'blue' },
  aguardando: { t: 'Na recepção', c: 'amber' },
  em_atendimento: { t: 'Em atendimento', c: 'purple' },
  finalizado: { t: 'Atendido', c: 'green' },
  cancelado: { t: 'Cancelado', c: 'red' },
  faltou: { t: 'Faltou', c: 'red' },
};
export const badgeStatus = (s) => html`<span class="badge ${STATUS[s]?.c || 'gray'}">${STATUS[s]?.t || s}</span>`;
export const badgePagamento = (a) => a.pagamento === 'convenio'
  ? html`<span class="badge outline teal">${a.convenio || 'Convênio'}</span>`
  : html`<span class="badge outline">Particular</span>`;
export const badgeTipo = (a) => a.tipo === 'retorno'
  ? html`<span class="badge outline">Retorno</span>`
  : html`<span class="badge outline accent">1ª consulta</span>`;
export const WA_STATUS = { pendente: 'WhatsApp pendente', enviado: 'WhatsApp enviado', falhou: 'WhatsApp falhou', manual: 'Enviar WhatsApp', respondido: 'Paciente respondeu' };

// ---------- UI
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3600);
}

// Modal genérico. Retorna { el, close }. onClose é chamado ao fechar.
export function modal(conteudo, { largura = 560, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="--w:${largura}px">${conteudo}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  const close = () => {
    wrap.remove();
    if (!$('.modal-wrap')) document.body.classList.remove('no-scroll');
    onClose?.();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => $('[autofocus]', wrap)?.focus());
  return { el: wrap, close };
}

export function confirmar(titulo, texto, { ok = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    let r = false;
    const m = modal(html`<header><h2>${titulo}</h2></header><div class="modal-body"><p>${texto}</p></div>
      <footer><button class="btn ghost" data-close>Voltar</button><button class="btn ${perigo ? 'danger' : 'primary'}" data-ok autofocus>${ok}</button></footer>`.s,
      { largura: 420, onClose: () => resolve(r) });
    $('[data-ok]', m.el).addEventListener('click', () => { r = true; m.close(); });
  });
}

// Lê um formulário em objeto (checkbox => boolean)
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

export const iniciais = (nome) => String(nome || '').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export const icon = (n) => raw(`<svg class="i" aria-hidden="true"><use href="/icons/sprite.svg#${n}"/></svg>`);

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Botão com estado de carregamento
export async function comLoading(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try { return await fn(); } catch (e) { toast(e.message, 'erro'); } finally { btn.disabled = false; btn.classList.remove('loading'); }
}
