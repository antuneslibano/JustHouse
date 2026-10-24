'use strict';

const $ = (sel) => document.querySelector(sel);

const state = { q: '', sort: 'recent', tag: '', page: 1, totalPages: 1 };
const els = {
  grid: $('#grid'),
  empty: $('#empty'),
  info: $('#result-info'),
  pager: $('#pager'),
  pageLabel: $('#page-label'),
  tagList: $('#tag-list'),
  skinDialog: $('#skin-dialog'),
  submitDialog: $('#submit-dialog'),
  submitForm: $('#submit-form'),
  submitError: $('#submit-error'),
  toast: $('#toast'),
};
let currentSkin = null;

// ---------- utilidades ----------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Algo deu errado. Tente novamente.');
  return data;
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback para navegadores sem Clipboard API (ou fora de HTTPS).
    const area = el('textarea', { style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

async function copySkinCode(skin) {
  await copyText(skin.code);
  toast('Código copiado! Agora é só colar no jogo.');
  api(`/api/skins/${skin.id}/copy`, { method: 'POST' })
    .then(({ copies }) => {
      skin.copies = copies;
      if (currentSkin?.id === skin.id) renderStats(skin);
    })
    .catch(() => {});
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------- listagem ----------

function card(skin) {
  return el('article', {
    class: 'card',
    tabindex: '0',
    role: 'button',
    'aria-label': `Ver skin ${skin.name}`,
    onclick: () => openSkin(skin.id),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSkin(skin.id); } },
  }, [
    el('div', { class: 'card-image' }, [
      el('img', { src: skin.images[0], alt: `Imagem da skin ${skin.name}`, loading: 'lazy' }),
      skin.images.length > 1 ? el('span', { class: 'card-count', text: `${skin.images.length} fotos` }) : null,
    ]),
    el('div', { class: 'card-body' }, [
      el('h3', { class: 'card-title', text: skin.name, title: skin.name }),
      el('p', { class: 'card-author', text: skin.author ? `por ${skin.author}` : 'autor anônimo' }),
      el('div', { class: 'card-footer' }, [
        el('span', { class: 'card-stats', text: `⧉ ${skin.copies} · ♥ ${skin.likes}` }),
        el('button', {
          class: 'btn btn-primary card-copy',
          type: 'button',
          text: 'Copiar código',
          onclick: (e) => { e.stopPropagation(); copySkinCode(skin); },
        }),
      ]),
    ]),
  ]);
}

let listRequest = 0;
async function loadSkins() {
  const id = ++listRequest;
  els.grid.replaceChildren(...Array.from({ length: 8 }, () => el('div', { class: 'skeleton' })));
  els.empty.hidden = true;
  const params = new URLSearchParams({ sort: state.sort, page: state.page });
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);

  try {
    const data = await api(`/api/skins?${params}`);
    if (id !== listRequest) return;
    state.totalPages = data.totalPages;
    els.grid.replaceChildren(...data.skins.map(card));
    els.empty.hidden = data.total > 0;
    const filtro = state.tag ? ` com a tag “${state.tag}”` : '';
    els.info.textContent = data.total ? `${plural(data.total, 'skin encontrada', 'skins encontradas')}${filtro}` : '';
    els.pager.hidden = data.totalPages <= 1;
    els.pageLabel.textContent = `Página ${data.page} de ${data.totalPages}`;
    $('#prev').disabled = data.page <= 1;
    $('#next').disabled = data.page >= data.totalPages;
  } catch (err) {
    if (id !== listRequest) return;
    els.grid.replaceChildren();
    els.info.textContent = err.message;
  }
}

async function loadTags() {
  try {
    const { tags } = await api('/api/tags');
    const chips = tags.map(({ tag }) =>
      el('button', {
        class: `tag${state.tag === tag ? ' active' : ''}`,
        type: 'button',
        text: `#${tag}`,
        'aria-pressed': String(state.tag === tag),
        onclick: () => {
          state.tag = state.tag === tag ? '' : tag;
          state.page = 1;
          loadTags();
          loadSkins();
        },
      }),
    );
    els.tagList.replaceChildren(...chips);
  } catch {
    els.tagList.replaceChildren();
  }
}

// ---------- detalhes ----------

function renderStats(skin) {
  $('#skin-stats').textContent = `${plural(skin.copies, 'cópia', 'cópias')} · ${plural(skin.likes, 'curtida', 'curtidas')}`;
  const like = $('#like-skin');
  like.setAttribute('aria-pressed', String(skin.liked));
  like.firstChild.textContent = skin.liked ? '♥ ' : '♡ ';
  like.querySelector('span').textContent = skin.liked ? 'Curtido' : 'Curtir';
}

function showImage(skin, index) {
  const main = $('#skin-main-image');
  main.src = skin.images[index];
  main.alt = `Imagem ${index + 1} da skin ${skin.name}`;
  for (const [i, btn] of [...$('#skin-thumbs').children].entries()) btn.setAttribute('aria-current', String(i === index));
}

async function openSkin(id) {
  if (location.hash !== `#/skin/${id}`) {
    history.pushState(null, '', `#/skin/${id}`);
  }
  try {
    const skin = await api(`/api/skins/${id}`);
    currentSkin = skin;
    $('#skin-title').textContent = skin.name;
    $('#skin-meta').textContent = `${skin.author ? `por ${skin.author}` : 'autor anônimo'} · ${formatDate(skin.createdAt)}`;
    $('#skin-description').textContent = skin.description;
    $('#skin-code').value = skin.code;
    $('#skin-tags').replaceChildren(...skin.tags.map((tag) => el('button', {
      class: 'tag',
      type: 'button',
      text: `#${tag}`,
      onclick: () => {
        state.tag = tag;
        state.page = 1;
        els.skinDialog.close();
        loadTags();
        loadSkins();
      },
    })));
    $('#skin-thumbs').replaceChildren(...(skin.images.length > 1 ? skin.images.map((src, i) =>
      el('button', { type: 'button', 'aria-label': `Ver imagem ${i + 1}`, onclick: () => showImage(skin, i) }, [
        el('img', { src, alt: '' }),
      ])) : []));
    showImage(skin, 0);
    renderStats(skin);
    if (!els.skinDialog.open) els.skinDialog.showModal();
  } catch (err) {
    toast(err.message);
    history.replaceState(null, '', '#/');
  }
}

$('#copy-code').addEventListener('click', () => currentSkin && copySkinCode(currentSkin));

$('#like-skin').addEventListener('click', async () => {
  if (!currentSkin) return;
  try {
    const { liked, likes } = await api(`/api/skins/${currentSkin.id}/like`, { method: 'POST' });
    Object.assign(currentSkin, { liked, likes });
    renderStats(currentSkin);
  } catch (err) {
    toast(err.message);
  }
});

$('#share-skin').addEventListener('click', async () => {
  if (!currentSkin) return;
  const url = `${location.origin}${location.pathname}#/skin/${currentSkin.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: currentSkin.name, url }); return; } catch { /* cancelado */ }
  }
  await copyText(url);
  toast('Link copiado!');
});

els.skinDialog.addEventListener('close', () => {
  currentSkin = null;
  if (location.hash.startsWith('#/skin/')) history.replaceState(null, '', '#/');
});

// ---------- envio ----------

function openSubmit() {
  els.submitError.textContent = '';
  els.submitDialog.showModal();
}
$('#open-submit').addEventListener('click', openSubmit);
$('#empty-submit').addEventListener('click', openSubmit);

const fileInput = els.submitForm.elements.images;
let previewUrls = [];
fileInput.addEventListener('change', () => {
  previewUrls.forEach(URL.revokeObjectURL);
  previewUrls = [...fileInput.files].slice(0, 4).map((f) => URL.createObjectURL(f));
  $('#submit-preview').replaceChildren(...previewUrls.map((src) => el('img', { src, alt: '' })));
});

function validateSubmit(form) {
  if (!form.elements.name.value.trim()) return 'Informe o nome da skin.';
  if (!form.elements.code.value.trim()) return 'Informe o código da skin.';
  const files = [...form.elements.images.files];
  if (files.length === 0) return 'Envie pelo menos uma imagem da skin.';
  if (files.length > 4) return 'Envie no máximo 4 imagens.';
  const types = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (files.some((f) => !types.includes(f.type))) return 'Formato de imagem não suportado. Use PNG, JPG, WEBP ou GIF.';
  if (files.some((f) => f.size > 5 * 1024 * 1024)) return 'Cada imagem pode ter no máximo 5 MB.';
  return '';
}

// Envia as imagens direto para o Storage usando links assinados pelo servidor
// e depois cria a skin com os caminhos enviados.
async function publishSkin(form, onStatus) {
  const files = [...form.elements.images.files];
  const { uploads } = await api('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: files.map((f) => ({ type: f.type, size: f.size })) }),
  });

  let done = 0;
  onStatus(`Enviando imagens (0/${files.length})…`);
  await Promise.all(uploads.map(async ({ url }, i) => {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': files[i].type, 'Cache-Control': 'max-age=2592000', 'x-upsert': 'false' },
      body: files[i],
    });
    if (!res.ok) throw new Error('Não foi possível enviar as imagens. Tente novamente.');
    onStatus(`Enviando imagens (${++done}/${files.length})…`);
  }));

  onStatus('Publicando…');
  const fields = Object.fromEntries(['name', 'code', 'author', 'description', 'tags'].map((k) => [k, form.elements[k].value]));
  return api('/api/skins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fields, images: uploads.map((u) => u.path) }),
  });
}

els.submitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = els.submitForm;
  const problem = validateSubmit(form);
  els.submitError.textContent = problem;
  if (problem) return;

  const button = $('#submit-button');
  button.disabled = true;
  try {
    const skin = await publishSkin(form, (status) => { button.textContent = status; });
    form.reset();
    previewUrls.forEach(URL.revokeObjectURL);
    previewUrls = [];
    $('#submit-preview').replaceChildren();
    els.submitDialog.close();
    toast('Skin publicada! 🏐');
    Object.assign(state, { q: '', tag: '', sort: 'recent', page: 1 });
    $('#q').value = '';
    $('#sort').value = 'recent';
    loadTags();
    loadSkins();
    openSkin(skin.id);
  } catch (err) {
    els.submitError.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Publicar skin';
  }
});

// Fecha diálogos pelo botão × ou clicando fora.
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

// ---------- filtros e navegação ----------

let searchTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    state.page = 1;
    loadSkins();
  }, 250);
});
$('#filters').addEventListener('submit', (e) => e.preventDefault());
$('#sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  state.page = 1;
  loadSkins();
});
$('#prev').addEventListener('click', () => { state.page -= 1; loadSkins(); scrollTo({ top: 0, behavior: 'smooth' }); });
$('#next').addEventListener('click', () => { state.page += 1; loadSkins(); scrollTo({ top: 0, behavior: 'smooth' }); });

function route() {
  const match = location.hash.match(/^#\/skin\/(\d+)$/);
  if (match) openSkin(Number(match[1]));
  else if (els.skinDialog.open) els.skinDialog.close();
}
window.addEventListener('popstate', route);

loadTags();
loadSkins();
route();
