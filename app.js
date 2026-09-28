// ===== Навигация =====
const screens = {
  summary:    { el: 'screen-summary',    title: 'Сводка',    isRoot: true },
  portfolios: { el: 'screen-portfolios', title: 'Портфели',  isRoot: true },
  more:       { el: 'screen-more',       title: 'Ещё',       isRoot: true },
  graphs:     { el: 'screen-graphs',     title: 'Графики',   isRoot: false },
  import:     { el: 'screen-import',     title: 'Импорт',    isRoot: false },
  taxes:      { el: 'screen-taxes',      title: 'Налоги',    isRoot: false },
  trades:     { el: 'screen-trades',     title: 'Сделки',    isRoot: false },
  operations: { el: 'screen-operations', title: 'Операции',  isRoot: false },
  settings:   { el: 'screen-settings',   title: 'Настройки', isRoot: false },
};

let currentScreen = 'summary';
const history = [];

function navigate(screenKey, addToHistory = true) {
  const screen = screens[screenKey];
  if (!screen) return;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screen.el).classList.add('active');

  document.getElementById('appBarTitle').textContent = screen.title;

  const backBtn = document.getElementById('backBtn');
  if (screen.isRoot) {
    backBtn.classList.add('hidden');
    history.length = 0;
  } else {
    backBtn.classList.remove('hidden');
    if (addToHistory) history.push(currentScreen);
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === screenKey);
  });

  document.getElementById('content').scrollTop = 0;
  currentScreen = screenKey;
}

function goBack() {
  const prev = history.pop();
  if (prev) {
    navigate(prev, false);
  } else {
    navigate('more', false);
  }
}

// ===== Инициализация базы данных =====
function setDbStatus(text, isError = false) {
  const el = document.getElementById('dbStatus');
  if (el) {
    el.textContent = text;
    el.style.color = isError ? 'var(--negative)' : 'var(--positive)';
  }
}

async function initDatabase() {
  try {
    setDbStatus('Инициализация...');
    const msg = await window.db.init();
    const accounts = await window.db.select('SELECT * FROM accounts');
    console.log('[db] Готово. Счетов в базе:', accounts.length);
    setDbStatus('OK · счетов: ' + accounts.length);
  } catch (err) {
    console.error('[db] Ошибка:', err);
    setDbStatus('Ошибка: ' + err.message, true);
  }
}

// ===== Импорт .xlsx — Этап 3.1 =====

// Определение типа отчёта по имени листа и содержимому
function detectReportType(workbook) {
  const sheetName = workbook.SheetNames[0] || '';
  const sheet = workbook.Sheets[sheetName];

  // Пробуем найти ключевые заголовки в первых 5 строках
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const maxRow = Math.min(range.e.r, 5);
  let firstText = '';
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= Math.min(range.e.c, 20); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v) firstText += ' ' + String(cell.v);
    }
  }

  if (sheetName === 'Сводный налоговый отчет' || /налогооблагаем/i.test(firstText)) {
    return 'tax';
  }
  if (sheetName === 'brokerage_report' || /о сделках, операциях и состоянии счетов/i.test(firstText)) {
    return 'brokerage';
  }
  return 'unknown';
}

// Простой предпросмотр структуры файла
function buildPreview(fileName, workbook) {
  const type = detectReportType(workbook);
  const typeLabel = {
    tax: 'Налоговый отчёт',
    brokerage: 'Отчёт о сделках и счетах',
    unknown: 'Неизвестный тип'
  }[type];

  // Собираем инфо по листам
  const sheetsInfo = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const rows = range.e.r + 1;
    const cols = range.e.c + 1;
    return `<li><b>${name}</b> — ${rows} строк, ${cols} колонок</li>`;
  }).join('');

  // Находим верхнюю строку-заголовок (первую непустую)
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  let headersRow = -1;
  for (let r = 0; r <= Math.min(range.e.r, 30); r++) {
    let nonEmpty = 0;
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') nonEmpty++;
    }
    if (nonEmpty >= 3) { headersRow = r; break; }
  }

  let headersHtml = '<i>заголовки не найдены</i>';
  if (headersRow >= 0) {
    const headers = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: headersRow, c })];
      const v = cell && cell.v !== undefined ? String(cell.v).trim() : '';
      if (v) headers.push(v);
    }
    headersHtml = headers.map(h => `<span class="chip">${h}</span>`).join(' ');
  }

  return `
    <div class="import-file-name">📄 ${fileName}</div>
    <div class="import-row"><span>Тип отчёта</span><span>${typeLabel}</span></div>
    <div class="import-row"><span>Листов в файле</span><span>${workbook.SheetNames.length}</span></div>
    <ul class="import-sheets">${sheetsInfo}</ul>
    <div class="import-headers-label">Первые заголовки:</div>
    <div class="import-headers">${headersHtml}</div>
    <div class="import-note">Парсинг данных будет на следующем подэтапе.</div>
  `;
}

function setPreview(html, isError = false) {
  const el = document.getElementById('importPreview');
  if (!el) return;
  el.innerHTML = html;
  el.style.borderLeft = isError ? '4px solid var(--negative)' : '4px solid var(--primary)';
}

async function handleFile(file) {
  if (!file) return;

  setPreview('<div class="placeholder">Чтение файла...</div>');

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    console.log('[xlsx] Прочитан:', file.name, 'Листов:', workbook.SheetNames.length);

    const html = buildPreview(file.name, workbook);
    setPreview(html);
  } catch (err) {
    console.error('[xlsx] Ошибка:', err);
    setPreview(
      `<div class="import-file-name">📄 ${file.name}</div>
       <div class="import-error">Ошибка чтения файла: ${err.message}</div>`,
      true
    );
  }
}

// ===== Обработчики =====
document.addEventListener('DOMContentLoaded', () => {

  // Заменяем символ ₽ на SVG-иконку
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('₽')) nodes.push(walker.currentNode);
  }
  nodes.forEach(node => {
    const parts = node.nodeValue.split('₽');
    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      frag.appendChild(document.createTextNode(part));
      if (i < parts.length - 1) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'rub-icon');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-rub');
        svg.appendChild(use);
        frag.appendChild(svg);
      }
    });
    node.parentNode.replaceChild(frag, node);
  });

  // Нижняя навигация
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });

  // Пункты меню "Ещё"
  document.querySelectorAll('.menu-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });

  // Кнопка "Назад"
  document.getElementById('backBtn').addEventListener('click', goBack);

  // Переключатель "Сводно / По счетам"
  document.querySelectorAll('.toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Стартовый экран
  navigate('summary');

  // Инициализация базы
  initDatabase();

  // Импорт файла
  const importBtn = document.getElementById('importBtn');
  const fileInput = document.getElementById('fileInput');
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      handleFile(file);
      // Сбрасываем input, чтобы можно было выбрать тот же файл повторно
      e.target.value = '';
    });
  }
});

// ===== Обработка системной кнопки "Назад" на Android =====
window.addEventListener('popstate', () => {
  if (!screens[currentScreen].isRoot) {
    goBack();
  }
});

history.pushState({}, '');
window.addEventListener('popstate', () => {
  if (!screens[currentScreen].isRoot) {
    goBack();
    history.pushState({}, '');
  }
});