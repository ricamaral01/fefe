import { html, session, api, icon, iniciais, $, toast } from './core.js';
import login from './views/login.js';
import agenda from './views/agenda.js';
import atendimento from './views/atendimento.js';
import recepcao from './views/recepcao.js';
import pacientes from './views/pacientes.js';
import config from './views/config.js';
import perfil from './views/perfil.js';

const app = document.getElementById('app');
export const state = { clinica: null };

const ROTAS = {
  login: { view: login, publico: true },
  agenda: { view: agenda, perfis: ['medico'], nav: ['Agenda do dia', 'calendar'] },
  atendimento: { view: atendimento, perfis: ['medico'] },
  recepcao: { view: recepcao, nav: ['Recepção', 'door'] },
  pacientes: { view: pacientes, nav: ['Pacientes', 'users'] },
  perfil: { view: perfil, perfis: ['medico'], nav: ['Meu cabeçalho', 'file', 'Cabeçalho'] },
  config: { view: config, admin: true, nav: ['Configurações', 'settings'] },
};

const permitido = (r, u) => r.publico || (u && (!r.perfis || r.perfis.includes(u.perfil)) && (!r.admin || u.admin));
export const inicio = (u) => (u?.perfil === 'medico' ? '#/agenda' : '#/recepcao');

let limparView = null;

function shell(u, rota) {
  const links = Object.entries(ROTAS).filter(([, r]) => r.nav && permitido(r, u));
  const nav = (cls) => links.map(([k, r]) => html`<a href="#/${k}" class="${k === rota ? 'on' : ''}">${icon(r.nav[1])}<span>${cls === 'tab' ? (r.nav[2] || r.nav[0].split(' ')[0]) : r.nav[0]}</span></a>`);
  const nome = state.clinica?.nome || 'Clínica';
  return html`<div class="shell">
    <aside class="sidebar">
      <div class="brand"><img src="/icons/icon.svg" alt=""><div><b>${nome}</b><small>Agenda e prontuário</small></div></div>
      <nav class="nav">${nav('side')}</nav>
      <div class="me"><div class="avatar" style="--av:${u.cor || '#0f766e'}">${iniciais(u.nome)}</div>
        <div class="grow"><div class="ellipsis" style="font-weight:650;font-size:14px">${u.nome}</div>
        <div class="small muted">${u.perfil === 'medico' ? 'Médico(a)' : 'Recepção'}${u.admin ? ' · admin' : ''}</div></div>
        <button class="btn ghost icon-only" data-sair title="Sair" aria-label="Sair">${icon('logout')}</button></div>
    </aside>
    <header class="mobile-head"><img src="/icons/icon.svg" alt=""><b class="grow ellipsis">${nome}</b>
      <button class="btn ghost icon-only" data-sair aria-label="Sair">${icon('logout')}</button></header>
    <main class="main" id="view"></main>
    <nav class="tabbar">${nav('tab')}</nav>
  </div>`.s;
}

async function render() {
  limparView?.();
  limparView = null;
  const [, rota = '', ...params] = location.hash.replace(/^#/, '').split('/');
  const u = session.user;
  if (!u && rota !== 'login') return (location.hash = '#/login');
  const r = ROTAS[rota];
  if (!r || !permitido(r, u)) return (location.hash = u ? inicio(u) : '#/login');

  if (r.publico) {
    app.innerHTML = '';
    limparView = await r.view(app, params);
    return;
  }
  if (!state.clinica) state.clinica = await api('/clinica').catch(() => null);
  app.innerHTML = shell(u, rota);
  app.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', () => { session.clear(); location.hash = '#/login'; }));
  try {
    limparView = await r.view($('#view'), params);
  } catch (e) {
    $('#view').innerHTML = html`<div class="empty">${e.message}</div>`.s;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('offline', () => toast('Sem conexão com a internet', 'erro'));
