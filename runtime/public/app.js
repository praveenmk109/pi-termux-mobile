import { API } from './constants.js';
import { renderMenu } from './menu.js';
import { newRequestId, postJson, Transcript, usageText } from './transcript.js';

const token = renderMenu();

const chat = document.getElementById('chat');
const input = document.getElementById('input');
const statusEl = document.getElementById('status');
const sessionNameEl = document.getElementById('session-name');
const sessionLink = document.getElementById('session-link');
const usageEl = document.getElementById('session-usage');
const steerWrap = document.getElementById('steer-wrap');
const steerBox = document.getElementById('steer');
const modelSelect = document.getElementById('model-select');
const btnAbort   = document.getElementById('btn-abort');
const btnCompact = document.getElementById('btn-compact');
const btnNew     = document.getElementById('btn-new');

let busy = false;
let queued = 0;
let currentModel = null;

function status(t) { statusEl.textContent = t; }
function showBusy() {
  status(busy ? `running…${queued ? ` (${queued} queued)` : ''}` : 'idle');
  steerWrap.classList.toggle('hidden', !busy);
}

const transcript = new Transcript(chat, {
  onBusy: (b) => { busy = b; if (btnAbort) btnAbort.classList.toggle('hidden', !b); showBusy(); },
  onModel: (m) => { currentModel = m; syncModelSelect(); },
  onUsage: (u) => { usageEl.textContent = usageText(u); },
  onInbox: (items) => { queued = items.length; showBusy(); },
});

// --- events: every (re)connect gets a fresh snapshot of the current state ----

function connect() {
  const es = new EventSource(`${API.events}?token=${encodeURIComponent(token)}`);
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === 'bridge_snapshot') {
      sessionNameEl.textContent = ev.sessionName || 'Main';
      if (sessionLink) sessionLink.href = `sessions.html?token=${encodeURIComponent(token)}`;
      transcript.renderSnapshot(ev.snapshot);
    } else if (ev.type === 'bridge_error') {
      transcript.sys(`error: ${ev.error}`);
    } else if (ev.type !== 'bridge_connected') {
      transcript.handleEvent(ev);
    }
  };
  es.onerror = () => status('reconnecting…');
}

// --- composer: requestId makes a retried prompt exactly-once ------------------

document.getElementById('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const pending = transcript.addPendingUser(text);
  const body = { message: text, requestId: newRequestId() };
  if (busy && steerBox.checked) body.whenBusy = 'steer';
  const r = await postJson(API.prompt, token, body, { retries: 3 });
  if (r.error) transcript.failPending(pending, r.error);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('composer').requestSubmit();
});

// --- model picker ------------------------------------------------------------

const modelBtn = document.getElementById('model-btn');
const modelModal = document.getElementById('model-modal');
const modelModalClose = document.getElementById('model-modal-close');
const modelSearch = document.getElementById('model-search');
const modelFilterFree = document.getElementById('model-filter-free');
const modelList = document.getElementById('model-list');

let allModels = [];
let filterFreeOnly = false;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function updateModelButton() {
  if (!currentModel || !currentModel.modelId) {
    if (modelBtn) modelBtn.textContent = 'no model';
    return;
  }
  const id = currentModel.modelId.split('/').pop();
  if (modelBtn) {
    modelBtn.textContent = `${currentModel.provider}/${id}`;
    modelBtn.title = `${currentModel.provider}/${currentModel.modelId}`;
  }
}

function renderModelList() {
  if (!modelList) return;
  const q = (modelSearch?.value || '').trim().toLowerCase();
  const currentKey = currentModel ? `${currentModel.provider}|${currentModel.modelId}` : '';

  const filtered = allModels.filter((m) => {
    if (filterFreeOnly && !m.free) return false;
    if (!q) return true;
    return m.modelId.toLowerCase().includes(q) ||
           (m.name && m.name.toLowerCase().includes(q)) ||
           m.provider.toLowerCase().includes(q);
  });

  modelList.innerHTML = '';
  if (filtered.length === 0) {
    modelList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">No matching models found.</div>';
    return;
  }

  for (const m of filtered) {
    const key = `${m.provider}|${m.modelId}`;
    const isSelected = key === currentKey;
    const item = document.createElement('div');
    item.className = `model-item ${isSelected ? 'selected' : ''}`;

    item.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="model-name">${esc(m.name || m.modelId)}</div>
        <div class="model-id">${esc(m.provider)}/${esc(m.modelId)}</div>
      </div>
      ${m.free ? '<span class="badge-free">FREE</span>' : '<span class="badge-provider">' + esc(m.provider) + '</span>'}
      ${isSelected ? '<span style="color:var(--primary);font-size:15px;margin-left:4px;">✓</span>' : ''}
    `;

    item.addEventListener('click', async () => {
      closeModelModal();
      const r = await postJson(API.model, token, { provider: m.provider, modelId: m.modelId });
      if (r.ok) {
        currentModel = { provider: m.provider, modelId: m.modelId };
        updateModelButton();
        syncModelSelect();
    renderModelList();
      } else {
        transcript.sys(`error setting model: ${r.error}`);
      }
    });

    modelList.appendChild(item);
  }
}

function openModelModal() {
  if (modelModal) {
    modelModal.classList.remove('hidden');
    renderModelList();
    if (modelSearch) {
      modelSearch.value = '';
      setTimeout(() => modelSearch.focus(), 80);
    }
  }
}

function closeModelModal() {
  if (modelModal) modelModal.classList.add('hidden');
}

if (modelBtn) modelBtn.addEventListener('click', openModelModal);
if (modelModalClose) modelModalClose.addEventListener('click', closeModelModal);
if (modelModal) {
  modelModal.addEventListener('click', (e) => {
    if (e.target === modelModal) closeModelModal();
  });
}

if (modelSearch) modelSearch.addEventListener('input', renderModelList);
if (modelFilterFree) {
  modelFilterFree.addEventListener('click', () => {
    filterFreeOnly = !filterFreeOnly;
    modelFilterFree.classList.toggle('active', filterFreeOnly);
    renderModelList();
  });
}

function syncModelSelect() {
  updateModelButton();
  if (!currentModel) { modelSelect.value = ''; return; }
  const v = `${currentModel.provider}|${currentModel.modelId}`;
  if (![...modelSelect.options].some((o) => o.value === v)) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = `${currentModel.provider}/${currentModel.modelId}`;
    modelSelect.appendChild(o);
  }
  modelSelect.value = v;
}

async function refreshModels() {
  try {
    const r = await fetch(`${API.models}?token=${encodeURIComponent(token)}`);
    const j = await r.json();
    modelSelect.innerHTML = '<option value="">no model</option>';
    allModels = j.models ?? [];
    for (const m of allModels) {
      const o = document.createElement('option');
      o.value = `${m.provider}|${m.modelId}`;
      o.textContent = `${m.provider}/${m.modelId}`;
      modelSelect.appendChild(o);
    }
    syncModelSelect();
    renderModelList();
  } catch {}
}

modelSelect.addEventListener('change', async () => {
  const [provider, modelId] = modelSelect.value.split('|');
  if (!modelId) return;
  const r = await postJson(API.model, token, { provider, modelId });
  if (!r.ok) transcript.sys(`error: ${r.error}`);
  else { currentModel = { provider, modelId }; updateModelButton(); }
});

// ── Header action buttons ────────────────────────────────────────────────
const post1 = (url) => fetch(url, { method: 'POST', headers: { 'x-token': token } });
if (btnAbort)   btnAbort.addEventListener('click',   () => post1(API.abort));
if (btnCompact) btnCompact.addEventListener('click', async () => {
  const r = await postJson(API.compact, token, {});
  if (!r.ok && r.error) transcript.sys(`error: ${r.error}`);
});
if (btnNew) btnNew.addEventListener('click', async () => {
  const name = prompt('Session name (optional):') ?? null;
  if (name === null) return;
  const r = await postJson(API.sessionNew, token, { name });
  if (r.ok) location.href = `/?token=${encodeURIComponent(token)}`;
  else transcript.sys(`error: ${r.error}`);
});

connect();
refreshModels();
