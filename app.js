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
  if (prev) navigate(prev, false);
  else navigate('more', false);
}

// ===== База =====
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
    await window.db.init();
    const accounts = await window.db.select('SELECT * FROM accounts');
    console.log('[db] Готово. Счетов:', accounts.length);
    setDbStatus('OK · счетов: ' + accounts.length);
  } catch (err) {
    console.error('[db] Ошибка:', err);
    setDbStatus('Ошибка: ' + err.message, true);
  }
}

// ===== Утилиты =====

function toIsoDate(v) {
  if (v == null || v === '') return null;

  if (typeof v === 'object' && typeof v.getFullYear === 'function') {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400) * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  const months = {
    Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
    Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12'
  };
  m = s.match(/^[A-Za-z]+ ([A-Za-z]{3}) (\d{1,2}) (\d{4})/);
  if (m && months[m[1]]) {
    return `${m[3]}-${months[m[1]]}-${String(m[2]).padStart(2,'0')}`;
  }

  return null;
}

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function toKopecks(v) {
  const n = toNumber(v);
  return n == null ? null : Math.round(n * 100);
}

function makeCashHash(op) {
  return [op.operation_date, op.amount_kopecks, op.currency, op.operation_type, op.comment || ''].join('|');
}

function formatRub(kopecks) {
  if (kopecks == null) return '—';
  const rub = kopecks / 100;
  const s = Math.abs(rub).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (rub < 0 ? '−' : '') + s;
}

function formatNum(n, digits = 2) {
  if (n == null) return '—';
  return n.toFixed(digits).replace('.', ',');
}

// ===== Парсер «Движение денежных средств» =====

function findCashHeaderRow(sheet, r, range) {
  let dateCol = -1, sumCol = -1, currCol = -1, typeCol = -1, commentCol = -1;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    const v = cell ? String(cell.v || '').trim() : '';
    if (/^Дата$/i.test(v)) dateCol = c;
    else if (/^Сумма$/i.test(v)) sumCol = c;
    else if (/^Валюта$/i.test(v)) currCol = c;
    else if (/^Тип операции$/i.test(v)) typeCol = c;
    else if (/^Комментарий$/i.test(v)) commentCol = c;
  }
  if (dateCol >= 0 && sumCol >= 0 && currCol >= 0 && typeCol >= 0) {
    return { date: dateCol, sum: sumCol, currency: currCol, type: typeCol, comment: commentCol };
  }
  return null;
}

function parseCashOperations(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  let headerRow = -1;
  let cols = null;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const idx = findCashHeaderRow(sheet, r, range);
    if (idx) { headerRow = r; cols = idx; break; }
  }

  if (headerRow < 0) {
    return { operations: [], errors: ['Таблица «Движение денежных средств» не найдена'], marketBreakdown: {}, period: null };
  }

  const operations = [];
  const errors = [];
  const marketBreakdown = {};
  let market = null;
  let emptyRun = 0;
  let firstDate = null;
  let lastDate = null;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const rowCells = {};
    const nonEmptyVals = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      rowCells[c] = cell ? cell.v : null;
      const sv = cell && cell.v != null ? String(cell.v).trim() : '';
      if (sv !== '') nonEmptyVals.push(sv);
    }
    const rowText = nonEmptyVals.join(' ').replace(/\s+/g, ' ');

    if (nonEmptyVals.length >= 1 && nonEmptyVals.length <= 2) {
      const joined = nonEmptyVals.join(' ');
      if (/^(Основной|Срочный|Внебиржевой)\s+рынок/i.test(joined)) {
        if (/Основной/i.test(joined)) market = 'Основной рынок';
        else if (/Срочный/i.test(joined)) market = 'Срочный рынок';
        else if (/Внебирж/i.test(joined)) market = 'Внебиржевой рынок';
        console.log('[parser] Раздел:', market, '(строка', r + 1, ')');
        continue;
      }
    }

    if (nonEmptyVals.length === 0) {
      emptyRun++;
      if (emptyRun >= 5) break;
      continue;
    }
    emptyRun = 0;

    const headerHits = [
      'Наименование ценной бумаги',
      'Дата и время заключения',
      'Входящий остаток',
      'Валюта цены',
      'Площадка'
    ].filter(h => rowText.includes(h)).length;
    if (headerHits >= 2) break;

    const dateVal = rowCells[cols.date];
    const sumVal = rowCells[cols.sum];
    const currVal = rowCells[cols.currency];
    const typeVal = rowCells[cols.type];
    const commentVal = cols.comment >= 0 ? rowCells[cols.comment] : null;

    const isoDate = toIsoDate(dateVal);
    if (!isoDate) {
      if (typeVal || sumVal) {
        errors.push(`Строка ${r + 1}: не распознана дата «${String(dateVal)}»`);
      }
      continue;
    }

    const kopecks = toKopecks(sumVal);
    if (kopecks == null) {
      errors.push(`Строка ${r + 1}: не распознана сумма «${String(sumVal)}»`);
      continue;
    }

    const currency = String(currVal || 'RUB').trim().toUpperCase();
    const opType = typeVal != null ? String(typeVal).trim() : '';
    const comment = commentVal != null ? String(commentVal).trim() : '';

    const op = {
      date: isoDate,
      amount_kopecks: kopecks,
      currency: currency,
      operation_type: opType,
      comment: comment,
      market: market,
      row: r + 1
    };
    op.external_hash = makeCashHash(op);
    operations.push(op);

    const mKey = market || 'Без рынка';
    const tKey = opType || '—';
    if (!marketBreakdown[mKey]) marketBreakdown[mKey] = {};
    marketBreakdown[mKey][tKey] = (marketBreakdown[mKey][tKey] || 0) + 1;

    if (!firstDate || isoDate < firstDate) firstDate = isoDate;
    if (!lastDate || isoDate > lastDate) lastDate = isoDate;
  }

  return {
    operations,
    errors,
    marketBreakdown,
    period: firstDate ? { from: firstDate, to: lastDate } : null
  };
}

// ===== Парсер «Отчёт об остатках ценных бумаг» =====

const PAPER_TYPES = ['АКЦИЯ', 'ОБЛИГАЦИЯ', 'ЕВРООБЛИГАЦИЯ', 'ПАЙ'];

function parseSecurities(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  // 1. Ищем строку заголовка таблицы остатков ЦБ
  let headerRow = -1;
  for (let r = range.s.r; r <= range.e.r; r++) {
    let text = '';
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v) text += ' ' + String(cell.v);
    }
    if (/Наименование\s+ценной\s+бумаги/i.test(text) && /Входящий\s+остаток/i.test(text)) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) {
    return { positions: [], errors: ['Таблица «Отчёт об остатках ценных бумаг» не найдена'], typeStats: {}, currencyStats: {}, totalValueKopecks: 0 };
  }

  // 2. Извлекаем индексы колонок по тексту заголовков
  const cols = {
    name: -1, incoming: -1, change: -1, outgoing: -1, planned: -1,
    currency: -1, price: -1, nominal: -1, nkd: -1,
    paymentDate: -1, couponRate: -1,
    valueCurrency: -1, valueRub: -1, plannedValueRub: -1
  };

  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    const v = cell ? String(cell.v || '').trim() : '';
    if (!v) continue;

    if (/Наименование\s+ценной\s+бумаги/i.test(v)) cols.name = c;
    else if (/^Входящий\s+остаток/i.test(v)) cols.incoming = c;
    else if (/^Изменение\s+за\s+период/i.test(v)) cols.change = c;
    else if (/^Исходящий\s+остаток/i.test(v)) cols.outgoing = c;
    else if (/^Плановый\s+исходящий/i.test(v)) cols.planned = c;
    else if (/^Валюта/i.test(v) && /цены/i.test(v)) cols.currency = c;
    else if (/^Цена/i.test(v)) cols.price = c;
    else if (/^Номинал/i.test(v)) cols.nominal = c;
    else if (/^НКД/i.test(v)) cols.nkd = c;
    else if (/^Дата\s+выплаты/i.test(v)) cols.paymentDate = c;
    else if (/^Ставка\s+купона/i.test(v)) cols.couponRate = c;
    else if (/Оценка\s+исходящего/i.test(v) && /в\s+валюте/i.test(v)) cols.valueCurrency = c;
    else if (/Оценка\s+исходящего/i.test(v) && /руб/i.test(v)) cols.valueRub = c;
    else if (/Оценка\s+планового/i.test(v)) cols.plannedValueRub = c;
  }

  if (cols.name < 0 || cols.outgoing < 0) {
    return { positions: [], errors: ['Не найдены обязательные колонки в таблице остатков'], typeStats: {}, currencyStats: {}, totalValueKopecks: 0 };
  }

  const positions = [];
  const errors = [];
  const typeStats = {};
  const currencyStats = {};
  let currentType = null;
  let totalValueKopecks = 0;
  let emptyRun = 0;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const rowCells = {};
    const nonEmpty = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      rowCells[c] = cell ? cell.v : null;
      if (cell && cell.v != null && String(cell.v).trim() !== '') {
        nonEmpty.push({ c, v: String(cell.v).trim() });
      }
    }

    // Пустая строка
    if (nonEmpty.length === 0) {
      emptyRun++;
      if (emptyRun >= 10) break;
      continue;
    }
    emptyRun = 0;

    // Разделители и границы
    if (nonEmpty.length === 1) {
      const val = nonEmpty[0].v;
      // Тип бумаги
      if (PAPER_TYPES.includes(val.toUpperCase())) {
        currentType = val.toUpperCase();
        continue;
      }
      // ИТОГО — пропускаем
      if (/^ИТОГО/i.test(val)) continue;
      // Заголовок следующей таблицы — стоп
      if (/^(Движение\s+ценных|Заключенные|Завершенные|Сводная)/i.test(val)) break;
    }

    // Первая ячейка — наименование бумаги
    const nameCell = rowCells[cols.name];
    if (!nameCell) continue;
    const nameVal = String(nameCell).trim();
    if (!nameVal) continue;

    // Проверка, что это похоже на бумагу (содержит запятую)
    if (!nameVal.includes(',')) continue;

    // Разбираем наименование: «Name, reg_number, ISIN»
    const parts = nameVal.split(',').map(s => s.trim()).filter(Boolean);
    let name = parts[0] || nameVal;
    let regNumber = '';
    let isin = '';

    if (parts.length >= 3) {
      regNumber = parts[1];
      isin = parts[parts.length - 1];
    } else if (parts.length === 2) {
      const last = parts[1];
      if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(last)) isin = last;
      else regNumber = last;
    }
    if (!isin) {
      const m = nameVal.match(/([A-Z]{2}[A-Z0-9]{9}[0-9])/);
      if (m) isin = m[1];
    }

    const outgoing = toNumber(rowCells[cols.outgoing]);
    if (outgoing == null) continue;

    const incoming = cols.incoming >= 0 ? toNumber(rowCells[cols.incoming]) : null;
    const change = cols.change >= 0 ? toNumber(rowCells[cols.change]) : null;
    const planned = cols.planned >= 0 ? toNumber(rowCells[cols.planned]) : null;
    const currency = cols.currency >= 0 && rowCells[cols.currency] ? String(rowCells[cols.currency]).trim() : null;
    const price = cols.price >= 0 ? toNumber(rowCells[cols.price]) : null;
    const nominal = cols.nominal >= 0 ? toNumber(rowCells[cols.nominal]) : null;
    const nkd = cols.nkd >= 0 ? toNumber(rowCells[cols.nkd]) : null;
    const paymentDate = cols.paymentDate >= 0 ? toIsoDate(rowCells[cols.paymentDate]) : null;
    const couponRate = cols.couponRate >= 0 ? toNumber(rowCells[cols.couponRate]) : null;
    const valueCurrency = cols.valueCurrency >= 0 ? toNumber(rowCells[cols.valueCurrency]) : null;
    const valueRubKopecks = cols.valueRub >= 0 ? toKopecks(rowCells[cols.valueRub]) : null;
    const plannedValueRubKopecks = cols.plannedValueRub >= 0 ? toKopecks(rowCells[cols.plannedValueRub]) : null;

    const pos = {
      name, isin, reg_number: regNumber,
      type: currentType || '—',
      incoming_qty: incoming,
      change_qty: change,
      outgoing_qty: outgoing,
      planned_qty: planned,
      currency,
      price, nominal, nkd,
      coupon_rate: couponRate,
      payment_date: paymentDate,
      value_currency: valueCurrency,
      value_rub_kopecks: valueRubKopecks,
      planned_value_rub_kopecks: plannedValueRubKopecks,
      row: r + 1
    };
    positions.push(pos);

    const tKey = currentType || '—';
    typeStats[tKey] = (typeStats[tKey] || 0) + 1;

    const cKey = currency || '—';
    currencyStats[cKey] = (currencyStats[cKey] || 0) + 1;

    if (outgoing > 0 && valueRubKopecks != null) {
      totalValueKopecks += valueRubKopecks;
    }
  }

  return { positions, errors, typeStats, currencyStats, totalValueKopecks };
}

// ===== Импорт =====

function detectReportType(workbook) {
  const sheetName = workbook.SheetNames[0] || '';
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const maxRow = Math.min(range.e.r, 5);
  let firstText = '';
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= Math.min(range.e.c, 20); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v) firstText += ' ' + String(cell.v);
    }
  }
  if (sheetName === 'Сводный налоговый отчет' || /налогооблагаем/i.test(firstText)) return 'tax';
  if (sheetName === 'brokerage_report' || /о сделках, операциях и состоянии счетов/i.test(firstText)) return 'brokerage';
  return 'unknown';
}

function setPreview(html, isError = false) {
  const el = document.getElementById('importPreview');
  if (!el) return;
  el.innerHTML = html;
  el.style.borderLeft = isError ? '4px solid var(--negative)' : '4px solid var(--primary)';
}

// Порядок рынков
const MARKET_ORDER = {
  'Основной рынок': 0,
  'Срочный рынок': 1,
  'Внебиржевой рынок': 2,
  'Без рынка': 99
};

function sortByMarketOrder(keys) {
  return keys.sort((a, b) => (MARKET_ORDER[a] ?? 50) - (MARKET_ORDER[b] ?? 50));
}

// Порядок типов бумаг (как в файле брокера)
const PAPER_ORDER = {
  'АКЦИЯ': 0,
  'ЕВРООБЛИГАЦИЯ': 1,
  'ОБЛИГАЦИЯ': 2,
  'ПАЙ': 3
};

function sortByPaperOrder(keys) {
  return keys.sort((a, b) => (PAPER_ORDER[a] ?? 99) - (PAPER_ORDER[b] ?? 99));
}

function buildMarketBreakdownHtml(marketBreakdown) {
  const marketKeys = sortByMarketOrder(Object.keys(marketBreakdown));

  if (marketKeys.length === 0) {
    return '<div class="import-row"><span>—</span><span>0</span></div>';
  }

  return marketKeys.map(mkt => {
    const types = marketBreakdown[mkt];
    const total = Object.values(types).reduce((s, v) => s + v, 0);
    const typeRows = Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `<div class="import-row sub"><span>${t}</span><span>${c}</span></div>`)
      .join('');
    return `
      <div class="import-market-title">
        <span>${mkt}</span>
        <span class="import-market-total">${total}</span>
      </div>
      ${typeRows}
    `;
  }).join('');
}

function buildSampleOperationsHtml(operations) {
  const groups = {};
  for (const op of operations) {
    const mkt = op.market || 'Без рынка';
    if (!groups[mkt]) groups[mkt] = [];
    if (groups[mkt].length < 5) groups[mkt].push(op);
  }

  const marketKeys = sortByMarketOrder(Object.keys(groups));
  if (marketKeys.length === 0) return '';

  return marketKeys.map(mkt => {
    const opsHtml = groups[mkt].map(op => `
      <div class="op-row">
        <div class="op-header">
          <span class="op-date">${op.date}</span>
        </div>
        <div class="op-body">
          <div class="op-left">
            <div class="op-type">${op.operation_type || '—'}</div>
            ${op.comment ? `<div class="op-comment">${op.comment}</div>` : ''}
          </div>
          <div class="op-amount ${op.amount_kopecks < 0 ? 'negative' : 'positive'}">${formatRub(op.amount_kopecks)}</div>
        </div>
      </div>
    `).join('');

    return `
      <div class="op-market-group">
        <div class="op-market-group-title">${mkt}</div>
        <div class="op-list">${opsHtml}</div>
      </div>
    `;
  }).join('');
}

function buildSecuritiesPreviewHtml(sec) {
  if (sec.positions.length === 0) return '';

  const typeStatsHtml = sortByPaperOrder(Object.keys(sec.typeStats))
    .map(t => `<div class="import-row sub"><span>${t}</span><span>${sec.typeStats[t]}</span></div>`)
    .join('');

  // Группируем по типу и берём по 5 из каждого
  const groups = {};
  for (const p of sec.positions) {
    const t = p.type || '—';
    if (!groups[t]) groups[t] = [];
    if (groups[t].length < 5) groups[t].push(p);
  }

  const paperRows = sortByPaperOrder(Object.keys(groups)).map(type => {
    const items = groups[type].map(p => `
      <div class="pos-row">
        <div class="pos-name">${p.name}${p.isin ? ` <span class="pos-isin">${p.isin}</span>` : ''}</div>
        <div class="pos-meta">
          ${formatNum(p.outgoing_qty, 0)} шт
          ${p.price != null ? ` · ${formatNum(p.price, 4)} ${p.currency || ''}` : ''}
          ${p.value_rub_kopecks != null ? ` · ${formatRub(p.value_rub_kopecks)}` : ''}
        </div>
      </div>
    `).join('');

    return `
      <div class="op-market-group">
        <div class="op-market-group-title">${type}</div>
        <div class="pos-list">${items}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="import-section-title">Остатки ценных бумаг</div>
    <div class="import-big">${sec.positions.length}</div>

    <div class="import-section-title">По типам</div>
    ${typeStatsHtml}

    <div class="import-section-title">Итоговая стоимость портфеля</div>
    <div class="import-big">${formatRub(sec.totalValueKopecks)}</div>

    <div class="import-section-title">Примеры позиций (по 5 на тип)</div>
    ${paperRows}
  `;
}

function buildCashPreview(fileName, workbook, parsedCash, parsedSec) {
  const typeLabel = {
    tax: 'Налоговый отчёт',
    brokerage: 'Отчёт о сделках и счетах',
    unknown: 'Неизвестный тип'
  }[detectReportType(workbook)];

  const sheetsInfo = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    return `<li><b>${name}</b> — ${range.e.r + 1} строк, ${range.e.c + 1} колонок</li>`;
  }).join('');

  const opsCount = parsedCash.operations.length;
  const periodHtml = parsedCash.period ? `${parsedCash.period.from} → ${parsedCash.period.to}` : '<i>нет данных</i>';
  const marketBreakdownHtml = buildMarketBreakdownHtml(parsedCash.marketBreakdown);
  const sampleOperationsHtml = buildSampleOperationsHtml(parsedCash.operations);
  const securitiesHtml = parsedSec ? buildSecuritiesPreviewHtml(parsedSec) : '';

  const errorsHtml = parsedCash.errors.length
    ? `<div class="import-errors">
         <div class="import-headers-label">Ошибки операций (${parsedCash.errors.length}):</div>
         ${parsedCash.errors.slice(0, 5).map(e => `<div class="import-error">${e}</div>`).join('')}
         ${parsedCash.errors.length > 5 ? `<div class="import-note">…и ещё ${parsedCash.errors.length - 5}</div>` : ''}
       </div>`
    : '';

  return `
    <div class="import-file-name">📄 ${fileName}</div>
    <div class="import-row"><span>Тип отчёта</span><span>${typeLabel}</span></div>
    <div class="import-row"><span>Листов</span><span>${workbook.SheetNames.length}</span></div>
    <ul class="import-sheets">${sheetsInfo}</ul>

    ${securitiesHtml}

    <div class="import-section-title">Найдено денежных операций</div>
    <div class="import-big">${opsCount}</div>
    <div class="import-row"><span>Период</span><span>${periodHtml}</span></div>

    <div class="import-section-title">По рынкам и типам операций</div>
    ${marketBreakdownHtml}

    ${opsCount > 0 ? `
      <div class="import-section-title">Примеры операций (по 5 на каждый рынок)</div>
      ${sampleOperationsHtml}
    ` : ''}

    ${errorsHtml}

    <div class="import-note">Проверьте данные. Запись в базу будет на следующем шаге.</div>
  `;
}

async function handleFile(file) {
  if (!file) return;
  setPreview('<div class="placeholder">Чтение файла...</div>');

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    console.log('[xlsx] Прочитан:', file.name);

    const reportType = detectReportType(workbook);
    if (reportType === 'tax') {
      setPreview(`
        <div class="import-file-name">📄 ${file.name}</div>
        <div class="import-row"><span>Тип отчёта</span><span>Налоговый отчёт</span></div>
        <div class="import-note">Парсер налогового отчёта будет на подэтапе 3.3.</div>
      `);
      return;
    }
    if (reportType === 'brokerage') {
      const parsedCash = parseCashOperations(workbook);
      const parsedSec = parseSecurities(workbook);
      console.log('[parser] Операций:', parsedCash.operations.length,
                  '· ошибок операций:', parsedCash.errors.length,
                  '· позиций ЦБ:', parsedSec.positions.length,
                  '· ошибок ЦБ:', parsedSec.errors.length);
      setPreview(buildCashPreview(file.name, workbook, parsedCash, parsedSec));
      return;
    }
    setPreview(`<div class="import-file-name">📄 ${file.name}</div><div class="import-error">Не удалось определить тип отчёта</div>`, true);
  } catch (err) {
    console.error('[xlsx] Ошибка:', err);
    setPreview(
      `<div class="import-file-name">📄 ${file.name}</div>
       <div class="import-error">Ошибка: ${err.message}</div>`,
      true
    );
  }
}

// ===== Обработчики =====
document.addEventListener('DOMContentLoaded', () => {
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

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });
  document.querySelectorAll('.menu-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.querySelectorAll('.toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  navigate('summary');
  initDatabase();

  const importBtn = document.getElementById('importBtn');
  const fileInput = document.getElementById('fileInput');
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      handleFile(file);
      e.target.value = '';
    });
  }
});

window.addEventListener('popstate', () => {
  if (!screens[currentScreen].isRoot) goBack();
});
history.pushState({}, '');
window.addEventListener('popstate', () => {
  if (!screens[currentScreen].isRoot) {
    goBack();
    history.pushState({}, '');
  }
});