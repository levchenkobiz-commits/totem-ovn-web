const root = document.querySelector('#root');
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const apiBase = localHost ? '/api' : 'https://miniapp.grome.pro/totem-ovn-api';
const logo = '<img class="brand" src="./assets/totem-header.svg" alt="Totem">';
const statusLabels = {
  pass: 'В норме', fail: 'Нарушение', unknown: 'Нет данных', na: 'Не применимо', measured: 'Замер',
};
const reactionLabels = { none: 'Без отметки', acknowledged: 'Принято', follow_up: 'Нужно разобраться' };
const modes = { observed: 'Заполнить', unknown: 'Нет данных', na: 'Не применимо' };
let token;
let user;
let catalog;
let screen = 0;
let previousPayload;
let draft;
let reportFilters = {};
let loginMessage = '';

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function options(values, current) {
  return values.map(({ value, label }) => (
    `<option value="${escape(value)}"${String(value) === String(current) ? ' selected' : ''}>${escape(label)}</option>`
  )).join('');
}

function field(label, control, wide = false) {
  return `<label class="field${wide ? ' wide' : ''}"><span>${escape(label)}</span>${control}</label>`;
}

function input(name, value = '', attributes = '') {
  return `<input name="${escape(name)}" value="${escape(value)}" ${attributes}>`;
}

function select(name, choices, value, attributes = '') {
  return `<select name="${escape(name)}" ${attributes}>${options(choices, value)}</select>`;
}

function note(name, value = '', attributes = '') {
  return `<textarea name="${escape(name)}" ${attributes}>${escape(value)}</textarea>`;
}

function pageHead(title, description = '', actions = '') {
  return `<div class="head"><div><h1 tabindex="-1">${escape(title)}</h1>${description ? `<p>${escape(description)}</p>` : ''}</div>${actions}</div>`;
}

function currentDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
}

function displayDate(value) {
  if (!value) return '';
  if (/^\d{4}-\d\d-\d\d$/.test(value)) return value.split('-').reverse().join('.');
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('ru', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow',
  }).format(date);
}

function status(message, tone = '') {
  const line = document.querySelector('#status');
  if (line) {
    line.textContent = message;
    line.dataset.tone = tone;
    if (tone === 'error') line.focus({ preventScroll: false });
  }
}

const statusLine = '<p id="status" class="status-line" role="status" tabindex="-1"></p>';

async function api(path, { method = 'GET', body, download = false } = {}) {
  const headers = {};
  const activeToken = token;
  if (activeToken) headers.Authorization = `Bearer ${activeToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(apiBase + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit',
    });
  } catch {
    throw new Error('Сервис недоступен. Проверьте соединение и повторите попытку.');
  }
  if (response.ok && download) return response.blob();
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  if (response.status === 401 && activeToken && token === activeToken) {
    clearSession();
    loginMessage = 'Сеанс завершён. Войдите снова.';
    renderLogin();
  }
  throw new Error(data.error || 'Запрос не выполнен. Повторите попытку.');
}

function clearSession() {
  screen++;
  token = user = catalog = draft = undefined;
  reportFilters = {};
  previousPayload = undefined;
}

function renderLogin() {
  root.innerHTML = `<main class="login"><div class="login-brand">${logo}
    <img class="login-mark" src="./assets/totem-symbol.svg" alt=""></div>
    <div class="login-body"><form id="login" class="flow">
      <h1>Отдел видеонаблюдения</h1>
      <p class="muted">Ксения входит по персональной ссылке.</p>
      <h2>Вход владельца</h2>
      ${field('Пароль', input('password', '', 'type="password" required autocomplete="current-password"'))}
      <button class="button">Войти</button>
      ${statusLine}
    </form></div></main>`;
  status(loginMessage);
  loginMessage = '';
  document.querySelector('#login').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    status('Входим…');
    try {
      await signIn({ user: 'owner', password: new FormData(form).get('password') });
    } catch (error) {
      if (token) {
        clearSession();
        renderLogin();
      }
      status(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function signIn(credentials) {
  const data = await api('/login', { method: 'POST', body: credentials });
  token = data.token;
  user = data.user;
  catalog = await api('/catalog');
  await go('check');
}

async function openInvitation(invite) {
  const button = root.querySelector('#login button');
  button.disabled = true;
  status('Входим…');
  try {
    await signIn({ user: 'kseniya', invite });
  } catch (error) {
    clearSession();
    loginMessage = error.message;
    renderLogin();
  }
}

function shell(page) {
  const links = [
    ['check', 'Новая проверка'], ['journal', 'Журнал'], ['co2', 'CO₂'],
    ...(user.role === 'owner' ? [['settings', 'Нормативы']] : []),
  ];
  root.innerHTML = `<header><div class="header-inner">
    <div class="header-top">${logo}<div class="account"><span>${escape(user.name)}</span>
      <button type="button" class="signout" id="signout">Выйти</button></div></div>
    <nav aria-label="Разделы ОВН">${links.map(([id, text]) =>
      `<button type="button" data-page="${id}"${id === page || (page === 'report' && id === 'journal') ? ' aria-current="page"' : ''}>${text}</button>`,
    ).join('')}</nav>
    </div></header><main id="content"></main>`;
  root.querySelectorAll('[data-page]').forEach(button => button.onclick = () => go(button.dataset.page));
  root.querySelector('#signout').onclick = () => {
    const logout = api('/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    renderLogin();
    return logout;
  };
  return root.querySelector('#content');
}

function go(page, id) {
  root.querySelector('#check-form')?.dispatchEvent(new Event('save-draft'));
  const version = ++screen;
  const main = shell(page);
  if (page === 'check') return renderCheck(main);
  if (page === 'journal') return renderJournal(main, version);
  if (page === 'co2') return renderCo2(main, version);
  if (page === 'settings') return renderSettings(main, version);
  return renderReport(main, id, version);
}

function categoryOptions() {
  return catalog.categories.map(({ id, label }) => ({ value: id, label }));
}

function blankDraft() {
  return {
    date: currentDate(), location: '', shift: '', subject: '', category: catalog.categories[0]?.id || '',
    observations: {}, notes: '', evidence: [], requestId: crypto.randomUUID(),
  };
}

function specialRow(type, value = {}) {
  if (type === 'drinks') {
    return `<div class="grid repeat-row">
      ${field('Напиток', input('name', value.name, 'maxlength="100" list="drink-names"'))}
      ${field('Принят заказ', input('accepted', value.accepted, 'type="time" step="1"'))}
      ${field('Напиток подан', input('served', value.served, 'type="time" step="1"'))}
      <div class="row-actions"><button type="button" class="button quiet" data-remove>Удалить напиток</button></div>
    </div>`;
  }
  return `<div class="grid repeat-row">
    ${field('Вид перерыва', select('type', [
      { value: 'meal', label: 'Приём пищи' }, { value: 'restroom', label: 'Туалет' },
      { value: 'other', label: 'Другой' },
    ], value.type || 'meal', 'required'))}
    ${field('Начало', input('start', value.start, 'type="time" step="1"'))}
    ${field('Конец', input('end', value.end, 'type="time" step="1"'))}
    ${field('Примечание к перерыву', input('note', value.note, 'maxlength="300"'))}
    <div class="row-actions"><button type="button" class="button quiet" data-remove>Удалить перерыв</button></div>
  </div>`;
}

function repeat(type, key, label, values = [], row = specialRow, buttonLabel = '') {
  const addLabel = buttonLabel || (type === 'drinks' ? 'Добавить напиток' : 'Добавить перерыв');
  return `<div class="repeat" data-repeat="${escape(type)}" data-key="${escape(key)}">
    <h3>${escape(label)}</h3><div class="repeat-items">${values.map(value => row(type, value)).join('')}</div>
    <button class="button secondary" type="button" data-add>${escape(addLabel)}</button>
  </div>`;
}

function scalarField(spec, value) {
  const { key, label, type, min, max, integer } = spec;
  if (type === 'drinks' || type === 'breaks') return repeat(type, key, label, value);
  if (type === 'boolean' || type === 'select') {
    const choices = type === 'boolean'
      ? [{ value: 'true', label: 'Да' }, { value: 'false', label: 'Нет' }]
      : spec.options || [];
    return field(label, select(key, [{ value: '', label: 'Выберите' }, ...choices], value));
  }
  const attributes = type === 'number'
    ? `type="number" step="${integer ? 1 : "any"}"${min === undefined ? '' : ` min="${escape(min)}"`}${max === undefined ? '' : ` max="${escape(max)}"`}`
    : type === 'time' ? 'type="time" step="1"' : 'type="text" maxlength="500"';
  return field(label, input(key, value, attributes));
}

function checklist(category) {
  const checks = category?.checks || [];
  if (!checks.length) return '<p class="empty">Для этой категории пока нет пунктов проверки.</p>';
  return checks.map(check => {
    const entry = draft.observations[check.id] || {};
    const observed = entry.state === 'observed';
    return `<section class="check" data-check="${escape(check.id)}">
      <div class="check-heading"><div><h3 class="check-title" id="label-${escape(check.id)}">${escape(check.label)}</h3>
      ${check.hint ? `<p class="hint">${escape(check.hint)}</p>` : ''}</div>
      <div class="states" role="radiogroup" aria-labelledby="label-${escape(check.id)}">
      ${Object.entries(modes).map(([value, label]) =>
        `<label><input type="radio" name="state-${escape(check.id)}" value="${value}"${value === (entry.state || 'unknown') ? ' checked' : ''}><span>${label}</span></label>`,
      ).join('')}</div></div>
      <fieldset class="grid check-fields fieldset-reset"${observed ? '' : ' hidden disabled'}>
      ${check.fields.map(spec => scalarField(spec, entry.values?.[spec.key])).join('')}
      </fieldset></section>`;
  }).join('');
}

function readRows(repeater) {
  return Array.from(repeater?.querySelector('.repeat-items')?.children || [], row => (
    Object.fromEntries(Array.from(row.querySelectorAll('input,select,textarea'), control => [
      control.name, control.value.trim(),
    ]))
  ));
}

function applyRepeats(form, extra = {}) {
  form.addEventListener('click', event => {
    const button = event.target.closest('button[data-add],button[data-remove]');
    if (!button) return;
    const repeater = button.closest('[data-repeat]');
    if (button.hasAttribute('data-remove')) {
      const row = button.closest('.repeat-row');
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      (next?.querySelector('input,select') || repeater.querySelector('[data-add]')).focus();
    } else {
      const { repeat: type } = repeater.dataset;
      const renderer = extra[type] || specialRow;
      const items = repeater.querySelector('.repeat-items');
      items.insertAdjacentHTML('beforeend', renderer(type));
      items.lastElementChild.querySelector('input,select')?.focus();
    }
  });
}

function evidenceRow(_type, value = {}) {
  return `<div class="grid repeat-row">
    ${field('Время на записи', input('time', value.time, 'type="time"'))}
    ${field('Ссылка на запись', input('url', value.url, 'type="url" maxlength="2048" placeholder="https://"'))}
    ${field('Пояснение', input('note', value.note, 'maxlength="500"'))}
    <div class="row-actions"><button type="button" class="button quiet" data-remove>Удалить отметку</button></div>
  </div>`;
}

function readDraft(form, category) {
  const data = new FormData(form);
  for (const key of ['date', 'location', 'shift', 'subject', 'notes']) {
    draft[key] = data.get(key)?.trim() || '';
  }
  draft.evidence = readRows(form.querySelector('[data-repeat=evidence]')).filter(item => Object.values(item).some(Boolean));
  const observations = {};
  for (const check of category?.checks || []) {
    const state = data.get(`state-${check.id}`) || 'unknown';
    const values = {};
    if (state === 'observed') {
      const section = form.querySelector(`[data-check="${CSS.escape(check.id)}"]`);
      for (const spec of check.fields) {
        const { key, type } = spec;
        if (type === 'drinks' || type === 'breaks') {
          values[key] = readRows(section.querySelector(`[data-key="${CSS.escape(key)}"]`));
          continue;
        }
        const value = section.querySelector(`[name="${CSS.escape(key)}"]`).value.trim();
        if (value === '') continue;
        values[key] = type === 'number' ? Number(value) : type === 'boolean' ? value === 'true' : value;
      }
    }
    observations[check.id] = { state, values };
  }
  draft.observations = observations;
}

function renderCheck(main) {
  draft ||= blankDraft();
  const editedId = draft.id;
  const formCatalog = draft.historicalCatalog || catalog;
  const category = formCatalog.categories.find(item => item.id === draft.category);
  main.innerHTML = `${pageHead(editedId ? 'Редактировать проверку' : 'Новая проверка')}
    <form id="check-form" class="flow">
    <div class="panel grid metadata">
      ${field('Дата', input('date', draft.date, 'type="date" required'))}
      ${field('Точка', input('location', draft.location, 'required maxlength="100"'))}
      ${field('Смена', input('shift', draft.shift, 'required maxlength="80"'))}
      ${field('Сотрудник или стол', input('subject', draft.subject, 'maxlength="120" required'))}
      ${field('Категория', select('category', categoryOptions(), draft.category, editedId ? 'disabled' : 'required'))}
    </div>
    <section aria-labelledby="checklist-title">
      <div class="section-head"><h2 id="checklist-title">${escape(category?.label || 'Пункты проверки')}</h2></div>
      <div class="panel checklist">${checklist(category)}</div>
    </section>
    <section class="panel flow">
      ${field('Комментарий к проверке', note('notes', draft.notes, 'maxlength="2000"'))}
      ${repeat('evidence', 'evidence', 'Подтверждение', draft.evidence, evidenceRow, 'Добавить отметку')}
    </section>
    <datalist id="drink-names">${options((formCatalog.settings?.drinkLimits || []).map(({ name }) => ({ value: name, label: name })))}</datalist>
    <div class="actions"><button type="submit" class="button">Сохранить проверку</button>
      ${editedId ? '<button type="button" class="button quiet" id="cancel-edit">Отменить правки</button>' : ''}
    </div>${statusLine}
    </form>`;
  const form = main.querySelector('form');
  applyRepeats(form, { evidence: evidenceRow });
  form.addEventListener('save-draft', () => { if (draft?.id === editedId && draft) readDraft(form, category); });
  form.addEventListener('change', event => {
    const { target } = event;
    if (target.name === 'category') {
      readDraft(form, category);
      draft.category = target.value;
      draft.observations = {};
      renderCheck(main);
      main.querySelector('[name=category]').focus();
    }
    if (target.type === 'radio') {
      const fields = target.closest('[data-check]').querySelector('fieldset');
      fields.hidden = fields.disabled = target.value !== 'observed';
    }
  });
  main.querySelector('#cancel-edit')?.addEventListener('click', () => {
    draft = undefined;
    go('report', editedId);
  });
  form.onsubmit = async event => {
    event.preventDefault();
    readDraft(form, category);
    const payload = { ...draft };
    delete payload.id;
    delete payload.historicalCatalog;
    if (!payload.location || !payload.shift || !payload.subject) return status('Укажите точку, смену и сотрудника или стол.', 'error');
    if (payload.evidence.some(item => item.url && !/^https:\/\//i.test(item.url))) {
      return status('Укажите ссылку на запись с https://.', 'error');
    }
    const normalized = JSON.stringify({ ...payload, requestId: undefined });
    if (previousPayload?.requestId === payload.requestId && previousPayload.normalized !== normalized) {
      payload.requestId = draft.requestId = crypto.randomUUID();
    }
    previousPayload = { normalized, requestId: payload.requestId };
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    status('Сохраняем проверку…');
    const version = screen;
    try {
      const result = await api(editedId ? `/reports/${encodeURIComponent(editedId)}` : '/reports', {
        method: editedId ? 'PUT' : 'POST', body: payload,
      });
      if (screen !== version) return;
      draft = undefined;
      await go('report', result.report?.id || result.id || editedId);
      status('Проверка сохранена.', 'success');
    } catch (error) {
      if (screen === version) status(error.message, 'error');
      button.disabled = false;
    }
  };
}

function tag(value) {
  return `<span class="tag" data-status="${escape(value)}">${escape(statusLabels[value] || value)}</span>`;
}

const formatMinutes = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 }).format;

function resultsList(results = []) {
  if (!results.length) return '<p class="empty">Нет результатов проверки.</p>';
  return `<ul class="results">${results.map(item => `<li>
    <strong>${escape(item.label)}</strong>${item.review ? '<span class="tag" data-status="fail">Требует проверки</span>' : tag(item.status)}
    ${item.detail ? `<p class="muted wrap">${escape(item.detail)}</p>` : ''}
    ${item.drinks?.length ? `<ul class="drink-results">${item.drinks.map(drink => `<li><span>${escape(drink.name || 'Напиток')}</span>
      <span>${Number.isFinite(drink.minutes) ? `${escape(formatMinutes(drink.minutes))} мин` : ''}</span>
      ${tag(drink.status || 'measured')}</li>`).join('')}</ul>` : ''}
    </li>`).join('')}</ul>`;
}

function listFacts(items, className = 'report-meta') {
  return `<dl class="${className}">${items.map(([name, value]) =>
    `<div><dt>${escape(name)}</dt><dd>${escape(value ?? '—')}</dd></div>`,
  ).join('')}</dl>`;
}

function reportLabel(report) {
  return catalog.categories.find(item => item.id === report.category)?.label || report.category;
}

function evidenceList(evidence) {
  return `<ul class="evidence">${evidence.map(item => `<li>
    ${item.time ? `<time>${escape(item.time)}</time> ` : ''}
    ${item.note ? `<span class="wrap">${escape(item.note)}</span> ` : ''}
    ${/^https:\/\/\S+$/i.test(item.url) ? `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">Открыть запись</a>` : escape(item.url)}
  </li>`).join('')}</ul>`;
}

function notifications(report) {
  return ({ pending: 'В очереди', sent: 'Отправлено', retrying: 'Повтор отправки' })[report.notification] || '—';
}

function authorName(author) {
  if (typeof author === 'object') return author?.name || author?.id || '';
  return ({ kseniya: 'Ксения', owner: 'Владелец' })[author] || author || '';
}

function journalQuery() {
  const query = new URLSearchParams(Object.entries(reportFilters).filter(([, value]) => value));
  return query.size ? '?' + query : '';
}

function renderJournal(main, version) {
  main.innerHTML = `${pageHead('Журнал проверок')}
    <div class="flow">
      <form class="panel flow" id="filters">
        <div class="grid filters">
        ${field('С даты', input('from', reportFilters.from, 'type="date"'))}
        ${field('По дату', input('to', reportFilters.to, 'type="date"'))}
        ${field('Категория', select('category', [{ value: '', label: 'Все категории' }, ...categoryOptions()], reportFilters.category))}
        ${field('Результат', select('status', [{ value: '', label: 'Все результаты' },
          ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))], reportFilters.status))}
        ${field('Поиск', input('search', reportFilters.search, 'type="search" placeholder="Точка или сотрудник" maxlength="150"'))}
        </div>
        <div class="actions"><button class="button">Применить</button>
        <button class="button quiet" id="reset" type="button">Сбросить</button>
        <button class="button secondary" id="export" type="button">Скачать CSV</button></div>
        ${statusLine}
      </form>
      <section class="panel" id="summary" aria-label="Сводка" aria-busy="true"><p class="muted">Загружаем сводку…</p></section>
      <section class="panel" id="records" aria-label="Проверки" aria-busy="true"><p class="muted">Загружаем проверки…</p></section>
    </div>`;
  let filterRevision = 0;
  const form = main.querySelector('form');
  const summary = main.querySelector('#summary');
  const records = main.querySelector('#records');
  async function load() {
    const revision = ++filterRevision;
    const query = journalQuery();
    status('');
    summary.setAttribute('aria-busy', 'true');
    records.setAttribute('aria-busy', 'true');
    summary.innerHTML = '<p class="muted">Загружаем сводку…</p>';
    records.innerHTML = '<p class="muted">Загружаем проверки…</p>';
    const [reports, totals] = await Promise.allSettled([api('/reports' + query), api('/summary' + query)]);
    if (version !== screen || revision !== filterRevision) return;
    summary.removeAttribute('aria-busy');
    records.removeAttribute('aria-busy');
    if (totals.status === 'fulfilled') {
      const { total, failures, unknown, averageDrinks = [] } = totals.value;
      summary.innerHTML = `<h2>Сводка</h2>
        ${listFacts([['Проверки', total], ['Нарушения', failures], ['Без данных', unknown]], 'stats')}
        ${averageDrinks.length ? `<div class="eyeline"><h3>Среднее время подачи напитков</h3>
        ${listFacts(averageDrinks.map(item => [item.name, `${formatMinutes(item.averageMinutes)} мин · ${item.count} зам.`]))}</div>` : ''}`;
    } else {
      summary.innerHTML = '<p class="empty">Сводка недоступна.</p>';
    }
    if (reports.status === 'rejected') {
      records.innerHTML = '<p class="empty">Проверки не загрузились.</p>';
      status(reports.reason.message, 'error');
      return;
    }
    const items = reports.value.reports || [];
    records.innerHTML = items.length ? items.map(report => {
      const failed = (report.results || []).filter(item => item.status === 'fail').length;
      return `<article class="record"><div><h3>${escape(reportLabel(report))} · ${escape(report.location)}</h3>
        <p class="muted">${[displayDate(report.date), report.shift, report.subject].filter(Boolean).map(escape).join(' · ')}</p>
        ${failed ? `<span class="tag" data-status="fail">Нарушений: ${failed}</span>` : ''}
        ${report.reaction && report.reaction !== 'none' ? `<span class="tag">${escape(reactionLabels[report.reaction])}</span>` : ''}
        </div><button class="button quiet" type="button" data-report="${escape(report.id)}" aria-label="Открыть проверку · ${escape(report.location)} · ${escape(displayDate(report.date))}">Открыть</button></article>`;
    }).join('') : '<p class="empty">Проверок по выбранным фильтрам нет.</p>';
  }
  records.addEventListener('click', event => {
    const button = event.target.closest('[data-report]');
    if (button) go('report', button.dataset.report);
  });
  form.onsubmit = event => {
    event.preventDefault();
    const nextFilters = Object.fromEntries(new FormData(form));
    if (nextFilters.from && nextFilters.to && nextFilters.from > nextFilters.to) {
      return status('Дата начала должна быть не позже даты окончания.', 'error');
    }
    reportFilters = nextFilters;
    load();
  };
  main.querySelector('#reset').onclick = () => {
    reportFilters = {};
    go('journal');
  };
  main.querySelector('#export').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    status('Готовим CSV…');
    try {
      const blob = await api('/export' + journalQuery(), { download: true });
      if (screen !== version) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'totem-ovn.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status('CSV загружен.', 'success');
    } catch (error) {
      if (screen === version) status(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  };
  return load();
}

const historyLabels = { created: 'Создано', edit: 'Изменено', reaction: 'Отметка владельца' };

async function renderReport(main, id, version) {
  const backButton = '<button type="button" class="button quiet" id="journal-back">К журналу</button>';
  main.innerHTML = `${pageHead('Проверка', '', backButton)}${statusLine}`;
  main.querySelector('#journal-back').onclick = () => go('journal');
  status('Загружаем проверку…');
  try {
    const { report, history = [], catalog: historicalCatalog } = await api(`/reports/${encodeURIComponent(id)}`);
    if (screen !== version) return;
    main.innerHTML = `${pageHead(reportLabel(report), '', backButton)}
      <div class="flow"><section class="panel">
        ${listFacts([['Дата', displayDate(report.date)], ['Точка', report.location], ['Смена', report.shift],
          ['Сотрудник или стол', report.subject || null], ['Автор', authorName(report.createdBy)],
          ['Уведомление владельцу', notifications(report)],
          ['Отметка владельца', reactionLabels[report.reaction || 'none']]])}
        <div class="actions"><button type="button" class="button" id="edit-report">Редактировать</button>
        ${user.role === 'owner' ? `<form id="reaction" class="row-actions">
          ${field('Отметка владельца', select('reaction', Object.entries(reactionLabels).map(([value, label]) => ({ value, label })), report.reaction || 'none'))}
          <button class="button secondary">Сохранить отметку</button></form>` : ''}</div>
        ${statusLine}
      </section>
      <section class="panel"><h2>Результаты</h2>${resultsList(report.results)}</section>
      ${report.notes || report.evidence?.length ? `<section class="panel flow">
        ${report.notes ? `<div><h2>Комментарий</h2><p class="wrap">${escape(report.notes)}</p></div>` : ''}
        ${report.evidence?.length ? `<div><h2>Подтверждение</h2>${evidenceList(report.evidence)}</div>` : ''}
        </section>` : ''}
      <section class="panel flow"><h2>История</h2>
        ${history.length ? history.map(event => `<details class="eyeline"><summary>
        ${escape(historyLabels[event.action] || 'Запись истории')} · ${escape(displayDate(event.at))} · ${escape(authorName(event.actor))}
        </summary>${event.report ? `
        ${listFacts([['Версия', event.report.revision], ['Смена', event.report.shift], ['Отметка', reactionLabels[event.report.reaction || 'none']]])}
        ${resultsList(event.report.results)}
        ${event.report.notes ? `<p class="wrap">${escape(event.report.notes)}</p>` : ''}
        ${event.report.evidence?.length ? evidenceList(event.report.evidence) : ''}
        ` : ''}</details>`).join('') : '<p class="empty">История пока пуста.</p>'}
      </section></div>`;
    main.querySelector('#journal-back').onclick = () => go('journal');
    main.querySelector('#edit-report').onclick = () => {
      const { date, location, shift, subject, category, observations, notes, evidence, revision } = report;
      draft = { id, date, location, shift, subject, category, historicalCatalog, observations: observations || {}, notes, evidence: evidence || [], revision, requestId: crypto.randomUUID() };
      go('check');
    };
    const reactionForm = main.querySelector('#reaction');
    if (reactionForm) reactionForm.onsubmit = async event => {
      event.preventDefault();
      const button = reactionForm.querySelector('button');
      button.disabled = true;
      try {
        await api(`/reports/${encodeURIComponent(id)}/reaction`, {
          method: 'POST', body: Object.fromEntries(new FormData(reactionForm)),
        });
        if (version !== screen) return;
        await go('report', id);
        status('Отметка сохранена.', 'success');
      } catch (error) {
        if (version === screen) status(error.message, 'error');
        button.disabled = false;
      }
    };
  } catch (error) {
    if (version === screen) status(error.message, 'error');
  }
}

function drinkLimitRow(_type, row = {}) {
  return `<div class="grid repeat-row">
    ${field('Напиток', input('name', row.name, 'maxlength="100" required'))}
    ${field('Норматив, мин', input('minutes', row.minutes, 'type="number" min="1" max="1440" step="any"'))}
    <button type="button" class="button quiet" data-remove>Удалить напиток</button>
    </div>`;
}

function settingsCheckRow(_type, row = {}) {
  return `<div class="grid repeat-row">
    ${field('Пункт проверки', input('label', row.label, 'maxlength="120" required'))}
    <input type="hidden" name="id" value="${escape(row.id || crypto.randomUUID())}">
    <button type="button" class="button quiet" data-remove>Удалить пункт</button>
    </div>`;
}

function renderSettings(main, version) {
  if (user.role !== 'owner') return go('check');
  const settings = catalog.settings || {};
  const limitFields = [
    ['serveLimit', 'Подача кальяна, мин'], ['cleanupLimit', 'Уборка кальяна, мин'],
    ['roundLimit', 'Обход зала, мин'], ['co2Threshold', 'Порог CO₂, ppm'],
  ];
  main.innerHTML = `${pageHead('Нормативы', 'Пустое поле означает, что порог ещё не задан. Пункты открытия и закрытия можно заменить утверждённым чек-листом.')}
    <form class="flow" id="settings-form">
      <section class="panel flow"><h2>Пороги</h2><div class="grid">${limitFields.map(([key, label]) =>
        field(label, input(key, settings[key] ?? '', `type="number" min="${key === 'co2Threshold' ? '250' : '1'}" max="${key === 'co2Threshold' ? '20000' : '1440'}" step="${key === 'co2Threshold' ? '1' : 'any'}"`)),
      ).join('')}</div></section>
      <section class="panel">${repeat('drinkLimits', 'drinkLimits', 'Подача напитков', settings.drinkLimits, drinkLimitRow, 'Добавить напиток')}</section>
      <section class="panel">${repeat('opening', 'opening', 'Открытие смены', settings.opening, settingsCheckRow, 'Добавить пункт')}</section>
      <section class="panel">${repeat('closing', 'closing', 'Закрытие смены', settings.closing, settingsCheckRow, 'Добавить пункт')}</section>
      <button type="submit" class="button">Сохранить нормативы</button>${statusLine}
    </form>`;
  const form = main.querySelector('form');
  applyRepeats(form, { drinkLimits: drinkLimitRow, opening: settingsCheckRow, closing: settingsCheckRow });
  form.onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(form);
    const nextSettings = { ...settings };
    for (const [key] of limitFields) nextSettings[key] = data.get(key) === '' ? null : Number(data.get(key));
    for (const key of ['drinkLimits', 'opening', 'closing']) {
      nextSettings[key] = readRows(form.querySelector(`[data-key=${key}]`));
    }
    for (const row of nextSettings.drinkLimits) row.minutes = row.minutes === '' ? null : Number(row.minutes);
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    status('Сохраняем нормативы…');
    try {
      await api('/settings', { method: 'PUT', body: { settings: nextSettings } });
      const refreshed = await api('/catalog');
      if (version !== screen) return;
      catalog = refreshed;
      renderSettings(main, version);
      status('Нормативы сохранены.', 'success');
    } catch (error) {
      if (version === screen) status(error.message, 'error');
      button.disabled = false;
    }
  };
}

function renderCo2(main, version) {
  main.innerHTML = `${pageHead('CO₂')}
    <div class="flow">
      <form class="panel flow" id="co2-form">
        <h2>Ручной замер</h2>
        <div class="grid metadata">
        ${field('Точка', input('location', '', 'required maxlength="100"'))}
        ${field('Уровень, ppm', input('ppm', '', 'type="number" min="250" max="20000" step="1" required'))}
        ${field('Дата и время замера (МСК)', input('observedAt', '', 'type="datetime-local"'))}
        </div><button class="button">Сохранить замер</button>${statusLine}
      </form>
      <section class="panel" id="readings" aria-label="Журнал CO₂" aria-busy="true">
        <p class="muted">Загружаем замеры…</p>
      </section>
    </div>`;
  const form = main.querySelector('form');
  const readingsList = main.querySelector('#readings');
  const readingsById = new Map();
  async function load() {
    try {
      const { readings = [], threshold } = await api('/co2');
      if (version !== screen) return;
      readingsById.clear();
      readings.forEach(reading => readingsById.set(String(reading.id), reading));
      readingsList.removeAttribute('aria-busy');
      readingsList.innerHTML = `<h2>Журнал замеров</h2>
        <p class="hint">${threshold == null ? 'Порог пока не задан.' : `Порог · ${escape(threshold)} ppm`}</p>
        <div class="eyeline">${readings.length ? readings.map(item => {
          const high = threshold != null && item.ppm > threshold;
          return `<article class="record"><div><h3>${escape(item.ppm)} ppm · ${escape(item.location)}</h3>
            <p class="muted">${escape(displayDate(item.observedAt))} · ${item.source === 'sensor' ? 'Датчик' : 'Ручной замер'}</p>
            ${high ? '<span class="tag" data-status="fail">Выше порога</span>' : ''}
            </div>${high && user.role === 'owner' ? `<div class="row-actions">
            <button class="button quiet" type="button" data-co2-notify="${escape(item.id)}">В Telegram</button>
            <button class="button quiet" type="button" data-co2-copy="${escape(item.id)}">Скопировать для смены</button>
            </div>` : ''}</article>`;
        }).join('') : '<p class="empty">Пока нет замеров.</p>'}</div>`;
    } catch (error) {
      if (version !== screen) return;
      readingsList.removeAttribute('aria-busy');
      readingsList.innerHTML = '<p class="empty">Журнал замеров недоступен.</p>';
      status(error.message, 'error');
    }
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const data = new FormData(form);
    const location = data.get('location').trim();
    const time = data.get('observedAt');
    if (!location) return status('Укажите точку.', 'error');
    const body = { location, ppm: Number(data.get('ppm')) };
    if (time) body.observedAt = new Date(time + ':00+03:00').toISOString();
    button.disabled = true;
    try {
      await api('/co2', { method: 'POST', body });
      if (version !== screen) return;
      form.reset();
      status('Замер сохранён.', 'success');
      await load();
    } catch (error) {
      if (version === screen) status(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  };
  readingsList.addEventListener('click', async event => {
    const button = event.target.closest('[data-co2-notify],[data-co2-copy]');
    if (!button) return;
    button.disabled = true;
    const localStatus = document.createElement('p');
    localStatus.className = 'status-line';
    localStatus.setAttribute('role', 'status');
    const record = button.closest('article');
    record.querySelector('.status-line')?.remove();
    record.append(localStatus);
    try {
      if (button.dataset.co2Copy) {
        const reading = readingsById.get(button.dataset.co2Copy);
        await navigator.clipboard.writeText(`CO₂ выше порога: ${reading.ppm} ppm · ${reading.location} · ${displayDate(reading.observedAt)}. Проверьте вентиляцию и повторите замер.`);
        localStatus.textContent = 'Сообщение скопировано.';
      } else {
        await api(`/co2/${encodeURIComponent(button.dataset.co2Notify)}/notify`, { method: 'POST' });
        localStatus.textContent = 'Уведомление поставлено в очередь.';
      }
    } catch (error) {
      localStatus.textContent = error.message;
      localStatus.dataset.tone = 'error';
    } finally {
      button.disabled = false;
    }
  });
  return load();
}

renderLogin();

const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
if (invite !== null) {
  history.replaceState(null, '', location.pathname + location.search);
  void openInvitation(invite);
}
