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
const navHistory = [];

function navigate(screenKey, addToHistory = true) {
  const screen = screens[screenKey];
  if (!screen) return;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screen.el).classList.add('active');
  document.getElementById('appBarTitle').textContent = screen.title;
  const backBtn = document.getElementById('backBtn');
  if (screen.isRoot) {
    backBtn.classList.add('hidden');
    navHistory.length = 0;
  } else {
    backBtn.classList.remove('hidden');
    if (addToHistory) navHistory.push(currentScreen);
  }
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === screenKey);
  });
  document.getElementById('content').scrollTop = 0;
  if (screenKey === 'settings') {
    refreshImportLog();
  }
  if (screenKey === 'operations') {
    if (!opState.loaded) {
      initOperationsScreen();
    } else {
      // Данные могли обновиться после импорта — перечитываем
      initOperationsScreen();
    }
  }
  if (screenKey === 'trades') {
    if (!trState.loaded) {
      initTradesScreen();
    } else {
      initTradesScreen();
    }
  }
  if (screenKey === 'portfolios') {
    if (!pfState.loaded) {
      initPortfoliosScreen();
    } else {
      initPortfoliosScreen();
    }
  }
  currentScreen = screenKey;
}

function goBack() {
  const prev = navHistory.pop();
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

    // После успешной инициализации — обновляем список импортов
    if (typeof refreshImportLog === 'function') {
      refreshImportLog();
    }
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

// Разбор наименования бумаги: «Name, reg_number, ISIN»
function splitSecurityName(nameVal) {
  const parts = String(nameVal).split(',').map(s => s.trim()).filter(Boolean);
  let name = parts[0] || String(nameVal);
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
    const m = String(nameVal).match(/([A-Z]{2}[A-Z0-9]{9}[0-9])/);
    if (m) isin = m[1];
  }
  return { name, reg_number: regNumber, isin };
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
  let headerRow = -1, cols = null;
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
  let firstDate = null, lastDate = null;

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
      'Наименование ценной бумаги', 'Дата и время заключения',
      'Входящий остаток', 'Валюта цены', 'Площадка'
    ].filter(h => rowText.includes(h)).length;
    if (headerHits >= 2) break;

    const dateVal = rowCells[cols.date];
    const sumVal = rowCells[cols.sum];
    const currVal = rowCells[cols.currency];
    const typeVal = rowCells[cols.type];
    const commentVal = cols.comment >= 0 ? rowCells[cols.comment] : null;

    const isoDate = toIsoDate(dateVal);
    if (!isoDate) {
      if (typeVal || sumVal) errors.push(`Строка ${r + 1}: не распознана дата «${String(dateVal)}»`);
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
      date: isoDate, amount_kopecks: kopecks, currency,
      operation_type: opType, comment, market, row: r + 1
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
    operations, errors, marketBreakdown,
    period: firstDate ? { from: firstDate, to: lastDate } : null
  };
}

// ===== Парсер «Отчёт об остатках ценных бумаг» =====

const PAPER_TYPES = ['АКЦИЯ', 'ОБЛИГАЦИЯ', 'ЕВРООБЛИГАЦИЯ', 'ПАЙ'];

function parseSecurities(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  let headerRow = -1;
  for (let r = range.s.r; r <= range.e.r; r++) {
    let text = '';
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v) text += ' ' + String(cell.v);
    }
    if (/Наименование\s+ценной\s+бумаги/i.test(text) && /Входящий\s+остаток/i.test(text)) {
      headerRow = r; break;
    }
  }
  if (headerRow < 0) {
    return { positions: [], errors: ['Таблица «Отчёт об остатках ценных бумаг» не найдена'], typeStats: {}, totalValueKopecks: 0 };
  }

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
    return { positions: [], errors: ['Не найдены обязательные колонки в таблице остатков'], typeStats: {}, totalValueKopecks: 0 };
  }

  const positions = [];
  const errors = [];
  const typeStats = {};
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
    if (nonEmpty.length === 0) {
      emptyRun++;
      if (emptyRun >= 10) break;
      continue;
    }
    emptyRun = 0;

    if (nonEmpty.length === 1) {
      const val = nonEmpty[0].v;
      if (PAPER_TYPES.includes(val.toUpperCase())) { currentType = val.toUpperCase(); continue; }
      if (/^ИТОГО/i.test(val)) continue;
      if (/^(Движение\s+ценных|Заключенные|Завершенные|Сводная)/i.test(val)) break;
    }

    const nameCell = rowCells[cols.name];
    if (!nameCell) continue;
    const nameVal = String(nameCell).trim();
    if (!nameVal || !nameVal.includes(',')) continue;

    const { name, reg_number, isin } = splitSecurityName(nameVal);
    const outgoing = toNumber(rowCells[cols.outgoing]);
    if (outgoing == null) continue;

    const pos = {
      name, isin, reg_number,
      type: currentType || '—',
      incoming_qty: cols.incoming >= 0 ? toNumber(rowCells[cols.incoming]) : null,
      change_qty: cols.change >= 0 ? toNumber(rowCells[cols.change]) : null,
      outgoing_qty: outgoing,
      planned_qty: cols.planned >= 0 ? toNumber(rowCells[cols.planned]) : null,
      currency: cols.currency >= 0 && rowCells[cols.currency] ? String(rowCells[cols.currency]).trim() : null,
      price: cols.price >= 0 ? toNumber(rowCells[cols.price]) : null,
      nominal: cols.nominal >= 0 ? toNumber(rowCells[cols.nominal]) : null,
      nkd: cols.nkd >= 0 ? toNumber(rowCells[cols.nkd]) : null,
      coupon_rate: cols.couponRate >= 0 ? toNumber(rowCells[cols.couponRate]) : null,
      payment_date: cols.paymentDate >= 0 ? toIsoDate(rowCells[cols.paymentDate]) : null,
      value_currency: cols.valueCurrency >= 0 ? toNumber(rowCells[cols.valueCurrency]) : null,
      value_rub_kopecks: cols.valueRub >= 0 ? toKopecks(rowCells[cols.valueRub]) : null,
      planned_value_rub_kopecks: cols.plannedValueRub >= 0 ? toKopecks(rowCells[cols.plannedValueRub]) : null,
      row: r + 1
    };
    positions.push(pos);

    const tKey = currentType || '—';
    typeStats[tKey] = (typeStats[tKey] || 0) + 1;
    if (outgoing > 0 && pos.value_rub_kopecks != null) totalValueKopecks += pos.value_rub_kopecks;
  }
  return { positions, errors, typeStats, totalValueKopecks };
}

// ===== Парсер сделок =====

// Ищем строку заголовка таблицы сделок
function findTradesHeaderRow(sheet, r, range) {
  let cols = { name: -1, date: -1, type: -1, qty: -1, currency: -1,
    price: -1, currencySettle: -1, amount: -1, nkd: -1,
    commissionCalc: -1, commissionExec: -1, tradeNumber: -1,
    counterparty: -1, place: -1 };
  let foundCount = 0;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    const v = cell ? String(cell.v || '').trim() : '';
    if (!v) continue;
    if (/^Наименование\s+ценной\s+бумаги/i.test(v)) { cols.name = c; foundCount++; }
    else if (/^Дата\s+и\s+время\s+заключения/i.test(v)) { cols.date = c; foundCount++; }
    else if (/^Вид\s+сделки/i.test(v)) { cols.type = c; foundCount++; }
    else if (/^Количество/i.test(v)) { cols.qty = c; foundCount++; }
    else if (/^Валюта\s+цены/i.test(v)) { cols.currency = c; foundCount++; }
    else if (/^Цена/i.test(v)) { cols.price = c; foundCount++; }
    else if (/^Валюта\s+расч/i.test(v)) { cols.currencySettle = c; foundCount++; }
    else if (/^Сумма\s+сделки/i.test(v)) { cols.amount = c; foundCount++; }
    else if (/^НКД\s+по\s+сделке/i.test(v)) { cols.nkd = c; foundCount++; }
    else if (/^Комиссия\s+Банка\s+за\s+расч/i.test(v)) { cols.commissionCalc = c; foundCount++; }
    else if (/^Комиссия\s+Банка\s+за\s+заключ/i.test(v)) { cols.commissionExec = c; foundCount++; }
    else if (/^№\s+сделки$/i.test(v) && cols.tradeNumber < 0) { cols.tradeNumber = c; foundCount++; }
    else if (/^Контрагент/i.test(v)) { cols.counterparty = c; foundCount++; }
    else if (/^Место\s+заключения/i.test(v)) { cols.place = c; foundCount++; }
  }
  if (foundCount >= 8 && cols.name >= 0 && cols.date >= 0 && cols.tradeNumber >= 0) {
    return cols;
  }
  return null;
}

// Определяем контекст рынка по разделителю
function detectMarketDivider(nonEmptyVals) {
  if (nonEmptyVals.length < 1 || nonEmptyVals.length > 2) return null;
  const joined = nonEmptyVals.join(' ');
  if (/^(Основной|Срочный|Внебиржевой)\s+рынок/i.test(joined)) {
    if (/Основной/i.test(joined)) return 'Основной рынок';
    if (/Срочный/i.test(joined)) return 'Срочный рынок';
    if (/Внебирж/i.test(joined)) return 'Внебиржевой рынок';
  }
  return null;
}

// Проверяем, что строка — начало другой таблицы или заголовок
function isOtherTableHeader(rowText) {
  return /Наименование\s+ценной\s+бумаги/i.test(rowText) ||
         /Входящий\s+остаток/i.test(rowText) ||
         /Движение\s+ценных\s+бумаг/i.test(rowText) ||
         /Отч[её]т\s+об\s+остатках/i.test(rowText) ||
         /Фьючерсный\s+контракт/i.test(rowText) ||
         /Сделки\s+с\s+Производными/i.test(rowText) ||
         /Открытые\s+позиции/i.test(rowText) ||
         /Дата\s+и\s+время\s+заключения\s+сделки/i.test(rowText);
}

// Проверяем, что конкретная ячейка выглядит как заголовок таблицы
function isHeaderCellValue(v) {
  if (!v) return false;
  return /^Дата\s+и\s+время\s+заключения/i.test(v) ||
         /^Наименование\s+ценной\s+бумаги/i.test(v) ||
         /^Фьючерсный\s+контракт/i.test(v) ||
         /^Вид\s+сделки$/i.test(v) ||
         /^Количество\s*\(/i.test(v) ||
         /^№\s+сделки$/i.test(v) ||
         /^Валюта\s+расч[её]тов$/i.test(v);
}

function parseTradesInSheet(sheet, range, startRow) {
  const trades = [];
  const errors = [];
  const marketBreakdown = {};
  const typeBreakdown = {};

  // Находим все строки-заголовки таблиц сделок, начиная с startRow
  const headerRows = [];
  for (let r = startRow; r <= range.e.r; r++) {
    const cols = findTradesHeaderRow(sheet, r, range);
    if (cols) headerRows.push({ row: r, cols });
  }

  for (const h of headerRows) {
    const { cols } = h;
    let market = null;
    let emptyRun = 0;
    let stop = false;

    for (let r = h.row + 1; r <= range.e.r; r++) {
      if (stop) break;

      const rowCells = {};
      const nonEmpty = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        rowCells[c] = cell ? cell.v : null;
        if (cell && cell.v != null && String(cell.v).trim() !== '') {
          nonEmpty.push({ c, v: String(cell.v).trim() });
        }
      }
      const rowText = nonEmpty.map(x => x.v).join(' ').replace(/\s+/g, ' ');

      // 1. Стоп на следующей таблице / заголовке
      if (isOtherTableHeader(rowText)) break;
      if (findTradesHeaderRow(sheet, r, range)) break;

      // 2. Стоп, если какая-то ячейка — это заголовок другой таблицы
      //    (например, таблицы производных инструментов)
      if (nonEmpty.some(x => isHeaderCellValue(x.v))) break;

      if (nonEmpty.length === 0) {
        emptyRun++;
        if (emptyRun >= 3) break;
        continue;
      }
      emptyRun = 0;

      // Разделитель рынка
      const divider = detectMarketDivider(nonEmpty.map(x => x.v));
      if (divider) { market = divider; continue; }

      // Наименование бумаги
      const nameCell = rowCells[cols.name];
      if (!nameCell) continue;
      const nameVal = String(nameCell).trim();
      if (!nameVal || !nameVal.includes(',')) continue;

      const { name, isin } = splitSecurityName(nameVal);

      // Дата
      const isoDate = toIsoDate(rowCells[cols.date]);
      if (!isoDate) {
        errors.push(`Строка ${r + 1}: не распознана дата сделки «${String(rowCells[cols.date])}»`);
        continue;
      }

      // № сделки
      const tradeNumber = rowCells[cols.tradeNumber] != null
        ? String(rowCells[cols.tradeNumber]).trim()
        : '';
      if (!tradeNumber) {
        errors.push(`Строка ${r + 1}: отсутствует № сделки`);
        continue;
      }

      const tradeType = rowCells[cols.type] != null ? String(rowCells[cols.type]).trim() : '';
      const qty = toNumber(rowCells[cols.qty]);
      const price = toNumber(rowCells[cols.price]);
      const currency = cols.currency >= 0 && rowCells[cols.currency]
        ? String(rowCells[cols.currency]).trim().toUpperCase() : null;
      const currencySettle = cols.currencySettle >= 0 && rowCells[cols.currencySettle]
        ? String(rowCells[cols.currencySettle]).trim().toUpperCase() : null;
      const amountKopecks = cols.amount >= 0 ? toKopecks(rowCells[cols.amount]) : null;
      const nkdKopecks = cols.nkd >= 0 ? toKopecks(rowCells[cols.nkd]) : null;
      const commissionCalcKopecks = cols.commissionCalc >= 0 ? toKopecks(rowCells[cols.commissionCalc]) : null;
      const commissionExecKopecks = cols.commissionExec >= 0 ? toKopecks(rowCells[cols.commissionExec]) : null;
      const counterparty = cols.counterparty >= 0 && rowCells[cols.counterparty]
        ? String(rowCells[cols.counterparty]).trim() : null;
      const place = cols.place >= 0 && rowCells[cols.place]
        ? String(rowCells[cols.place]).trim() : null;
	  // Если рынок не был определён — сделки ЦБ идут на основном рынке
      const effectiveMarket = market || 'Основной рынок';
      
	  const trade = {
        trade_number: tradeNumber,
        name, isin,
        trade_date: isoDate,
        trade_type: tradeType,
        quantity: qty,
        price: price,
        currency: currency,
        currency_settle: currencySettle,
        amount_kopecks: amountKopecks,
        nkd_kopecks: nkdKopecks,
        commission_calc_kopecks: commissionCalcKopecks,
        commission_exec_kopecks: commissionExecKopecks,
        counterparty,
        place,
        market: effectiveMarket,
        row: r + 1
      };
      trades.push(trade);

      marketBreakdown[effectiveMarket] = (marketBreakdown[effectiveMarket] || 0) + 1;
      const tKey = tradeType || '—';
      typeBreakdown[tKey] = (typeBreakdown[tKey] || 0) + 1;
    }
  }

  return { trades, errors, marketBreakdown, typeBreakdown };
}

function parseTrades(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const result = parseTradesInSheet(sheet, range, 0);

  // Дедупликация по № сделки
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const t of result.trades) {
    if (seen.has(t.trade_number)) { duplicates++; continue; }
    seen.add(t.trade_number);
    unique.push(t);
  }

  result.trades = unique;
  result.duplicates = duplicates;
  return result;
}

// ===== Парсер «Движение ценных бумаг» =====

function parseSecuritiesMovement(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  // Ищем строку заголовка
  let headerRow = -1;
  let cols = { name: -1, date: -1, qty: -1, type: -1, comment: -1 };

  for (let r = range.s.r; r <= range.e.r; r++) {
    let headerText = '';
    let foundName = false, foundDate = false, foundQty = false, foundType = false;
    const tmp = { name: -1, date: -1, qty: -1, type: -1, comment: -1 };
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const v = cell ? String(cell.v || '').trim() : '';
      if (!v) continue;
      headerText += ' ' + v;
      if (/^Наименование\s+ценной\s+бумаги/i.test(v)) { tmp.name = c; foundName = true; }
      else if (/^Дата\s+операции/i.test(v)) { tmp.date = c; foundDate = true; }
      else if (/^Количество/i.test(v)) { tmp.qty = c; foundQty = true; }
      else if (/^Тип\s+операции/i.test(v)) { tmp.type = c; foundType = true; }
      else if (/^Комментарий/i.test(v)) { tmp.comment = c; }
    }
    if (foundName && foundDate && foundQty && foundType) {
      headerRow = r;
      cols = tmp;
      break;
    }
  }
  if (headerRow < 0) {
    return { movements: [], errors: ['Таблица «Движение ценных бумаг» не найдена'] };
  }

  const movements = [];
  const errors = [];
  const typeStats = {};
  let emptyRun = 0;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const rowCells = {};
    const nonEmpty = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      rowCells[c] = cell ? cell.v : null;
      if (cell && cell.v != null && String(cell.v).trim() !== '') {
        nonEmpty.push(String(cell.v).trim());
      }
    }
    if (nonEmpty.length === 0) {
      emptyRun++;
      if (emptyRun >= 10) break;
      continue;
    }
    emptyRun = 0;

    const rowText = nonEmpty.join(' ');
    if (isOtherTableHeader(rowText) || findTradesHeaderRow(sheet, r, range)) break;

    const nameCell = rowCells[cols.name];
    if (!nameCell) continue;
    const nameVal = String(nameCell).trim();
    if (!nameVal || !nameVal.includes(',')) continue;

    const isoDate = toIsoDate(rowCells[cols.date]);
    if (!isoDate) {
      errors.push(`Строка ${r + 1}: не распознана дата «${String(rowCells[cols.date])}»`);
      continue;
    }

    const { name, isin } = splitSecurityName(nameVal);
    const qty = toNumber(rowCells[cols.qty]);
    const opType = rowCells[cols.type] != null ? String(rowCells[cols.type]).trim() : '';
    const comment = cols.comment >= 0 && rowCells[cols.comment]
      ? String(rowCells[cols.comment]).trim() : '';

    movements.push({
      name, isin,
      movement_date: isoDate,
      quantity: qty,
      operation_type: opType,
      comment,
      row: r + 1
    });
    const tKey = opType || '—';
    typeStats[tKey] = (typeStats[tKey] || 0) + 1;
  }

  return { movements, errors, typeStats };
}

// ===== Парсер сделок по производным (фьючерсы, опционы) =====

function findFuturesTradesHeaderRow(sheet, r, range) {
  let cols = {
    contract: -1, date: -1, type: -1, qty: -1, price: -1, strike: -1,
    commCalc: -1, commExec: -1, counterparty: -1, place: -1, comment: -1
  };
  let foundCount = 0;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    const v = cell ? String(cell.v || '').trim() : '';
    if (!v) continue;
    if (/^Фьючерсный\s+контракт/i.test(v)) { cols.contract = c; foundCount++; }
    else if (/^Дата\s+и\s+время\s+заключения/i.test(v)) { cols.date = c; foundCount++; }
    else if (/^Вид\s+сделки/i.test(v)) { cols.type = c; foundCount++; }
    else if (/^Количество/i.test(v) && cols.qty < 0) { cols.qty = c; foundCount++; }
    else if (/^Цена\s+контракта/i.test(v)) { cols.price = c; foundCount++; }
    else if (/^Цена\s+исполнения/i.test(v)) { cols.strike = c; foundCount++; }
    else if (/^Комиссия\s+Банка\s+за\s+расчет/i.test(v) && cols.commCalc < 0) { cols.commCalc = c; foundCount++; }
    else if (/^Комиссия\s+Банка\s+за\s+заключ/i.test(v) && cols.commExec < 0) { cols.commExec = c; foundCount++; }
    else if (/^Контрагент/i.test(v) && cols.counterparty < 0) { cols.counterparty = c; foundCount++; }
    else if (/^Место\s+заключения/i.test(v)) { cols.place = c; foundCount++; }
    else if (/^Комментарий/i.test(v) && cols.comment < 0) { cols.comment = c; foundCount++; }
  }
  if (cols.contract >= 0 && cols.date >= 0 && cols.type >= 0 && cols.qty >= 0 && cols.price >= 0) {
    return cols;
  }
  return null;
}

function parseFuturesTrades(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  let headerRow = -1;
  let cols = null;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const idx = findFuturesTradesHeaderRow(sheet, r, range);
    if (idx) { headerRow = r; cols = idx; break; }
  }

  if (headerRow < 0) {
    return { trades: [], errors: [], typeStats: {} };
  }

  const trades = [];
  const errors = [];
  const typeStats = {};
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
    const rowText = nonEmpty.map(x => x.v).join(' ').replace(/\s+/g, ' ');

    // Стоп, если началась другая таблица
    if (/Заключенные\s+в\s+отчетном/i.test(rowText) ||
        /Завершенные\s+в\s+отчетном/i.test(rowText) ||
        /Открытые\s+позиции/i.test(rowText) ||
        /Сделки\s+с\s+ценными\s+бумагами/i.test(rowText) ||
        /Итоговая\s+величина\s+ГО/i.test(rowText) ||
        /Свободный\s+остаток/i.test(rowText)) {
      break;
    }

    if (nonEmpty.length === 0) {
      emptyRun++;
      if (emptyRun >= 3) break;
      continue;
    }
    emptyRun = 0;

    const contractCode = rowCells[cols.contract] != null
      ? String(rowCells[cols.contract]).trim()
      : '';
    if (!contractCode) continue;

    // Пропускаем строку-заголовок, если она случайно попала
    if (/^Фьючерсный/i.test(contractCode)) continue;

    const isoDate = toIsoDate(rowCells[cols.date]);
    if (!isoDate) {
      errors.push(`Строка ${r + 1}: не распознана дата сделки «${String(rowCells[cols.date])}»`);
      continue;
    }

    const tradeType = rowCells[cols.type] != null ? String(rowCells[cols.type]).trim() : '';
    const qty = toNumber(rowCells[cols.qty]);
    const price = toNumber(rowCells[cols.price]);
    const strike = cols.strike >= 0 ? toNumber(rowCells[cols.strike]) : null;
    const commCalc = cols.commCalc >= 0 ? toKopecks(rowCells[cols.commCalc]) : null;
    const commExec = cols.commExec >= 0 ? toKopecks(rowCells[cols.commExec]) : null;
    const counterparty = cols.counterparty >= 0 && rowCells[cols.counterparty]
      ? String(rowCells[cols.counterparty]).trim() : null;
    const place = cols.place >= 0 && rowCells[cols.place]
      ? String(rowCells[cols.place]).trim() : null;
    const comment = cols.comment >= 0 && rowCells[cols.comment]
      ? String(rowCells[cols.comment]).trim() : '';

    const trade = {
      contract_code: contractCode,
      trade_date: isoDate,
      trade_type: tradeType,
      quantity: qty,
      price: price,
      strike_price: strike,
      commission_calc_kopecks: commCalc,
      commission_exec_kopecks: commExec,
      counterparty, place, comment,
	  market: 'Срочный рынок',
      row: r + 1
    };
    // Уникальный хэш: добавляем номер строки в файле, чтобы сделки с одинаковыми
    // параметрами (но в разных строках) не считались дубликатами
    trade.external_hash = [contractCode, isoDate, tradeType, qty, price, r + 1].join('|');
    trades.push(trade);

    const tKey = tradeType || '—';
    typeStats[tKey] = (typeStats[tKey] || 0) + 1;
  }

  return { trades, errors, typeStats };
}

// ===== Парсер 1: Метаданные отчёта =====

function parseReportMetadata(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  const meta = {
    broker: null,
    period_from: null,
    period_to: null,
    client: null,
    inn: null,
    contract: null,
    subaccount: null,
    account_number: null,
    report_date: null,
    cny_start_rate: null,
    cny_end_rate: null
  };

  const maxRow = Math.min(range.e.r, 30);

  for (let r = range.s.r; r <= maxRow; r++) {
    const rowCells = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      rowCells.push(cell && cell.v != null ? String(cell.v).trim() : '');
    }
    const joined = rowCells.filter(x => x).join(' | ');
    if (!joined) continue;

    // Заголовок: "Отчет Банка X за период с DD.MM.YYYY по DD.MM.YYYY ..."
    if (!meta.broker) {
      const m = joined.match(/Отчет\s+(.+?)\s+за\s+период\s+с\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})/i);
      if (m) {
        meta.broker = m[1].trim();
        meta.period_from = m[2];
        meta.period_to = m[3];
      }
    }

    // Курсы CNY
    if (!meta.cny_start_rate) {
      const m = joined.match(/Курс\s+CNY\s+на\s+начальную\s+дату\s+отч[её]та\s+([\d.,]+).*?Курс\s+CNY\s+на\s+конечную\s+дату\s+отч[её]та\s+([\d.,]+)/i);
      if (m) {
        meta.cny_start_rate = parseFloat(m[1].replace(',', '.'));
        meta.cny_end_rate = parseFloat(m[2].replace(',', '.'));
      }
    }

    // Метки в первой непустой ячейке
    let label = '';
    let labelCol = -1;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v != null && String(cell.v).trim() !== '') {
        label = String(cell.v).trim();
        labelCol = c;
        break;
      }
    }
    if (!label) continue;

    // Значение — в следующей непустой ячейке этой же строки
    let value = null;
    for (let c = labelCol + 1; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v != null && String(cell.v).trim() !== '') {
        value = String(cell.v).trim();
        break;
      }
    }

    if (/^Клиент:?$/i.test(label) && !meta.client) meta.client = value;
    else if (/^ИНН:?$/i.test(label) && !meta.inn) meta.inn = value;
    else if (/^№\s+и\s+дата\s+Соглашения/i.test(label) && !meta.contract) meta.contract = value;
    else if (/^№\s+субсчета:?$/i.test(label) && !meta.subaccount) meta.subaccount = value;
    else if (/^Лицевой\s+счет/i.test(label) && !meta.account_number) meta.account_number = value;
    else if (/^Дата\s+формирования\s+отчета/i.test(label) && !meta.report_date) {
      meta.report_date = toIsoDate(value) || value;
    }
  }

  // Дополнительный поиск ИНН, если он в отдельной ячейке
  if (!meta.inn) {
    const walker = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    for (let r = walker.s.r; r <= Math.min(walker.e.r, 20); r++) {
      for (let c = walker.s.c; c <= walker.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v && /^ИНН:?$/i.test(String(cell.v).trim())) {
          for (let cc = c + 1; cc <= walker.e.c; cc++) {
            const cell2 = sheet[XLSX.utils.encode_cell({ r, c: cc })];
            if (cell2 && cell2.v != null && /^\d{10,12}$/.test(String(cell2.v).trim())) {
              meta.inn = String(cell2.v).trim();
              break;
            }
          }
          break;
        }
      }
    }
  }

  return meta;
}

// ===== Парсер 2: Сводная информация по субсчёту =====

function parseAccountSummary(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  let headerRow = -1;
  let cols = { desc: -1, sum: -1, curr: -1, value: -1 };

  for (let r = range.s.r; r <= range.e.r; r++) {
    let foundDesc = false, foundSum = false, foundCurr = false, foundValue = false;
    const tmp = { desc: -1, sum: -1, curr: -1, value: -1 };
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const v = cell ? String(cell.v || '').trim() : '';
      if (/^Описание$/i.test(v)) { tmp.desc = c; foundDesc = true; }
      else if (/^Сумма$/i.test(v)) { tmp.sum = c; foundSum = true; }
      else if (/^Валюта$/i.test(v)) { tmp.curr = c; foundCurr = true; }
      else if (/^Оценка\s+по\s+Курсу/i.test(v)) { tmp.value = c; foundValue = true; }
    }
    if (foundDesc && foundSum && foundCurr && foundValue) {
      headerRow = r;
      cols = tmp;
      break;
    }
  }

  if (headerRow < 0) return { items: [], errors: ['Таблица «Сводная информация по субсчёту» не найдена'] };

  const items = [];
  const errors = [];
  let emptyRun = 0;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const descCell = sheet[XLSX.utils.encode_cell({ r, c: cols.desc })];
    const sumCell = sheet[XLSX.utils.encode_cell({ r, c: cols.sum })];
    const currCell = sheet[XLSX.utils.encode_cell({ r, c: cols.curr })];
    const valueCell = cols.value >= 0 ? sheet[XLSX.utils.encode_cell({ r, c: cols.value })] : null;

    const desc = descCell ? String(descCell.v || '').trim() : '';
    const sum = sumCell ? toNumber(sumCell.v) : null;
    const currency = currCell ? String(currCell.v || '').trim().toUpperCase() : '';
    const valueKopecks = valueCell ? toKopecks(valueCell.v) : null;

    if (/^Отч[её]т\s+об\s+остатках/i.test(desc) || /^Движение\s+денежных/i.test(desc)) break;

    if (!desc && sum == null && !currency) {
      emptyRun++;
      if (emptyRun >= 3) break;
      continue;
    }
    emptyRun = 0;
    if (!desc) continue;

    items.push({
      description: desc,
      amount: sum,
      currency: currency,
      value_rub_kopecks: valueKopecks,
      row: r + 1
    });
  }

  return { items, errors };
}

// ===== Парсер 3: Отчёт об остатках денежных средств =====

function parseCashBalances(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  // Ищем строку с "Валюта" + "Входящий остаток"
  let titleRow = -1;
  outer:
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const v = cell ? String(cell.v || '').trim() : '';
      if (/^Валюта$/i.test(v)) {
        for (let cc = c + 1; cc <= Math.min(c + 5, range.e.c); cc++) {
          const cell2 = sheet[XLSX.utils.encode_cell({ r, c: cc })];
          if (cell2 && /Входящий\s+остаток/i.test(String(cell2.v || ''))) {
            titleRow = r;
            break outer;
          }
        }
      }
    }
  }
  if (titleRow < 0) return { rows: [], errors: ['Таблица «Отчёт об остатках денежных средств» не найдена'] };

  // Ищем строку подзаголовков (Основной рынок / Срочный / Внебирж / Итого)
  let subRow = -1;
  for (let rr = titleRow + 1; rr <= Math.min(titleRow + 3, range.e.r); rr++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rr, c })];
      const v = cell ? String(cell.v || '').trim() : '';
      if (/^Основной\s+рынок$/i.test(v)) { subRow = rr; break; }
    }
    if (subRow >= 0) break;
  }

  // Собираем индексы колонок "Итого" (в подзаголовке их несколько: входящий, исходящий)
  const totalCols = [];
  if (subRow >= 0) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: subRow, c })];
      const v = cell ? String(cell.v || '').trim() : '';
      if (/^Итого$/i.test(v)) totalCols.push(c);
    }
  }

  const rows = [];
  const errors = [];
  let emptyRun = 0;

  for (let r = (subRow >= 0 ? subRow : titleRow) + 1; r <= range.e.r; r++) {
    // Первая непустая ячейка строки
    let firstVal = '';
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v != null && String(cell.v).trim() !== '') {
        firstVal = String(cell.v).trim();
        break;
      }
    }
    if (!firstVal) {
      emptyRun++;
      if (emptyRun >= 3) break;
      continue;
    }
    emptyRun = 0;

    if (/^Движение\s+денежных/i.test(firstVal) || /^Отч[её]т\s+об\s+остатках\s+ценных/i.test(firstVal)) break;

    const isCurrency = /^[A-Z]{3}$/.test(firstVal);
    const isSumRow = /^Сумма\s+денежных\s+средств/i.test(firstVal);
    if (!isCurrency && !isSumRow) continue;

    const totals = totalCols.map(c => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      return cell ? toNumber(cell.v) : null;
    });

    rows.push({
      label: firstVal,
      is_total: isSumRow,
      totals: totals,
      row: r + 1
    });
  }

  return { rows, totalCols, errors };
}

// ===== Парсер 4: Открытые позиции по производным =====

function parseFuturesPositions(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  let headerRow = -1;
  const cols = { code: -1, incoming: -1, added: -1, removed: -1, executed: -1,
                 outgoing: -1, go: -1, margin: -1, expiration: -1 };

  for (let r = range.s.r; r <= range.e.r; r++) {
    let foundCode = false;
    const tmp = { code: -1, incoming: -1, added: -1, removed: -1, executed: -1,
                  outgoing: -1, go: -1, margin: -1, expiration: -1 };
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const v = cell ? String(cell.v || '').trim() : '';
      if (/^Фьючерсный\s+контракт/i.test(v)) { tmp.code = c; foundCode = true; }
      else if (/^Входящий\s+остаток/i.test(v) && tmp.incoming < 0) tmp.incoming = c;
      else if (/^Зачислено/i.test(v) && tmp.added < 0) tmp.added = c;
      else if (/^Списано/i.test(v) && tmp.removed < 0) tmp.removed = c;
      else if (/^Исполнено/i.test(v) && tmp.executed < 0) tmp.executed = c;
      else if (/^Исходящий\s+остаток/i.test(v) && tmp.outgoing < 0) tmp.outgoing = c;
      else if (/^Биржевое\s+ГО/i.test(v) && tmp.go < 0) tmp.go = c;
      else if (/^Вариационная\s+маржа/i.test(v) && tmp.margin < 0) tmp.margin = c;
      else if (/^Дата\s+экспирации/i.test(v) && tmp.expiration < 0) tmp.expiration = c;
    }
    if (foundCode && tmp.margin >= 0) {
      headerRow = r;
      Object.assign(cols, tmp);
      break;
    }
  }

  if (headerRow < 0) return { positions: [], go_total: null, free_cash: null, errors: ['Таблица «Открытые позиции по производным» не найдена'] };

  const positions = [];
  const errors = [];
  let go_total = null;
  let free_cash = null;
  let emptyRun = 0;

  const getCell = (r, c) => {
    if (c < 0) return null;
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    return cell ? cell.v : null;
  };

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    let rowFirstVal = '';
    let rowFirstCol = -1;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v != null && String(cell.v).trim() !== '') {
        rowFirstVal = String(cell.v).trim();
        rowFirstCol = c;
        break;
      }
    }

    if (!rowFirstVal) {
      emptyRun++;
      if (emptyRun >= 3) break;
      continue;
    }
    emptyRun = 0;

    if (/^Заключенные\s+в\s+отчетном/i.test(rowFirstVal) ||
        /^Завершенные\s+в\s+отчетном/i.test(rowFirstVal) ||
        /^Сделки\s+с\s+ценными/i.test(rowFirstVal)) break;

    if (/^Итоговая\s+величина\s+ГО/i.test(rowFirstVal)) {
      for (let c = rowFirstCol + 1; c <= range.e.c; c++) {
        const v = getCell(r, c);
        if (typeof v === 'number') { go_total = v; break; }
      }
      continue;
    }

    if (/^Свободный\s+остаток/i.test(rowFirstVal)) {
      for (let c = rowFirstCol + 1; c <= range.e.c; c++) {
        const v = getCell(r, c);
        if (typeof v === 'number') { free_cash = v; break; }
      }
      continue;
    }

    const contractCode = rowFirstVal;
    if (!/^[A-Z]+-\d+\.\d+$/i.test(contractCode)) continue;

    positions.push({
      contract_code: contractCode,
      incoming_qty: toNumber(getCell(r, cols.incoming)),
      added_qty: toNumber(getCell(r, cols.added)),
      removed_qty: toNumber(getCell(r, cols.removed)),
      executed_qty: toNumber(getCell(r, cols.executed)),
      outgoing_qty: toNumber(getCell(r, cols.outgoing)),
      go: toNumber(getCell(r, cols.go)),
      margin: toNumber(getCell(r, cols.margin)),
      expiration_date: toIsoDate(getCell(r, cols.expiration)),
      row: r + 1
    });
  }

  return { positions, go_total, free_cash, errors };
}

// ===== Парсер: сделки с иностранной валютой =====

function findCurrencyTradesHeaderRow(sheet, r, range) {
  let cols = {
    instrument: -1, date: -1, type: -1, qty: -1, price: -1,
    currency: -1, amount: -1, commCalc: -1, commExec: -1,
    execDate: -1, tradeNumber: -1, counterparty: -1, place: -1, comment: -1
  };
  let foundCount = 0;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    const v = cell ? String(cell.v || '').trim() : '';
    if (!v) continue;
    if (/^Финансовый\s+инструмент$/i.test(v)) { cols.instrument = c; foundCount++; }
    else if (/^Дата\s+и\s+время\s+заключения/i.test(v)) { cols.date = c; foundCount++; }
    else if (/^Вид\s+сделки/i.test(v)) { cols.type = c; foundCount++; }
    else if (/^Количество/i.test(v) && cols.qty < 0) { cols.qty = c; foundCount++; }
    else if (/^Цена$/i.test(v)) { cols.price = c; foundCount++; }
    else if (/^Валюта\s+расч[её]тов$/i.test(v)) { cols.currency = c; foundCount++; }
    else if (/^Сумма\s+сделки/i.test(v)) { cols.amount = c; foundCount++; }
    else if (/^Комиссия\s+Банка\s+за\s+расч[её]т/i.test(v) && cols.commCalc < 0) { cols.commCalc = c; foundCount++; }
    else if (/^Комиссия\s+Банка\s+за\s+заключ/i.test(v) && cols.commExec < 0) { cols.commExec = c; foundCount++; }
    else if (/^Дата\s+исполнения/i.test(v)) { cols.execDate = c; foundCount++; }
    else if (/^№\s+сделки$/i.test(v) && cols.tradeNumber < 0) { cols.tradeNumber = c; foundCount++; }
    else if (/^Контрагент/i.test(v) && cols.counterparty < 0) { cols.counterparty = c; foundCount++; }
    else if (/^Место\s+заключения/i.test(v)) { cols.place = c; foundCount++; }
    else if (/^Комментарий/i.test(v) && cols.comment < 0) { cols.comment = c; foundCount++; }
  }
  if (cols.instrument >= 0 && cols.date >= 0 && cols.type >= 0 && cols.tradeNumber >= 0) {
    return cols;
  }
  return null;
}

function parseCurrencyTrades(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  let headerRow = -1;
  let cols = null;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const idx = findCurrencyTradesHeaderRow(sheet, r, range);
    if (idx) { headerRow = r; cols = idx; break; }
  }

  if (headerRow < 0) {
    return { trades: [], errors: [], typeStats: {}, totalVolume: 0 };
  }

  const trades = [];
  const errors = [];
  const typeStats = {};
  let totalVolume = 0;
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
    const rowText = nonEmpty.map(x => x.v).join(' ').replace(/\s+/g, ' ');

    // Стоп на следующей таблице
    if (/Наименование\s+ценной\s+бумаги/i.test(rowText) ||
        /Входящий\s+остаток/i.test(rowText) ||
        /Отч[её]т\s+об\s+остатках/i.test(rowText) ||
        /Движение\s+ценных\s+бумаг/i.test(rowText) ||
        /Заключенные\s+в\s+отчетном\s+периоде\s+сделки\s+с\s+ценными/i.test(rowText) ||
        /Завершенные\s+в\s+отчетном/i.test(rowText) ||
        /Сделки\s+с\s+Производными/i.test(rowText)) {
      break;
    }

    if (nonEmpty.length === 0) {
      emptyRun++;
      if (emptyRun >= 3) break;
      continue;
    }
    emptyRun = 0;

    const instrument = rowCells[cols.instrument] != null
      ? String(rowCells[cols.instrument]).trim()
      : '';
    if (!instrument) continue;

    // Пропускаем строку-заголовок, если попала
    if (/^Финансовый\s+инструмент/i.test(instrument)) continue;

    const isoDate = toIsoDate(rowCells[cols.date]);
    if (!isoDate) {
      errors.push(`Строка ${r + 1}: не распознана дата сделки «${String(rowCells[cols.date])}»`);
      continue;
    }

    const tradeNumber = rowCells[cols.tradeNumber] != null
      ? String(rowCells[cols.tradeNumber]).trim()
      : '';
    if (!tradeNumber) {
      errors.push(`Строка ${r + 1}: отсутствует № сделки`);
      continue;
    }

    const tradeType = rowCells[cols.type] != null ? String(rowCells[cols.type]).trim() : '';
    const qty = toNumber(rowCells[cols.qty]);
    const price = toNumber(rowCells[cols.price]);
    const currency = cols.currency >= 0 && rowCells[cols.currency]
      ? String(rowCells[cols.currency]).trim().toUpperCase() : null;
    const amountKopecks = cols.amount >= 0 ? toKopecks(rowCells[cols.amount]) : null;
    const commCalc = cols.commCalc >= 0 ? toKopecks(rowCells[cols.commCalc]) : null;
    const commExec = cols.commExec >= 0 ? toKopecks(rowCells[cols.commExec]) : null;
    const execDate = cols.execDate >= 0 ? toIsoDate(rowCells[cols.execDate]) : null;
    const counterparty = cols.counterparty >= 0 && rowCells[cols.counterparty]
      ? String(rowCells[cols.counterparty]).trim() : null;
    const place = cols.place >= 0 && rowCells[cols.place]
      ? String(rowCells[cols.place]).trim() : null;
    const comment = cols.comment >= 0 && rowCells[cols.comment]
      ? String(rowCells[cols.comment]).trim() : '';

    const trade = {
      trade_number: tradeNumber,
      instrument,
      trade_date: isoDate,
      trade_type: tradeType,
      quantity: qty,
      price: price,
      currency: currency,
      amount_kopecks: amountKopecks,
      commission_calc_kopecks: commCalc,
      commission_exec_kopecks: commExec,
      execution_date: execDate,
      counterparty, place, comment,
      market: 'Валютный рынок',
      row: r + 1
    };
    trades.push(trade);

    if (amountKopecks != null) totalVolume += Math.abs(amountKopecks);

    const tKey = tradeType || '—';
    typeStats[tKey] = (typeStats[tKey] || 0) + 1;
  }

  return { trades, errors, typeStats, totalVolume };
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

// Оборачивает блок в сворачиваемый <details>
function wrapCollapsible(title, summary, contentHtml) {
  if (!contentHtml) return '';
  return `
    <details class="preview-block">
      <summary class="preview-block-header">
        <span class="preview-block-title">${title}</span>
        <span class="preview-block-summary">${summary}</span>
      </summary>
      <div class="preview-block-body">${contentHtml}</div>
    </details>
  `;
}

const MARKET_ORDER = {
  'Основной рынок': 0, 'Срочный рынок': 1, 'Внебиржевой рынок': 2, 'Без рынка': 99
};
const PAPER_ORDER = {
  'АКЦИЯ': 0, 'ЕВРООБЛИГАЦИЯ': 1, 'ОБЛИГАЦИЯ': 2, 'ПАЙ': 3
};
function sortByMarketOrder(keys) {
  return keys.sort((a, b) => (MARKET_ORDER[a] ?? 50) - (MARKET_ORDER[b] ?? 50));
}
function sortByPaperOrder(keys) {
  return keys.sort((a, b) => (PAPER_ORDER[a] ?? 99) - (PAPER_ORDER[b] ?? 99));
}

function buildMarketBreakdownHtml(marketBreakdown) {
  const marketKeys = sortByMarketOrder(Object.keys(marketBreakdown));
  if (marketKeys.length === 0) return '<div class="import-row"><span>—</span><span>0</span></div>';
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
        <div class="op-header"><span class="op-date">${op.date}</span></div>
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

  const content = `
    <div class="import-row"><span>Позиций всего</span><span>${sec.positions.length}</span></div>
    <div class="import-row"><span>Итоговая стоимость</span><span><b>${formatRub(sec.totalValueKopecks)}</b></span></div>
    <div class="import-section-title">По типам</div>
    ${typeStatsHtml}
    <div class="import-section-title">Примеры позиций (по 5 на тип)</div>
    ${paperRows}
  `;

  return wrapCollapsible(
    'Остатки ценных бумаг',
    `${sec.positions.length} · ${formatRub(sec.totalValueKopecks)}`,
    content
  );
}

function buildTradesPreviewHtml(tr) {
  if (!tr || tr.trades.length === 0) return '';

  const marketRows = sortByMarketOrder(Object.keys(tr.marketBreakdown))
    .map(mkt => `<div class="import-row sub"><span>${mkt}</span><span>${tr.marketBreakdown[mkt]}</span></div>`)
    .join('');

  const typeRows = Object.entries(tr.typeBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `<div class="import-row sub"><span>${t}</span><span>${c}</span></div>`)
    .join('');

  const sampleRows = tr.trades.slice(0, 5).map(t => `
    <div class="op-row">
      <div class="op-header">
        <span class="op-date">${t.trade_date}</span>
        ${t.market ? `<span class="op-market">${t.market}</span>` : ''}
      </div>
      <div class="op-body">
        <div class="op-left">
          <div class="op-type">${t.trade_type} · ${t.name}</div>
          <div class="op-comment">${formatNum(t.quantity, 0)} шт × ${formatNum(t.price, 4)} ${t.currency || ''} · № ${t.trade_number}</div>
        </div>
        <div class="op-amount">${formatRub(t.amount_kopecks)}</div>
      </div>
    </div>
  `).join('');

  const content = `
    ${tr.duplicates > 0 ? `<div class="import-row"><span>Удалено дубликатов</span><span>${tr.duplicates}</span></div>` : ''}
    <div class="import-section-title">По рынкам</div>
    ${marketRows || '<div class="import-row sub"><span>—</span><span>0</span></div>'}
    <div class="import-section-title">По видам сделок</div>
    ${typeRows || '<div class="import-row sub"><span>—</span><span>0</span></div>'}
    <div class="import-section-title">Первые 5 сделок</div>
    <div class="op-list">${sampleRows}</div>
  `;

  const summaryText = tr.duplicates > 0
    ? `${tr.trades.length} (+${tr.duplicates} дубл.)`
    : `${tr.trades.length}`;

  return wrapCollapsible('Сделки с ценными бумагами', summaryText, content);
}

function buildMovementsPreviewHtml(mv) {
  if (!mv || mv.movements.length === 0) return '';

  const typeRows = Object.entries(mv.typeStats)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `<div class="import-row sub"><span>${t}</span><span>${c}</span></div>`)
    .join('');

  const sampleRows = mv.movements.slice(0, 5).map(m => `
    <div class="op-row">
      <div class="op-header"><span class="op-date">${m.movement_date}</span></div>
      <div class="op-body">
        <div class="op-left">
          <div class="op-type">${m.operation_type} · ${m.name}</div>
          ${m.comment ? `<div class="op-comment">${m.comment}</div>` : ''}
        </div>
        <div class="op-amount">${formatNum(m.quantity, 0)} шт</div>
      </div>
    </div>
  `).join('');

  const content = `
    <div class="import-section-title">По типам операций</div>
    ${typeRows}
    <div class="import-section-title">Первые 5 операций</div>
    <div class="op-list">${sampleRows}</div>
  `;

  return wrapCollapsible('Движение ценных бумаг', `${mv.movements.length}`, content);
}

function buildFuturesTradesPreviewHtml(ft) {
  if (!ft || ft.trades.length === 0) return '';

  const typeRows = Object.entries(ft.typeStats)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `<div class="import-row sub"><span>${t}</span><span>${c}</span></div>`)
    .join('');

  const sampleRows = ft.trades.slice(0, 5).map(t => `
    <div class="op-row">
      <div class="op-header">
        <span class="op-date">${t.trade_date}</span>
      </div>
      <div class="op-body">
        <div class="op-left">
          <div class="op-type">${t.trade_type} · ${t.contract_code}</div>
          <div class="op-comment">
            ${formatNum(t.quantity, 0)} шт × ${formatNum(t.price, 4)} п.
            ${t.counterparty ? ' · ' + t.counterparty : ''}
          </div>
        </div>
      </div>
    </div>
  `).join('');

  const errorsHtml = ft.errors.length
    ? `<div class="import-errors">
         <div class="import-headers-label">Ошибки по производным (${ft.errors.length}):</div>
         ${ft.errors.slice(0, 5).map(e => `<div class="import-error">${e}</div>`).join('')}
       </div>`
    : '';

  const content = `
    <div class="import-section-title">По видам сделок</div>
    ${typeRows}
    <div class="import-section-title">Первые 5 сделок</div>
    <div class="op-list">${sampleRows}</div>
    ${errorsHtml}
  `;

  return wrapCollapsible('Сделки по производным', `${ft.trades.length}`, content);
}

// ===== Preview 1: Метаданные отчёта =====

function buildMetadataPreviewHtml(meta) {
  if (!meta) return '';
  const rows = [];
  if (meta.broker) rows.push(`<div class="import-row"><span>Брокер</span><span>${meta.broker}</span></div>`);
  if (meta.period_from) rows.push(`<div class="import-row"><span>Период</span><span>${meta.period_from} → ${meta.period_to}</span></div>`);
  if (meta.client) rows.push(`<div class="import-row"><span>Клиент</span><span>${meta.client}</span></div>`);
  if (meta.inn) rows.push(`<div class="import-row"><span>ИНН</span><span>${meta.inn}</span></div>`);
  if (meta.contract) rows.push(`<div class="import-row"><span>Соглашение</span><span>${meta.contract}</span></div>`);
  if (meta.subaccount) rows.push(`<div class="import-row"><span>Субсчёт</span><span>${meta.subaccount}</span></div>`);
  if (meta.account_number) rows.push(`<div class="import-row"><span>Лицевой счёт</span><span>${meta.account_number}</span></div>`);
  if (meta.report_date) rows.push(`<div class="import-row"><span>Дата формирования</span><span>${meta.report_date}</span></div>`);
  if (meta.cny_start_rate != null) rows.push(`<div class="import-row"><span>Курс CNY на начало</span><span>${meta.cny_start_rate}</span></div>`);
  if (meta.cny_end_rate != null) rows.push(`<div class="import-row"><span>Курс CNY на конец</span><span>${meta.cny_end_rate}</span></div>`);

  if (rows.length === 0) return '';

  const summary = meta.subaccount ? `Субсчёт ${meta.subaccount}` : 'инфо';

  return wrapCollapsible('Метаданные отчёта', summary, rows.join(''));
}

// ===== Preview 2: Сводная информация по субсчёту =====

function buildAccountSummaryPreviewHtml(sum) {
  if (!sum || sum.items.length === 0) return '';

  const rows = sum.items.map(it => `
    <div class="import-row">
      <span>${it.description}</span>
      <span>${it.amount != null ? formatNum(it.amount, 2) : '—'} ${it.currency}</span>
    </div>
  `).join('');

  return wrapCollapsible('Сводная информация по субсчёту', `${sum.items.length} строк`, rows);
}

// ===== Preview 3: Остатки денежных средств =====

function buildCashBalancesPreviewHtml(bal) {
  if (!bal || bal.rows.length === 0) return '';

  const rowsHtml = bal.rows.map(row => {
    // totals — массив из значений в колонках «Итого»
    // Обычно это [входящий_итого, исходящий_итого, плановый_исходящий]
    const t = row.totals;
    const incoming = t[0];
    const outgoing = t[1];
    const planned = t[2];

    const incomingStr = incoming != null ? formatNum(incoming, 2) : '—';
    const outgoingStr = outgoing != null ? formatNum(outgoing, 2) : '—';
    const plannedStr = planned != null ? formatNum(planned, 2) : '—';

    return `
      <div class="import-row sub">
        <span><b>${row.label}</b></span>
        <span></span>
      </div>
      <div class="import-row sub">
        <span style="padding-left: 24px">Входящий</span>
        <span>${incomingStr}</span>
      </div>
      <div class="import-row sub">
        <span style="padding-left: 24px">Исходящий</span>
        <span>${outgoingStr}</span>
      </div>
      <div class="import-row sub">
        <span style="padding-left: 24px">Плановый исходящий</span>
        <span>${plannedStr}</span>
      </div>
    `;
  }).join('');

  return wrapCollapsible('Остатки денежных средств', `${bal.rows.length} валют`, rowsHtml);
}

// ===== Preview 4: Открытые позиции по производным =====

function buildFuturesPositionsPreviewHtml(fp) {
  if (!fp || fp.positions.length === 0) return '';

  const positionsHtml = fp.positions.map(p => `
    <div class="pos-row">
      <div class="pos-name">${p.contract_code}</div>
      <div class="pos-meta">
        Вход ${formatNum(p.incoming_qty, 0)} → Выход ${formatNum(p.outgoing_qty, 0)}
        ${p.margin != null ? ` · маржа ${formatNum(p.margin, 2)}` : ''}
        ${p.expiration_date ? ` · экспирация ${p.expiration_date}` : ''}
      </div>
    </div>
  `).join('');

  const extraRows = [];
  if (fp.go_total != null) extraRows.push(`<div class="import-row"><span>Итоговая величина ГО</span><span>${formatNum(fp.go_total, 2)}</span></div>`);
  if (fp.free_cash != null) extraRows.push(`<div class="import-row"><span>Свободный остаток</span><span>${formatNum(fp.free_cash, 2)}</span></div>`);

  const content = `
    ${extraRows.join('')}
    <div class="import-section-title">Позиции</div>
    <div class="pos-list">${positionsHtml}</div>
  `;

  return wrapCollapsible('Открытые позиции по производным', `${fp.positions.length}`, content);
}

// ===== Preview: Сделки с иностранной валютой =====

function buildCurrencyTradesPreviewHtml(ct) {
  if (!ct || ct.trades.length === 0) return '';

  const typeRows = Object.entries(ct.typeStats)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `<div class="import-row sub"><span>${t}</span><span>${c}</span></div>`)
    .join('');

  const sampleRows = ct.trades.slice(0, 5).map(t => `
    <div class="op-row">
      <div class="op-header">
        <span class="op-date">${t.trade_date}</span>
        <span class="op-market">${t.market}</span>
      </div>
      <div class="op-body">
        <div class="op-left">
          <div class="op-type">${t.trade_type} · ${t.instrument}</div>
          <div class="op-comment">
            ${formatNum(t.quantity, 2)} × ${formatNum(t.price, 4)}
            · № ${t.trade_number}
            ${t.counterparty ? ' · ' + t.counterparty : ''}
          </div>
        </div>
        <div class="op-amount">${formatRub(t.amount_kopecks)}</div>
      </div>
    </div>
  `).join('');

  const content = `
    <div class="import-row"><span>Общий оборот</span><span>${formatRub(Math.round(ct.totalVolume))}</span></div>
    <div class="import-section-title">По видам сделок</div>
    ${typeRows}
    <div class="import-section-title">Первые 5 сделок</div>
    <div class="op-list">${sampleRows}</div>
  `;

  return wrapCollapsible('Сделки с иностранной валютой', `${ct.trades.length}`, content);
}

function buildCashPreview(fileName, workbook, parsedCash, parsedSec, parsedTrades, parsedMv, parsedFutures, parsedMeta, parsedSummary, parsedBalances, parsedFuturesPositions, parsedCurrencyTrades) {
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

  // Блок 1: Остатки ЦБ
  const securitiesHtml = parsedSec ? buildSecuritiesPreviewHtml(parsedSec) : '';

  const metaHtml = parsedMeta ? buildMetadataPreviewHtml(parsedMeta) : '';
  const summaryHtml = parsedSummary ? buildAccountSummaryPreviewHtml(parsedSummary) : '';
  const balancesHtml = parsedBalances ? buildCashBalancesPreviewHtml(parsedBalances) : '';
  const futuresPositionsHtml = parsedFuturesPositions ? buildFuturesPositionsPreviewHtml(parsedFuturesPositions) : '';
  const currencyTradesHtml = parsedCurrencyTrades ? buildCurrencyTradesPreviewHtml(parsedCurrencyTrades) : '';
	
  // Блок 2: Движение ЦБ
  const movementsHtml = parsedMv ? buildMovementsPreviewHtml(parsedMv) : '';

  // Блок 3: Сделки с ЦБ
  const tradesHtml = parsedTrades ? buildTradesPreviewHtml(parsedTrades) : '';

  // Блок 4: Сделки по производным
  const futuresHtml = parsedFutures ? buildFuturesTradesPreviewHtml(parsedFutures) : '';

  // Блок 5: Денежные операции
  const marketBreakdownHtml = buildMarketBreakdownHtml(parsedCash.marketBreakdown);
  const sampleOperationsHtml = buildSampleOperationsHtml(parsedCash.operations);

  const cashContent = `
    <div class="import-row"><span>Период</span><span>${periodHtml}</span></div>
    <div class="import-section-title">По рынкам и типам операций</div>
    ${marketBreakdownHtml}
    ${opsCount > 0 ? `
      <div class="import-section-title">Примеры операций (по 5 на каждый рынок)</div>
      ${sampleOperationsHtml}
    ` : ''}
  `;
  const cashHtml = wrapCollapsible('Денежные операции', `${opsCount}`, cashContent);

  const allErrors = [
    ...parsedCash.errors,
    ...(parsedSec ? parsedSec.errors : []),
    ...(parsedTrades ? parsedTrades.errors : []),
    ...(parsedMv ? parsedMv.errors : []),
    ...(parsedFutures ? parsedFutures.errors : [])
  ];

  const errorsHtml = allErrors.length
    ? `<details class="preview-block preview-block-error">
         <summary class="preview-block-header">
           <span class="preview-block-title">Ошибки</span>
           <span class="preview-block-summary">${allErrors.length}</span>
         </summary>
         <div class="preview-block-body">
           ${allErrors.slice(0, 10).map(e => `<div class="import-error">${e}</div>`).join('')}
           ${allErrors.length > 10 ? `<div class="import-note">…и ещё ${allErrors.length - 10}</div>` : ''}
         </div>
       </details>`
    : '';

  return `
    <div class="import-file-name">📄 ${fileName}</div>
    <div class="import-row"><span>Тип отчёта</span><span>${typeLabel}</span></div>
    <div class="import-row"><span>Листов</span><span>${workbook.SheetNames.length}</span></div>
    <ul class="import-sheets">${sheetsInfo}</ul>

    ${metaHtml}
    ${summaryHtml}
    ${balancesHtml}
    ${securitiesHtml}
    ${movementsHtml}
    ${tradesHtml}
    ${futuresHtml}
    ${futuresPositionsHtml}
    ${currencyTradesHtml}
    ${cashHtml}
    ${errorsHtml}

    <div class="import-note">Проверьте данные. Запись в базу будет на следующем шаге.</div>
  `;
}

// ============================================================
// ===== Этап 3.4.2: Функции записи в базу ====================
// ============================================================

// --- Аккаунты (субсчета) ---

// Находит аккаунт по коду субсчёта или создаёт новый.
// Возвращает account_id.
async function findOrCreateAccount(subaccountCode, brokerName) {
  const code = (subaccountCode || 'MAIN').trim();
  const existing = await window.db.select(
    'SELECT id FROM accounts WHERE code = ? LIMIT 1',
    [code]
  );
  if (existing.length > 0) return existing[0].id;

  // Создаём новый
  const name = code === 'MAIN' ? 'Основной счёт' : `Субсчёт ${code}`;
  await window.db.run(
    'INSERT INTO accounts (code, name, display_name, broker, currency, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [code, name, name, brokerName || null, 'RUB']
  );
  const rows = await window.db.select('SELECT id FROM accounts WHERE code = ? LIMIT 1', [code]);
  return rows[0].id;
}

// --- Ценные бумаги ---

// Находит или создаёт бумагу по ISIN. Возвращает security_id.
async function findOrCreateSecurity(pos) {
  if (!pos.isin) return null;
  const existing = await window.db.select(
    'SELECT id FROM securities WHERE isin = ? LIMIT 1',
    [pos.isin]
  );
  if (existing.length > 0) {
    // Обновляем справочные данные, если они изменились
    await window.db.run(
      `UPDATE securities SET
        name = COALESCE(?, name),
        type = COALESCE(?, type),
        currency = COALESCE(?, currency),
        nominal = COALESCE(?, nominal),
        coupon_rate = COALESCE(?, coupon_rate),
        maturity_date = COALESCE(?, maturity_date),
        last_seen_date = COALESCE(?, last_seen_date)
       WHERE id = ?`,
      [pos.name, pos.type, pos.currency, pos.nominal, pos.coupon_rate,
       pos.payment_date, pos.snapshot_date, existing[0].id]
    );
    return existing[0].id;
  }

  await window.db.run(
    `INSERT INTO securities
      (isin, reg_number, name, type, currency, nominal, coupon_rate, maturity_date, last_seen_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pos.isin, pos.reg_number || null, pos.name, pos.type, pos.currency,
     pos.nominal, pos.coupon_rate, pos.payment_date, pos.snapshot_date]
  );
  const rows = await window.db.select('SELECT id FROM securities WHERE isin = ? LIMIT 1', [pos.isin]);
  return rows[0].id;
}

// --- Сделки с ЦБ ---

async function saveTrades(trades, accountId) {
  if (!trades || trades.length === 0) return { saved: 0, skipped: 0 };

  let saved = 0, skipped = 0;
  const queries = [];

  for (const t of trades) {
    const exists = await window.db.select(
      'SELECT id FROM trades WHERE trade_number = ? LIMIT 1',
      [t.trade_number]
    );
    if (exists.length > 0) { skipped++; continue; }

    queries.push({
      type: 'run',
      sql: `INSERT OR IGNORE INTO trades
        (trade_number, account_id, security_isin, security_name, trade_date, trade_type,
         quantity, price, currency, currency_settle, amount_kopecks, nkd_kopecks,
         commission_calc_kopecks, commission_exec_kopecks, counterparty, place, market)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        t.trade_number, accountId, t.isin || null, t.name, t.trade_date, t.trade_type,
        t.quantity, t.price, t.currency || null, t.currency_settle || null,
        t.amount_kopecks, t.nkd_kopecks,
        t.commission_calc_kopecks, t.commission_exec_kopecks,
        t.counterparty, t.place, t.market
      ]
    });
    saved++;
  }

  if (queries.length > 0) {
    try {
      await window.db.transaction(queries);
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        console.warn('[trades] Дубликаты, часть пропущена');
        return { saved: Math.floor(saved / 2), skipped: Math.ceil(saved / 2) };
      }
      throw err;
    }
  }
  return { saved, skipped };
}

// --- Сделки по производным ---

async function saveFuturesTrades(trades, accountId) {
  if (!trades || trades.length === 0) return { saved: 0, skipped: 0 };

  let saved = 0, skipped = 0;
  const queries = [];

  for (const t of trades) {
    const exists = await window.db.select(
      'SELECT id FROM futures_trades WHERE external_hash = ? LIMIT 1',
      [t.external_hash]
    );
    if (exists.length > 0) { skipped++; continue; }

    queries.push({
      type: 'run',
      sql: `INSERT OR IGNORE INTO futures_trades
        (account_id, contract_code, trade_date, trade_type, quantity, price, strike_price,
         commission_calc_kopecks, commission_exec_kopecks, counterparty, place, comment,
         market, external_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        accountId, t.contract_code, t.trade_date, t.trade_type, t.quantity, t.price,
        t.strike_price, t.commission_calc_kopecks, t.commission_exec_kopecks,
        t.counterparty, t.place, t.comment, t.market, t.external_hash
      ]
    });
    saved++;
  }

  if (queries.length > 0) {
    try {
      await window.db.transaction(queries);
    } catch (err) {
      // Если часть сделок всё-таки дублируется — считаем их пропущенными
      if (/UNIQUE constraint failed/i.test(err.message)) {
        console.warn('[futures_trades] Обнаружены дубликаты, часть сделок пропущена');
        // Пересчитываем сколько реально сохранилось
        const after = await window.db.select(
          'SELECT COUNT(*) AS n FROM futures_trades WHERE account_id = ?',
          [accountId]
        );
        // Точно определить сколько сохранилось невозможно без сложного анализа,
        // поэтому возвращаем консервативную оценку
        return { saved: Math.floor(saved / 2), skipped: Math.ceil(saved / 2) };
      }
      throw err;
    }
  }
  return { saved, skipped };
}

// --- Валютные сделки ---

async function saveCurrencyTrades(trades, accountId) {
  if (!trades || trades.length === 0) return { saved: 0, skipped: 0 };

  let saved = 0, skipped = 0;
  const queries = [];

  for (const t of trades) {
    const exists = await window.db.select(
      'SELECT id FROM currency_trades WHERE trade_number = ? LIMIT 1',
      [t.trade_number]
    );
    if (exists.length > 0) { skipped++; continue; }

    queries.push({
      type: 'run',
      sql: `INSERT OR IGNORE INTO currency_trades
        (account_id, trade_number, instrument, trade_date, trade_type, quantity, price,
         currency, amount_kopecks, commission_calc_kopecks, commission_exec_kopecks,
         execution_date, counterparty, place, comment, market)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        accountId, t.trade_number, t.instrument, t.trade_date, t.trade_type,
        t.quantity, t.price, t.currency, t.amount_kopecks,
        t.commission_calc_kopecks, t.commission_exec_kopecks,
        t.execution_date, t.counterparty, t.place, t.comment, t.market
      ]
    });
    saved++;
  }

  if (queries.length > 0) {
    try {
      await window.db.transaction(queries);
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        console.warn('[currency_trades] Дубликаты, часть пропущена');
        return { saved: Math.floor(saved / 2), skipped: Math.ceil(saved / 2) };
      }
      throw err;
    }
  }
  return { saved, skipped };
}

// --- Денежные операции ---

async function saveCashOperations(operations, accountId) {
  if (!operations || operations.length === 0) return { saved: 0, skipped: 0 };

  let saved = 0, skipped = 0;
  const queries = [];

  for (const op of operations) {
    const exists = await window.db.select(
      'SELECT id FROM cash_operations WHERE external_hash = ? LIMIT 1',
      [op.external_hash]
    );
    if (exists.length > 0) { skipped++; continue; }

    queries.push({
      type: 'run',
      sql: `INSERT INTO cash_operations
        (account_id, operation_date, operation_type, amount_kopecks, currency,
         comment, market, external_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        accountId, op.date, op.operation_type, op.amount_kopecks, op.currency,
        op.comment, op.market, op.external_hash
      ]
    });
    saved++;
  }

  if (queries.length > 0) {
    await window.db.transaction(queries);
  }
  return { saved, skipped };
}

// --- Остатки ЦБ (позиции) ---

async function saveSecurities(positions, accountId, snapshotDate) {
  if (!positions || positions.length === 0) return { saved: 0 };

  let saved = 0;
  for (const p of positions) {
    p.snapshot_date = snapshotDate;
    await findOrCreateSecurity(p);
    saved++;
  }
  return { saved };
}

// --- Позиции на дату (снимок бумаг в портфеле) ---

async function savePositions(positions, accountId, snapshotDate) {
  if (!positions || positions.length === 0) return { saved: 0, skipped: 0 };

  let saved = 0, skipped = 0;
  const queries = [];

  for (const p of positions) {
    if (!p.isin) continue;

    const hash = [p.isin, snapshotDate, accountId].join('|');
    const exists = await window.db.select(
      'SELECT id FROM positions WHERE external_hash = ? LIMIT 1',
      [hash]
    );
    if (exists.length > 0) { skipped++; continue; }

    queries.push({
      type: 'run',
      sql: `INSERT OR IGNORE INTO positions
        (account_id, snapshot_date, security_isin, security_name, security_type,
         quantity, price, currency, nominal, nkd, coupon_rate, payment_date,
         value_rub_kopecks, planned_value_rub_kopecks, external_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        accountId, snapshotDate, p.isin, p.name, p.type,
        p.outgoing_qty, p.price, p.currency, p.nominal, p.nkd,
        p.coupon_rate, p.payment_date,
        p.value_rub_kopecks, p.planned_value_rub_kopecks, hash
      ]
    });
    saved++;
  }

  if (queries.length > 0) {
    try {
      await window.db.transaction(queries);
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        console.warn('[positions] Дубликаты, часть пропущена');
        return { saved: Math.floor(saved / 2), skipped: Math.ceil(saved / 2) };
      }
      throw err;
    }
  }
  return { saved, skipped };
}

// --- Снимок портфеля ---

async function savePortfolioSnapshot(accountId, snapshotDate, parsedSec, parsedBalances) {
  // Итоговая стоимость бумаг
  const totalValueKopecks = parsedSec ? parsedSec.totalValueKopecks : 0;

  // Денежные остатки
  let cashRub = 0, cashCny = 0, cashUsd = 0;
  if (parsedBalances && parsedBalances.rows) {
    for (const row of parsedBalances.rows) {
      // totals = [входящий, исходящий, плановый]
      // Берём исходящий (t[1])
      const outgoing = row.totals && row.totals[1];
      if (outgoing == null) continue;

      const label = row.label.toUpperCase();
      if (label === 'RUR' || label === 'RUB') cashRub += Math.round(outgoing * 100);
      else if (label === 'CNY') cashCny += Math.round(outgoing * 100);
      else if (label === 'USD') cashUsd += Math.round(outgoing * 100);
    }
  }

  const totalWithCash = totalValueKopecks + cashRub + cashCny + cashUsd;

  // Проверяем, есть ли уже снимок за эту дату и счёт
  const existing = await window.db.select(
    'SELECT id FROM portfolio_snapshots WHERE snapshot_date = ? AND account_id = ? LIMIT 1',
    [snapshotDate, accountId]
  );

  if (existing.length > 0) {
    await window.db.run(
      `UPDATE portfolio_snapshots SET
        total_value_kopecks = ?, cash_rub_kopecks = ?, cash_cny_kopecks = ?,
        cash_usd_kopecks = ?, total_with_cash_kopecks = ?
       WHERE id = ?`,
      [totalValueKopecks, cashRub, cashCny, cashUsd, totalWithCash, existing[0].id]
    );
    return { updated: true };
  }

  await window.db.run(
    `INSERT INTO portfolio_snapshots
      (snapshot_date, account_id, total_value_kopecks, cash_rub_kopecks,
       cash_cny_kopecks, cash_usd_kopecks, total_with_cash_kopecks)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [snapshotDate, accountId, totalValueKopecks, cashRub, cashCny, cashUsd, totalWithCash]
  );
  return { created: true };
}

// --- Позиции производных ---

async function saveFuturesPositions(positions, accountId, snapshotDate) {
  if (!positions || positions.length === 0) return { saved: 0, skipped: 0 };

  let saved = 0, skipped = 0;
  const queries = [];

  for (const p of positions) {
    const hash = [p.contract_code, snapshotDate, accountId].join('|');
    const exists = await window.db.select(
      'SELECT id FROM futures_positions WHERE external_hash = ? LIMIT 1',
      [hash]
    );
    if (exists.length > 0) { skipped++; continue; }

    queries.push({
      type: 'run',
      sql: `INSERT INTO futures_positions
        (account_id, snapshot_date, contract_code, incoming_qty, added_qty, removed_qty,
         executed_qty, outgoing_qty, go, margin, expiration_date, external_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        accountId, snapshotDate, p.contract_code,
        p.incoming_qty, p.added_qty, p.removed_qty, p.executed_qty, p.outgoing_qty,
        p.go, p.margin, p.expiration_date, hash
      ]
    });
    saved++;
  }

  if (queries.length > 0) {
    await window.db.transaction(queries);
  }
  return { saved, skipped };
}

// --- Снимок отчёта (метаданные + сводка) ---

async function saveReportSnapshot(importLogId, accountId, meta, parsedSec, parsedBalances) {
  const totalValueKopecks = parsedSec ? parsedSec.totalValueKopecks : null;

  // Денежные остатки (исходящие)
  let cashRub = null, cashCny = null, cashUsd = null;
  if (parsedBalances && parsedBalances.rows) {
    for (const row of parsedBalances.rows) {
      const outgoing = row.totals && row.totals[1];
      if (outgoing == null) continue;
      const label = row.label.toUpperCase();
      if (label === 'RUR' || label === 'RUB') cashRub = Math.round(outgoing * 100);
      else if (label === 'CNY') cashCny = Math.round(outgoing * 100);
      else if (label === 'USD') cashUsd = Math.round(outgoing * 100);
    }
  }

  await window.db.run(
    `INSERT OR REPLACE INTO report_snapshots
      (report_log_id, account_id, snapshot_date, broker, period_from, period_to,
       client_name, inn, contract, subaccount_code, account_number,
       cny_start_rate, cny_end_rate, total_value_kopecks,
       cash_rub_kopecks, cash_cny_kopecks, cash_usd_kopecks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      importLogId, accountId, new Date().toISOString().slice(0, 10),
      meta.broker, meta.period_from, meta.period_to,
      meta.client, meta.inn, meta.contract, meta.subaccount, meta.account_number,
      meta.cny_start_rate, meta.cny_end_rate, totalValueKopecks,
      cashRub, cashCny, cashUsd
    ]
  );
}

// --- Лог импорта ---

async function createImportLog(fileName, reportType, meta, accountId) {
  await window.db.run(
    `INSERT INTO import_log
      (file_name, import_date, report_type, period_start, period_end, account_id, subaccount_code, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileName,
      new Date().toISOString(),
      reportType,
      meta && meta.period_from ? meta.period_from : null,
      meta && meta.period_to ? meta.period_to : null,
      accountId,
      meta && meta.subaccount ? meta.subaccount : null,
      'in_progress'
    ]
  );
  const rows = await window.db.select('SELECT last_insert_rowid() AS id');
  return rows[0].id;
}

async function finishImportLog(importLogId, stats) {
  await window.db.run(
    `UPDATE import_log SET
      operations_count = ?, duplicates_count = ?, errors_count = ?, status = ?
     WHERE id = ?`,
    [stats.operations_count || 0, stats.duplicates_count || 0,
     stats.errors_count || 0, stats.status || 'success', importLogId]
  );
}

// --- Главная функция импорта ---

// Принимает распарсенные данные, имя файла, аккаунт
// Возвращает статистику: { status, saved, skipped, errors, logId }
async function performImport(fileName, parsed) {
  const stats = {
    logId: null,
    accountId: null,
    saved: {
      trades: 0,
      futures_trades: 0,
      currency_trades: 0,
      cash_operations: 0,
      securities: 0,
      positions: 0,
      futures_positions: 0,
      snapshots: 0
    },
    skipped: {
      trades: 0,
      futures_trades: 0,
      currency_trades: 0,
      cash_operations: 0,
      positions: 0,
      futures_positions: 0
    },
    errors: [],
    status: 'in_progress'
  };

  try {
    // 1. Определяем счёт по метаданным
    const meta = parsed.meta || {};
    const subaccountCode = meta.subaccount || 'MAIN';
    const brokerName = meta.broker || null;

    stats.accountId = await findOrCreateAccount(subaccountCode, brokerName);

    // 2. Определяем дату снимка (дата окончания периода отчёта)
    let snapshotDate = null;
    if (meta.period_to) {
      // Формат DD.MM.YYYY → YYYY-MM-DD
      const m = meta.period_to.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (m) snapshotDate = `${m[3]}-${m[2]}-${m[1]}`;
    }
    if (!snapshotDate) {
      snapshotDate = new Date().toISOString().slice(0, 10);
    }

    // 3. Создаём запись в import_log
    stats.logId = await createImportLog(
      fileName, 'brokerage', meta, stats.accountId
    );

    // 4. Сохраняем справочник бумаг (без дубликатов)
    if (parsed.securities && parsed.securities.positions.length > 0) {
      const r = await saveSecurities(parsed.securities.positions, stats.accountId, snapshotDate);
      stats.saved.securities = r.saved;
    }

	// 4.1. Позиции на дату (снимок портфеля)
    if (parsed.securities && parsed.securities.positions.length > 0) {
      const r = await savePositions(parsed.securities.positions, stats.accountId, snapshotDate);
      stats.saved.positions = r.saved;
      stats.skipped.positions = r.skipped;
    }
	
    // 5. Сделки с ЦБ
    if (parsed.trades && parsed.trades.trades.length > 0) {
      const r = await saveTrades(parsed.trades.trades, stats.accountId);
      stats.saved.trades = r.saved;
      stats.skipped.trades = r.skipped;
    }

    // 6. Сделки с производными
    if (parsed.futures && parsed.futures.trades.length > 0) {
      const r = await saveFuturesTrades(parsed.futures.trades, stats.accountId);
      stats.saved.futures_trades = r.saved;
      stats.skipped.futures_trades = r.skipped;
    }

    // 7. Валютные сделки
    if (parsed.currencyTrades && parsed.currencyTrades.trades.length > 0) {
      const r = await saveCurrencyTrades(parsed.currencyTrades.trades, stats.accountId);
      stats.saved.currency_trades = r.saved;
      stats.skipped.currency_trades = r.skipped;
    }

    // 8. Денежные операции
    if (parsed.cash && parsed.cash.operations.length > 0) {
      const r = await saveCashOperations(parsed.cash.operations, stats.accountId);
      stats.saved.cash_operations = r.saved;
      stats.skipped.cash_operations = r.skipped;
    }

    // 9. Открытые позиции по производным
    if (parsed.futuresPositions && parsed.futuresPositions.positions.length > 0) {
      const r = await saveFuturesPositions(
        parsed.futuresPositions.positions, stats.accountId, snapshotDate
      );
      stats.saved.futures_positions = r.saved;
      stats.skipped.futures_positions = r.skipped;
    }

    // 10. Снимок портфеля
    const snapR = await savePortfolioSnapshot(
      stats.accountId, snapshotDate, parsed.securities, parsed.balances
    );
    stats.saved.snapshots = snapR.created || snapR.updated ? 1 : 0;

    // 11. Снимок отчёта (метаданные + агрегаты)
    await saveReportSnapshot(
      stats.logId, stats.accountId, meta, parsed.securities, parsed.balances
    );

    // 12. Собираем все ошибки парсеров
    if (parsed.cash && parsed.cash.errors) stats.errors.push(...parsed.cash.errors);
    if (parsed.securities && parsed.securities.errors) stats.errors.push(...parsed.securities.errors);
    if (parsed.trades && parsed.trades.errors) stats.errors.push(...parsed.trades.errors);
    if (parsed.movements && parsed.movements.errors) stats.errors.push(...parsed.movements.errors);
    if (parsed.futures && parsed.futures.errors) stats.errors.push(...parsed.futures.errors);
    if (parsed.futuresPositions && parsed.futuresPositions.errors) stats.errors.push(...parsed.futuresPositions.errors);
    if (parsed.currencyTrades && parsed.currencyTrades.errors) stats.errors.push(...parsed.currencyTrades.errors);

    // 13. Обновляем import_log
    const totalSaved = Object.values(stats.saved).reduce((s, v) => s + v, 0);
    const totalSkipped = Object.values(stats.skipped).reduce((s, v) => s + v, 0);

    await finishImportLog(stats.logId, {
      operations_count: totalSaved,
      duplicates_count: totalSkipped,
      errors_count: stats.errors.length,
      status: 'success'
    });

    stats.status = 'success';
    return stats;

  } catch (err) {
    console.error('[import] Критическая ошибка:', err);
    stats.errors.push('Критическая ошибка импорта: ' + err.message);
    stats.status = 'failed';

    if (stats.logId) {
      try {
        await finishImportLog(stats.logId, {
          operations_count: 0,
          duplicates_count: 0,
          errors_count: stats.errors.length,
          status: 'failed'
        });
      } catch (e) {
        console.error('[import] Не удалось обновить лог:', e);
      }
    }
    return stats;
  }
}

// ============================================================
// ===== Этап 3.4.4: UI импорта ==============================
// ============================================================

// Хранилище последнего распарсенного файла для импорта по кнопке
let pendingImport = null;

// Показать предпросмотр с кнопками импорта
function setPreviewWithActions(html, parsed, fileName) {
  pendingImport = { parsed, fileName };
  const el = document.getElementById('importPreview');
  if (!el) return;
  el.innerHTML = html + `
    <div class="import-actions">
      <button class="primary-btn" id="doImportBtn">Импортировать в базу</button>
      <button class="secondary-btn" id="exportBeforeBtn">Экспорт базы (.db)</button>
    </div>
    <div id="importResult"></div>
  `;
  el.style.borderLeft = '4px solid var(--primary)';

  const doBtn = document.getElementById('doImportBtn');
  const exportBtn = document.getElementById('exportBeforeBtn');

  if (doBtn) doBtn.addEventListener('click', doImportPending);
  if (exportBtn) exportBtn.addEventListener('click', exportDatabase);
}

// Выполнить импорт текущего файла
async function doImportPending() {
  if (!pendingImport) return;

  const { parsed, fileName } = pendingImport;
  const resultEl = document.getElementById('importResult');
  const doBtn = document.getElementById('doImportBtn');

  if (doBtn) {
    doBtn.disabled = true;
    doBtn.textContent = 'Импорт...';
  }
  if (resultEl) {
    resultEl.innerHTML = '<div class="import-note">Идёт запись в базу...</div>';
  }

  try {
    const stats = await performImport(fileName, parsed);

    // Формируем отчёт
    const totalSaved = Object.values(stats.saved).reduce((s, v) => s + v, 0);
    const totalSkipped = Object.values(stats.skipped).reduce((s, v) => s + v, 0);

    let html = '';
    if (stats.status === 'success') {
      html += `<div class="import-success">✓ Импорт завершён</div>`;
      html += `<div class="import-row"><span>Сохранено записей</span><span><b>${totalSaved}</b></span></div>`;
      if (totalSkipped > 0) {
        html += `<div class="import-row"><span>Пропущено дубликатов</span><span>${totalSkipped}</span></div>`;
      }
      html += `<div class="import-row"><span>Сделки с ЦБ</span><span>${stats.saved.trades}</span></div>`;
      if (stats.saved.futures_trades > 0)
        html += `<div class="import-row"><span>Сделки производные</span><span>${stats.saved.futures_trades}</span></div>`;
      if (stats.saved.currency_trades > 0)
        html += `<div class="import-row"><span>Валютные сделки</span><span>${stats.saved.currency_trades}</span></div>`;
      html += `<div class="import-row"><span>Денежные операции</span><span>${stats.saved.cash_operations}</span></div>`;
      html += `<div class="import-row"><span>Справочник бумаг</span><span>${stats.saved.securities}</span></div>`;
      if (stats.saved.positions > 0)
        html += `<div class="import-row"><span>Позиции</span><span>${stats.saved.positions}</span></div>`;
	  if (stats.saved.futures_positions > 0)
        html += `<div class="import-row"><span>Позиции производные</span><span>${stats.saved.futures_positions}</span></div>`;
      html += `<div class="import-row"><span>Снимок портфеля</span><span>${stats.saved.snapshots}</span></div>`;
    } else {
      html += `<div class="import-error">✗ Импорт не выполнен</div>`;
    }

    if (stats.errors && stats.errors.length > 0) {
      html += `<div class="import-errors">
        <div class="import-headers-label">Ошибки (${stats.errors.length}):</div>
        ${stats.errors.slice(0, 5).map(e => `<div class="import-error">${e}</div>`).join('')}
        ${stats.errors.length > 5 ? `<div class="import-note">…и ещё ${stats.errors.length - 5}</div>` : ''}
      </div>`;
    }

    if (resultEl) resultEl.innerHTML = html;

    if (doBtn) {
      doBtn.disabled = false;
      doBtn.textContent = stats.status === 'success' ? 'Импортировать повторно' : 'Попробовать снова';
    }

    // Обновляем список импортов в настройках
    refreshImportLog();
  } catch (err) {
    console.error('[import] Ошибка:', err);
    if (resultEl) {
      resultEl.innerHTML = `<div class="import-error">Ошибка импорта: ${err.message}</div>`;
    }
    if (doBtn) {
      doBtn.disabled = false;
      doBtn.textContent = 'Попробовать снова';
    }
  }
}

// ===== Экспорт базы =====

async function exportDatabase() {
  try {
    // Читаем файл через SQLite VACUUM INTO (создаёт копию в виртуальной FS)
    // Альтернатива: используем OPFS getFile. Но проще — сделать бэкап через SQLite.
    // Используем sqlite3.serialize() — есть в WASM-версии.

    // Способ: экспортируем через sqlite3.capi.sqlite3_js_db_export
    // Но у нас не прямой доступ. Идём проще: выгружаем все данные в JSON как fallback.
    // Пока — заглушка. Настоящий экспорт .db будет позже через WASM API.

    // Простейший и надёжный экспорт: сохраняем БД через OPFS-файл.
    // В нашем db-worker используем db.exec("VACUUM INTO '/backup.db'")

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `investments_backup_${stamp}.db`;

    const result = await window.db.exec(
      `VACUUM INTO '/backup-${stamp}.db'`
    );

    // Теперь читаем файл через OPFS
    const root = await navigator.storage.getDirectory();
    const poolDir = await root.getDirectoryHandle('investments-pool', { create: false });
    const fileHandle = await poolDir.getFileHandle(`/backup-${stamp}.db`, { create: false });
    const file = await fileHandle.getFile();

    // Скачиваем
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[export] Файл скачан:', filename);
  } catch (err) {
    console.error('[export] Ошибка:', err);
    alert('Ошибка экспорта: ' + err.message);
  }
}

// ===== Список последних импортов =====

async function refreshImportLog() {
  const el = document.getElementById('importLogList');
  if (!el) return;

  // Если база ещё не готова — тихо выходим, повторим после инициализации
  if (!window.db || !window.db.ready) return;

  try {
    const rows = await window.db.select(
      `SELECT id, file_name, import_date, status, operations_count, duplicates_count, errors_count
       FROM import_log
       ORDER BY id DESC
       LIMIT 10`
    );

    if (rows.length === 0) {
      el.innerHTML = '<div class="placeholder">Импортов пока нет</div>';
      return;
    }

    el.innerHTML = rows.map(r => {
      const date = r.import_date ? r.import_date.slice(0, 19).replace('T', ' ') : '—';
      const statusIcon = r.status === 'success' ? '✓' : (r.status === 'failed' ? '✗' : '…');
      const statusClass = r.status === 'success' ? 'positive' : (r.status === 'failed' ? 'negative' : '');
      return `
        <div class="import-log-item">
          <div class="import-log-name">${statusIcon} ${r.file_name}</div>
          <div class="import-log-meta">
            ${date} · сохранено ${r.operations_count || 0}
            ${r.duplicates_count ? ` · пропущено ${r.duplicates_count}` : ''}
            ${r.errors_count ? ` · ошибок ${r.errors_count}` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('[import_log] Ошибка:', err);
    el.innerHTML = '<div class="import-error">Ошибка загрузки списка</div>';
  }
}

// ===== Очистка базы =====

async function wipeAllData() {
  const ok = confirm(
    'Удалить ВСЕ данные из базы? Это действие необратимо.\n\n' +
    'Убедитесь, что сделали экспорт базы перед этим.'
  );
  if (!ok) return;

  const ok2 = confirm('Точно удалить? Это последнее подтверждение.');
  if (!ok2) return;

  try {
    await window.db.exec("DELETE FROM trades");
    await window.db.exec("DELETE FROM futures_trades");
    await window.db.exec("DELETE FROM currency_trades");
    await window.db.exec("DELETE FROM cash_operations");
    await window.db.exec("DELETE FROM futures_positions");
    await window.db.exec("DELETE FROM portfolio_snapshots");
    await window.db.exec("DELETE FROM report_snapshots");
    await window.db.exec("DELETE FROM import_log");
    await window.db.exec("DELETE FROM import_errors");
    await window.db.exec("DELETE FROM securities");
    await window.db.exec("DELETE FROM lots");
    await window.db.exec("DELETE FROM lot_consumption");
    await window.db.exec("DELETE FROM payments");
    await window.db.exec("DELETE FROM taxes");
    // accounts не удаляем — оставляем MAIN
    await window.db.exec("DELETE FROM accounts WHERE code != 'MAIN'");

    alert('Все данные удалены. Основной счёт MAIN сохранён.');
    refreshImportLog();
    initDatabase();
  } catch (err) {
    console.error('[wipe] Ошибка:', err);
    alert('Ошибка очистки: ' + err.message);
  }
}

// ============================================================
// ===== Этап 4.1: Экран «Операции» ==========================
// ============================================================

const opState = {
  loaded: false,
  filters: {
    from: '',
    to: '',
    type: '',
    market: '',
    currency: '',
    account: '',
    search: '',
    order: 'desc'
  },
  allRows: [],       // все операции из базы, загруженные один раз
  filteredRows: [],  // результат фильтрации
  renderedCount: 0
};

// Инициализация экрана — заполняет выпадающие списки
async function initOperationsScreen() {
  if (!window.db || !window.db.ready) return;

  try {
    // Загружаем все операции
    const rows = await window.db.select(
      `SELECT co.id, co.operation_date, co.operation_type, co.amount_kopecks,
              co.currency, co.comment, co.market, co.account_id,
              a.code AS account_code, a.display_name AS account_name
       FROM cash_operations co
       LEFT JOIN accounts a ON a.id = co.account_id
       ORDER BY co.operation_date DESC, co.id DESC`
    );
    opState.allRows = rows;

    // Заполняем типы
    const types = [...new Set(rows.map(r => r.operation_type).filter(Boolean))].sort();
    const typeSelect = document.getElementById('opFilterType');
    if (typeSelect) {
      typeSelect.innerHTML = '<option value="">Все</option>' +
        types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }

    // Рынки
    const markets = [...new Set(rows.map(r => r.market).filter(Boolean))].sort();
    const marketSelect = document.getElementById('opFilterMarket');
    if (marketSelect) {
      marketSelect.innerHTML = '<option value="">Все</option>' +
        markets.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    }

    // Валюты
    const currencies = [...new Set(rows.map(r => r.currency).filter(Boolean))].sort();
    const currSelect = document.getElementById('opFilterCurrency');
    if (currSelect) {
      currSelect.innerHTML = '<option value="">Все</option>' +
        currencies.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }

    // Счета
    const accounts = await window.db.select('SELECT id, code, display_name, name FROM accounts ORDER BY id');
    const accSelect = document.getElementById('opFilterAccount');
    if (accSelect) {
      accSelect.innerHTML = '<option value="">Все</option>' +
        accounts.map(a => {
          const label = a.display_name || a.name || a.code;
          return `<option value="${a.id}">${escapeHtml(label)}</option>`;
        }).join('');
    }

    opState.loaded = true;
    applyOperationsFilters();
  } catch (err) {
    console.error('[operations] Ошибка инициализации:', err);
    const el = document.getElementById('opList');
    if (el) el.innerHTML = `<div class="import-error">Ошибка: ${escapeHtml(err.message)}</div>`;
  }
}

// Применяет фильтры и перерисовывает
function applyOperationsFilters() {
  const f = opState.filters;
  let rows = opState.allRows.slice();

  if (f.from) rows = rows.filter(r => r.operation_date >= f.from);
  if (f.to) rows = rows.filter(r => r.operation_date <= f.to);
  if (f.type) rows = rows.filter(r => r.operation_type === f.type);
  if (f.market) rows = rows.filter(r => r.market === f.market);
  if (f.currency) rows = rows.filter(r => r.currency === f.currency);
  if (f.account) rows = rows.filter(r => String(r.account_id) === f.account);
  if (f.search) {
    const q = f.search.toLowerCase();
    rows = rows.filter(r => (r.comment || '').toLowerCase().includes(q) || (r.operation_type || '').toLowerCase().includes(q));
  }

  // Сортировка
  rows.sort((a, b) => {
    const cmp = a.operation_date.localeCompare(b.operation_date);
    if (cmp !== 0) return f.order === 'asc' ? cmp : -cmp;
    return f.order === 'asc' ? a.id - b.id : b.id - a.id;
  });

  opState.filteredRows = rows;
  opState.renderedCount = 0;

  // Статистика
  let income = 0, expense = 0;
  for (const r of rows) {
    if (r.amount_kopecks > 0) income += r.amount_kopecks;
    else if (r.amount_kopecks < 0) expense += r.amount_kopecks;
  }
  document.getElementById('opCount').textContent = rows.length;
  document.getElementById('opIncome').textContent = formatRub(income);
  document.getElementById('opExpense').textContent = formatRub(expense);
  document.getElementById('opNet').textContent = formatRub(income + expense);

  // Счётчик активных фильтров
  const activeFilters = ['from','to','type','market','currency','account','search']
    .filter(k => f[k] !== '');
  const countEl = document.getElementById('opFilterCount');
  if (countEl) {
    countEl.textContent = activeFilters.length > 0 ? `· ${activeFilters.length}` : '';
  }
  
  // Список
  renderOperationsChunk();
}

// Рендерит следующую порцию записей
function renderOperationsChunk() {
  const listEl = document.getElementById('opList');
  if (!listEl) return;

  const chunk = opState.filteredRows.slice(opState.renderedCount, opState.renderedCount + 100);

  if (opState.renderedCount === 0) {
    if (opState.filteredRows.length === 0) {
      listEl.innerHTML = '<div class="placeholder">Операций по фильтру не найдено</div>';
      document.getElementById('opLoadMore').style.display = 'none';
      return;
    }
    listEl.innerHTML = '';
  }

  const html = chunk.map(op => {
    const sign = op.amount_kopecks >= 0 ? 'positive' : 'negative';
    const comment = op.comment ? escapeHtml(op.comment) : '';
    const marketLabel = op.market ? `<span class="op-market">${escapeHtml(op.market)}</span>` : '';
    const accountLabel = op.account_name || op.account_code || '';
    return `
      <div class="op-row">
        <div class="op-header">
          <span class="op-date">${op.operation_date}</span>
          ${marketLabel}
          ${accountLabel ? `<span class="op-account">${escapeHtml(accountLabel)}</span>` : ''}
        </div>
        <div class="op-body">
          <div class="op-left">
            <div class="op-type">${escapeHtml(op.operation_type || '—')}</div>
            ${comment ? `<div class="op-comment">${comment}</div>` : ''}
          </div>
          <div class="op-amount ${sign}">${formatRub(op.amount_kopecks)} ${op.currency || ''}</div>
        </div>
      </div>
    `;
  }).join('');

  listEl.insertAdjacentHTML('beforeend', html);
  opState.renderedCount += chunk.length;

  const moreBtn = document.getElementById('opLoadMore');
  if (moreBtn) {
    moreBtn.style.display = opState.renderedCount < opState.filteredRows.length ? 'block' : 'none';
    moreBtn.textContent = `Показать ещё ${Math.min(100, opState.filteredRows.length - opState.renderedCount)}`;
  }
}

// Экранирование HTML
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// ===== Этап 4.2: Экран «Сделки» ============================
// ============================================================

const trState = {
  loaded: false,
  activeTab: 'all',  // all | securities | futures | currency
  filters: {
    from: '',
    to: '',
    type: '',
    market: '',
    account: '',
    search: '',
    order: 'desc'
  },
  allRows: [],
  filteredRows: [],
  renderedCount: 0
};

// Загрузка и инициализация экрана
async function initTradesScreen() {
  if (!window.db || !window.db.ready) return;

  try {
    // 1. Сделки с ЦБ
    const secRows = await window.db.select(
        `SELECT t.id, t.trade_number, t.trade_date, t.trade_type,
              t.quantity, t.price, COALESCE(t.currency, t.currency_settle) AS currency,
              t.amount_kopecks,
              t.nkd_kopecks, t.commission_calc_kopecks, t.commission_exec_kopecks,
              t.counterparty, t.place, t.market, t.account_id,
              COALESCE(t.security_name, s.name) AS security_name,
              COALESCE(t.security_isin, s.isin) AS security_isin,
              a.code AS account_code, a.display_name AS account_name
       FROM trades t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN securities s ON s.isin = t.security_isin
       WHERE 1=1
       ORDER BY t.trade_date DESC, t.id DESC`
    );

    // 2. Сделки по производным
    const futRows = await window.db.select(
      `SELECT id, trade_date, trade_type, quantity, price,
              commission_calc_kopecks, commission_exec_kopecks,
              counterparty, place, comment, market, account_id,
              contract_code
       FROM futures_trades
       WHERE 1=1
       ORDER BY trade_date DESC, id DESC`
    );
    for (const r of futRows) {
      r.trade_number = null;
    }

    // 3. Валютные сделки
    const currRows = await window.db.select(
      `SELECT id, trade_number, trade_date, trade_type, quantity, price,
              currency, amount_kopecks, commission_calc_kopecks,
              commission_exec_kopecks, execution_date, counterparty, place, comment,
              market, account_id, instrument
       FROM currency_trades
       WHERE 1=1
       ORDER BY trade_date DESC, id DESC`
    );

    // Приводим к общему виду
    const unified = [];

    for (const r of secRows) {
      unified.push({
        kind: 'securities',
        id: r.id,
        trade_date: r.trade_date,
        trade_type: r.trade_type,
        market: r.market,
        title: r.security_name || r.security_isin || '—',
        subtitle: r.security_isin || '',
        quantity: r.quantity,
        price: r.price,
        currency: r.currency,
        amount_kopecks: r.amount_kopecks,
        trade_number: r.trade_number,
        counterparty: r.counterparty,
        account_id: r.account_id,
        account_name: r.account_name || r.account_code
      });
    }

    for (const r of futRows) {
      unified.push({
        kind: 'futures',
        id: r.id,
        trade_date: r.trade_date,
        trade_type: r.trade_type,
        market: r.market || 'Срочный рынок',
        title: r.contract_code,
        subtitle: '',
        quantity: r.quantity,
        price: r.price,
        currency: 'пункты',
        amount_kopecks: null,
        trade_number: null,
        counterparty: r.counterparty,
        account_id: r.account_id,
        account_name: null
      });
    }

    for (const r of currRows) {
      unified.push({
        kind: 'currency',
        id: r.id,
        trade_date: r.trade_date,
        trade_type: r.trade_type,
        market: r.market || 'Валютный рынок',
        title: r.instrument,
        subtitle: '',
        quantity: r.quantity,
        price: r.price,
        currency: r.currency,
        amount_kopecks: r.amount_kopecks,
        trade_number: r.trade_number,
        counterparty: r.counterparty,
        account_id: r.account_id,
        account_name: null
      });
    }

    trState.allRows = unified;

    // Заполняем фильтры
    const types = [...new Set(unified.map(r => r.trade_type).filter(Boolean))].sort();
    const typeSelect = document.getElementById('trFilterType');
    if (typeSelect) {
      typeSelect.innerHTML = '<option value="">Все</option>' +
        types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }

    const markets = [...new Set(unified.map(r => r.market).filter(Boolean))].sort();
    const marketSelect = document.getElementById('trFilterMarket');
    if (marketSelect) {
      marketSelect.innerHTML = '<option value="">Все</option>' +
        markets.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    }

    const accounts = await window.db.select('SELECT id, code, display_name, name FROM accounts ORDER BY id');
    const accSelect = document.getElementById('trFilterAccount');
    if (accSelect) {
      accSelect.innerHTML = '<option value="">Все</option>' +
        accounts.map(a => {
          const label = a.display_name || a.name || a.code;
          return `<option value="${a.id}">${escapeHtml(label)}</option>`;
        }).join('');
    }

    trState.loaded = true;
    applyTradesFilters();

  } catch (err) {
    console.error('[trades] Ошибка инициализации:', err);
    const el = document.getElementById('trList');
    if (el) el.innerHTML = `<div class="import-error">Ошибка: ${escapeHtml(err.message)}</div>`;
  }
}

// Применение фильтров
function applyTradesFilters() {
  const f = trState.filters;
  const tab = trState.activeTab;
  let rows = trState.allRows.slice();

  // Фильтр по вкладке
  if (tab !== 'all') {
    rows = rows.filter(r => r.kind === tab);
  }

  if (f.from) rows = rows.filter(r => r.trade_date >= f.from);
  if (f.to) rows = rows.filter(r => r.trade_date <= f.to);
  if (f.type) rows = rows.filter(r => r.trade_type === f.type);
  if (f.market) rows = rows.filter(r => r.market === f.market);
  if (f.account) rows = rows.filter(r => String(r.account_id) === f.account);
  if (f.search) {
    const q = f.search.toLowerCase();
    rows = rows.filter(r =>
      (r.title || '').toLowerCase().includes(q) ||
      (r.subtitle || '').toLowerCase().includes(q) ||
      (r.counterparty || '').toLowerCase().includes(q) ||
      (r.trade_number || '').toLowerCase().includes(q)
    );
  }

  // Сортировка
  rows.sort((a, b) => {
    const cmp = (a.trade_date || '').localeCompare(b.trade_date || '');
    if (cmp !== 0) return f.order === 'asc' ? cmp : -cmp;
    return f.order === 'asc' ? a.id - b.id : b.id - a.id;
  });

  trState.filteredRows = rows;
  trState.renderedCount = 0;

  // Статистика
  let buy = 0, sell = 0;
  for (const r of rows) {
    const type = (r.trade_type || '').toLowerCase();
    if (type.includes('покуп')) buy++;
    else if (type.includes('продаж')) sell++;
  }
  document.getElementById('trCount').textContent = rows.length;
  document.getElementById('trBuy').textContent = buy;
  document.getElementById('trSell').textContent = sell;

  // Счётчик активных фильтров
  const activeFilters = ['from','to','type','market','account','search']
    .filter(k => f[k] !== '');
  const countEl = document.getElementById('trFilterCount');
  if (countEl) {
    countEl.textContent = activeFilters.length > 0 ? `· ${activeFilters.length}` : '';
  }
  
  renderTradesChunk();
}

// Рендеринг порции
function renderTradesChunk() {
  const listEl = document.getElementById('trList');
  if (!listEl) return;

  const chunk = trState.filteredRows.slice(trState.renderedCount, trState.renderedCount + 100);

  if (trState.renderedCount === 0) {
    if (trState.filteredRows.length === 0) {
      listEl.innerHTML = '<div class="placeholder">Сделок по фильтру не найдено</div>';
      document.getElementById('trLoadMore').style.display = 'none';
      return;
    }
    listEl.innerHTML = '';
  }

  const html = chunk.map(t => {
    // Иконка/метка типа
    const kindLabel = {
      securities: 'ЦБ',
      futures: 'Производная',
      currency: 'Валютная'
    }[t.kind];

    const marketLabel = t.market ? `<span class="op-market">${escapeHtml(t.market)}</span>` : '';
    const accountLabel = t.account_name ? `<span class="op-account">${escapeHtml(t.account_name)}</span>` : '';
    const typeColor = (t.trade_type || '').toLowerCase().includes('покуп')
      ? 'positive'
      : ((t.trade_type || '').toLowerCase().includes('продаж') ? 'negative' : '');

    const qtyPrice = [
      t.quantity != null ? `${formatNum(t.quantity, t.kind === 'currency' ? 2 : 0)} шт` : null,
      t.price != null ? `× ${formatNum(t.price, 4)} ${t.currency || ''}` : null
    ].filter(Boolean).join(' ');

    let amountHtml = '';
    if (t.amount_kopecks != null) {
      amountHtml = `<div class="op-amount">${formatRub(t.amount_kopecks)}</div>`;
    }

    return `
      <div class="op-row">
        <div class="op-header">
          <span class="op-date">${t.trade_date}</span>
          ${marketLabel}
          ${accountLabel}
        </div>
        <div class="op-body">
          <div class="op-left">
            <div class="op-type">
              <span class="trade-kind-badge">${kindLabel}</span>
              ${escapeHtml(t.trade_type || '—')} · ${escapeHtml(t.title)}
            </div>
            <div class="op-comment">${qtyPrice}${t.trade_number ? ` · № ${escapeHtml(t.trade_number)}` : ''}${t.counterparty ? ` · ${escapeHtml(t.counterparty)}` : ''}</div>
          </div>
          ${amountHtml}
        </div>
      </div>
    `;
  }).join('');

  listEl.insertAdjacentHTML('beforeend', html);
  trState.renderedCount += chunk.length;

  const moreBtn = document.getElementById('trLoadMore');
  if (moreBtn) {
    moreBtn.style.display = trState.renderedCount < trState.filteredRows.length ? 'block' : 'none';
    moreBtn.textContent = `Показать ещё ${Math.min(100, trState.filteredRows.length - trState.renderedCount)}`;
  }
}

// ============================================================
// ===== Этап 4.3: Экран «Портфели» ==========================
// ============================================================

const pfState = {
  loaded: false,
  mode: 'combined',
  filters: {
    from: '',
    to: '',
    account: '',
    order: 'alpha'
  },
  securities: [],
  positions: [],     // ВСЕ позиции, без фильтров
  accounts: [],
  cashByCurrency: {},
  latestReportDate: null
};

async function initPortfoliosScreen() {
  if (!window.db || !window.db.ready) return;

  try {
    pfState.securities = await window.db.select(
      'SELECT * FROM securities ORDER BY name'
    );

    pfState.accounts = await window.db.select(
      'SELECT id, code, display_name, name, broker FROM accounts ORDER BY id'
    );

    // Все позиции — не только последние, чтобы фильтр по периоду работал
    const allPositions = await window.db.select(
      'SELECT * FROM positions ORDER BY snapshot_date DESC, id DESC'
    );
    pfState.positions = allPositions;

    // Метаданные для отображения денег
    const latestReports = await window.db.select(
      `SELECT rs.*
       FROM report_snapshots rs
       INNER JOIN (
         SELECT account_id, MAX(snapshot_date) AS max_date
         FROM report_snapshots
         GROUP BY account_id
       ) latest ON latest.account_id = rs.account_id AND latest.max_date = rs.snapshot_date`
    );

    const cash = { RUB: 0, CNY: 0, USD: 0 };
    let latestDate = null;
    for (const r of latestReports) {
      if (r.cash_rub_kopecks != null) cash.RUB += r.cash_rub_kopecks;
      if (r.cash_cny_kopecks != null) cash.CNY += r.cash_cny_kopecks;
      if (r.cash_usd_kopecks != null) cash.USD += r.cash_usd_kopecks;
      if (!latestDate || r.snapshot_date > latestDate) latestDate = r.snapshot_date;
    }
    pfState.cashByCurrency = cash;
    pfState.latestReportDate = latestDate;

    const accSelect = document.getElementById('pfFilterAccount');
    if (accSelect) {
      accSelect.innerHTML = '<option value="">Все</option>' +
        pfState.accounts.map(a => {
          const label = a.display_name || a.name || a.code;
          return `<option value="${a.id}">${escapeHtml(label)}</option>`;
        }).join('');
    }

    pfState.loaded = true;
    applyPortfolioFilters();

  } catch (err) {
    console.error('[portfolios] Ошибка:', err);
    const el = document.getElementById('pfContent');
    if (el) el.innerHTML = `<div class="import-error">Ошибка: ${escapeHtml(err.message)}</div>`;
  }
}

function applyPortfolioFilters() {
  const f = pfState.filters;

  // Счётчик активных фильтров
  const activeCount = ['from', 'to', 'account'].filter(k => f[k] !== '').length;
  const countEl = document.getElementById('pfFilterCount');
  if (countEl) countEl.textContent = activeCount > 0 ? `· ${activeCount}` : '';

  // Фильтруем позиции
  let positions = pfState.positions.slice();
  if (f.from) positions = positions.filter(p => p.snapshot_date >= f.from);
  if (f.to) positions = positions.filter(p => p.snapshot_date <= f.to);
  if (f.account) positions = positions.filter(p => String(p.account_id) === f.account);

  // Если есть фильтр по периоду — берём последнюю дату в диапазоне
  // Если нет — берём последнюю дату по каждому счёту
  let filteredByLatest = [];
  if (f.from || f.to) {
    // Определяем максимальную дату в отфильтрованном наборе
    let maxDate = null;
    for (const p of positions) {
      if (!maxDate || p.snapshot_date > maxDate) maxDate = p.snapshot_date;
    }
    if (maxDate) {
      filteredByLatest = positions.filter(p => p.snapshot_date === maxDate);
    }
  } else {
    // Иначе — последняя дата по каждому счёту
    const latestByAccount = {};
    for (const p of positions) {
      const key = p.account_id;
      if (!latestByAccount[key] || p.snapshot_date > latestByAccount[key]) {
        latestByAccount[key] = p.snapshot_date;
      }
    }
    filteredByLatest = positions.filter(p => p.snapshot_date === latestByAccount[p.account_id]);
  }

  // Группируем по типу, потом по валюте
  const byType = {
    'АКЦИЯ': {},
    'ОБЛИГАЦИЯ': {},
    'ЕВРООБЛИГАЦИЯ': {},
    'ПАЙ': {}
  };

  for (const p of filteredByLatest) {
    const type = p.security_type || '—';
    if (!byType[type]) continue;
    const curr = p.currency || '—';
    if (!byType[type][curr]) byType[type][curr] = [];
    byType[type][curr].push(p);
  }

  // Сортируем внутри каждой валютной подгруппы
  for (const type of Object.keys(byType)) {
    for (const curr of Object.keys(byType[type])) {
      byType[type][curr].sort((a, b) => {
        if (f.order === 'alpha') return (a.security_name || '').localeCompare(b.security_name || '');
        const av = a.value_rub_kopecks || 0;
        const bv = b.value_rub_kopecks || 0;
        if (f.order === 'value_desc') return bv - av;
        if (f.order === 'value_asc') return av - bv;
        return 0;
      });
    }
  }

  // Считаем итоги
  let secValue = 0;
  for (const type of Object.keys(byType)) {
    for (const curr of Object.keys(byType[type])) {
      for (const p of byType[type][curr]) {
        if (p.value_rub_kopecks != null) secValue += p.value_rub_kopecks;
      }
    }
  }

  const cashRub = pfState.cashByCurrency.RUB || 0;
  const cashCny = pfState.cashByCurrency.CNY || 0;
  const cashUsd = pfState.cashByCurrency.USD || 0;
  const cashTotal = cashRub + cashCny + cashUsd;
  const total = secValue + cashTotal;

  document.getElementById('pfSecValue').textContent = formatRub(secValue);
  document.getElementById('pfCashValue').textContent = formatRub(cashTotal);
  document.getElementById('pfTotalValue').textContent = formatRub(total);

  renderPortfoliosContent(byType, f);
}

function renderPortfoliosContent(byType, filters) {
  const el = document.getElementById('pfContent');
  if (!el) return;

  const cash = pfState.cashByCurrency;
  const cashItems = [];
  if (cash.RUB > 0) cashItems.push(`<div class="list-item"><span>RUB</span><span>${formatRub(cash.RUB)}</span></div>`);
  if (cash.CNY > 0) cashItems.push(`<div class="list-item"><span>CNY</span><span>${formatNum(cash.CNY / 100, 2)} CNY</span></div>`);
  if (cash.USD > 0) cashItems.push(`<div class="list-item"><span>USD</span><span>${formatNum(cash.USD / 100, 2)} USD</span></div>`);

  let html = '';

  // Блок «Деньги»
  if (cashItems.length > 0) {
    html += `<details class="pf-group" open>
      <summary class="pf-group-header">
        <span class="pf-group-title">Деньги${pfState.latestReportDate ? ' <span class="pf-date">на ' + pfState.latestReportDate + '</span>' : ''}</span>
        <span class="pf-group-summary">${formatRub(cash.RUB + cash.CNY + cash.USD)}</span>
      </summary>
      <div class="list">${cashItems.join('')}</div>
    </details>`;
  }

  const typeLabels = {
    'АКЦИЯ': 'Акции',
    'ОБЛИГАЦИЯ': 'Облигации',
    'ЕВРООБЛИГАЦИЯ': 'Еврооблигации',
    'ПАЙ': 'Паи'
  };

  let hasPositions = false;
  for (const type of ['АКЦИЯ', 'ОБЛИГАЦИЯ', 'ЕВРООБЛИГАЦИЯ', 'ПАЙ']) {
    const groupsByCurrency = byType[type];
    const currencies = Object.keys(groupsByCurrency);
    if (!currencies.length) continue;
    hasPositions = true;

    // Суммы по валютам и общая
    const totalsByCurrency = {};
    let totalKopecks = 0;
    let totalCount = 0;
    for (const curr of currencies) {
      let sum = 0;
      for (const p of groupsByCurrency[curr]) {
        if (p.value_rub_kopecks != null) sum += p.value_rub_kopecks;
      }
      totalsByCurrency[curr] = sum;
      totalKopecks += sum;
      totalCount += groupsByCurrency[curr].length;
    }

    // Сводка в заголовке: построчно — RUB, USD, CNY и т.д.
    const summaryLines = [];
    if (totalsByCurrency['RUB']) {
      summaryLines.push(`RUR ${formatRub(totalsByCurrency['RUB'])}`);
    }
    for (const curr of currencies) {
      if (curr === 'RUB' || curr === '—') continue;
      if (totalsByCurrency[curr]) {
        summaryLines.push(`${curr} ${formatNum(totalsByCurrency[curr] / 100, 2)}`);
      }
    }
    if (summaryLines.length === 0) summaryLines.push(formatRub(totalKopecks));

    const summaryHtml = summaryLines.map(l => `<div>${l}</div>`).join('');

    html += `<details class="pf-group">
      <summary class="pf-group-header">
        <span class="pf-group-title">
          ${typeLabels[type]}<br><span class="pf-count">${totalCount}</span>
        </span>
        <span class="pf-group-summary pf-group-summary-col">${summaryHtml}</span>
      </summary>
      <div class="pf-group-body">`;

    // Если только одна валюта — плоский список
    const visibleCurrencies = currencies.filter(c => c !== '—');
    if (visibleCurrencies.length <= 1 && !currencies.includes('—')) {
      html += `<div class="list">${groupsByCurrency[visibleCurrencies[0]].map(p => renderPfRow(p)).join('')}</div>`;
    } else {
      // Иначе — по валютам
      for (const curr of currencies) {
        const items = groupsByCurrency[curr];
        const sum = totalsByCurrency[curr];
        const sumLabel = curr === 'RUB'
          ? formatRub(sum)
          : `${curr} ${formatNum(sum / 100, 2)}`;
        html += `<details class="pf-subgroup">
          <summary class="pf-subgroup-header">
            <span>${curr === '—' ? 'Без валюты' : curr}</span>
            <span class="pf-subgroup-summary">${sumLabel}</span>
          </summary>
          <div class="list">${items.map(p => renderPfRow(p)).join('')}</div>
        </details>`;
      }
    }

    html += `</div></details>`;
  }

  if (!hasPositions && cashItems.length === 0) {
    html = '<div class="placeholder">Нет данных. Загрузите отчёт во вкладке «Импорт».</div>';
  }

  el.innerHTML = html;
}

// Рендер одной строки позиции — табличный вид
function renderPfRow(p) {
  const qty = p.quantity != null ? formatNum(p.quantity, 0) : '—';
  const price = p.price != null ? formatNum(p.price, 4) : '—';
  const sum = p.value_rub_kopecks != null ? formatRub(p.value_rub_kopecks) : '—';

  // Вторая строка под названием:
  // - Для облигаций/еврооблигаций — купон
  // - Для остальных — ISIN
  let subtitle = '';
  const isBond = (p.security_type === 'ОБЛИГАЦИЯ' || p.security_type === 'ЕВРООБЛИГАЦИЯ');
  if (isBond) {
    if (p.coupon_rate != null && p.coupon_rate > 0) {
      subtitle = `купон ${formatNum(p.coupon_rate, 2)}%`;
    } else {
      subtitle = `купон — %`;
    }
  } else {
    subtitle = escapeHtml(p.security_isin || '');
  }

  return `
    <div class="list-item pf-row">
      <div class="pf-cell-name">
        <div class="pf-item-name">${escapeHtml(p.security_name || p.security_isin)}</div>
        <div class="pf-item-meta">${subtitle}</div>
      </div>
      <div class="pf-cell-num">
        <div class="pf-col-label">Кол-во</div>
        <div class="pf-col-value">${qty}</div>
      </div>
      <div class="pf-cell-num">
        <div class="pf-col-label">Цена</div>
        <div class="pf-col-value">${price}</div>
      </div>
      <div class="pf-cell-num pf-cell-sum">
        <div class="pf-col-label">Сумма</div>
        <div class="pf-col-value">${sum}</div>
      </div>
    </div>
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
      const parsedMeta = parseReportMetadata(workbook);
      const parsedSummary = parseAccountSummary(workbook);
      const parsedBalances = parseCashBalances(workbook);
      const parsedSec = parseSecurities(workbook);
      const parsedMv = parseSecuritiesMovement(workbook);
      const parsedTrades = parseTrades(workbook);
      const parsedFutures = parseFuturesTrades(workbook);
      const parsedFuturesPositions = parseFuturesPositions(workbook);
      const parsedCurrencyTrades = parseCurrencyTrades(workbook);
      const parsedCash = parseCashOperations(workbook);

      console.log('[parser] Метаданные:', parsedMeta);
      console.log('[parser] Сводка по субсчёту:', parsedSummary.items.length);
      console.log('[parser] Остатки денег:', parsedBalances.rows.length);
      console.log('[parser] ЦБ:', parsedSec.positions.length);
      console.log('[parser] Движение ЦБ:', parsedMv.movements.length);
      console.log('[parser] Сделки:', parsedTrades.trades.length, '(дубл.:', parsedTrades.duplicates, ')');
      console.log('[parser] Фьючерсы (сделки):', parsedFutures.trades.length);
      console.log('[parser] Фьючерсы (позиции):', parsedFuturesPositions.positions.length);
	  console.log('[parser] Валютные сделки:', parsedCurrencyTrades.trades.length);
      console.log('[parser] Операции:', parsedCash.operations.length);

      const parsed = {
        meta: parsedMeta,
        summary: parsedSummary,
        balances: parsedBalances,
        securities: parsedSec,
        movements: parsedMv,
        trades: parsedTrades,
        futures: parsedFutures,
        futuresPositions: parsedFuturesPositions,
        currencyTrades: parsedCurrencyTrades,
        cash: parsedCash
      };
      const previewHtml = buildCashPreview(
        file.name, workbook,
        parsedCash, parsedSec, parsedTrades, parsedMv, parsedFutures,
        parsedMeta, parsedSummary, parsedBalances, parsedFuturesPositions,
        parsedCurrencyTrades
      );
      setPreviewWithActions(previewHtml, parsed, file.name);
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
  
  // Кнопки управления базой
  const exportBtn = document.getElementById('exportDbBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportDatabase);

  const wipeBtn = document.getElementById('wipeDbBtn');
  if (wipeBtn) wipeBtn.addEventListener('click', wipeAllData);

  // ===== Обработчики фильтров экрана «Операции» =====
  const opFilters = [
    { id: 'opFilterFrom', key: 'from' },
    { id: 'opFilterTo', key: 'to' },
    { id: 'opFilterType', key: 'type' },
    { id: 'opFilterMarket', key: 'market' },
    { id: 'opFilterCurrency', key: 'currency' },
    { id: 'opFilterAccount', key: 'account' },
    { id: 'opFilterSearch', key: 'search' },
    { id: 'opSortOrder', key: 'order' }
  ];

  opFilters.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    el.addEventListener('input', () => {
      opState.filters[f.key] = el.value;
      applyOperationsFilters();
    });
    el.addEventListener('change', () => {
      opState.filters[f.key] = el.value;
      applyOperationsFilters();
    });
  });

  const clearBtn = document.getElementById('opClearFilters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      Object.keys(opState.filters).forEach(k => {
        opState.filters[k] = k === 'order' ? 'desc' : '';
      });
      opFilters.forEach(f => {
        const el = document.getElementById(f.id);
        if (el) el.value = f.key === 'order' ? 'desc' : '';
      });
      applyOperationsFilters();
    });
  }

  const loadMoreBtn = document.getElementById('opLoadMore');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', renderOperationsChunk);

  // ===== Обработчики экрана «Сделки» =====
  const trFilters = [
    { id: 'trFilterFrom', key: 'from' },
    { id: 'trFilterTo', key: 'to' },
    { id: 'trFilterType', key: 'type' },
    { id: 'trFilterMarket', key: 'market' },
    { id: 'trFilterAccount', key: 'account' },
    { id: 'trFilterSearch', key: 'search' },
    { id: 'trSortOrder', key: 'order' }
  ];

  trFilters.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    el.addEventListener('input', () => {
      trState.filters[f.key] = el.value;
      applyTradesFilters();
    });
    el.addEventListener('change', () => {
      trState.filters[f.key] = el.value;
      applyTradesFilters();
    });
  });

  // Переключатель вкладок
  document.querySelectorAll('[data-trade-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-trade-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      trState.activeTab = btn.dataset.tradeTab;
      applyTradesFilters();
    });
  });

  const trClearBtn = document.getElementById('trClearFilters');
  if (trClearBtn) {
    trClearBtn.addEventListener('click', () => {
      Object.keys(trState.filters).forEach(k => {
        trState.filters[k] = k === 'order' ? 'desc' : '';
      });
      trFilters.forEach(f => {
        const el = document.getElementById(f.id);
        if (el) el.value = f.key === 'order' ? 'desc' : '';
      });
      applyTradesFilters();
    });
  }

  const trLoadMoreBtn = document.getElementById('trLoadMore');
  if (trLoadMoreBtn) trLoadMoreBtn.addEventListener('click', renderTradesChunk);

  // ===== Обработчики экрана «Портфели» =====
  const pfModeCombined = document.getElementById('pfModeCombined');
  const pfModeByAccount = document.getElementById('pfModeByAccount');
  if (pfModeCombined && pfModeByAccount) {
    pfModeCombined.addEventListener('click', () => {
      pfModeCombined.classList.add('active');
      pfModeByAccount.classList.remove('active');
      pfState.mode = 'combined';
      applyPortfolioFilters();
    });
    pfModeByAccount.addEventListener('click', () => {
      pfModeByAccount.classList.add('active');
      pfModeCombined.classList.remove('active');
      pfState.mode = 'by-account';
      applyPortfolioFilters();
    });
  }

  const pfFilterFrom = document.getElementById('pfFilterFrom');
  if (pfFilterFrom) {
    pfFilterFrom.addEventListener('change', () => {
      pfState.filters.from = pfFilterFrom.value;
      applyPortfolioFilters();
    });
  }

  const pfFilterTo = document.getElementById('pfFilterTo');
  if (pfFilterTo) {
    pfFilterTo.addEventListener('change', () => {
      pfState.filters.to = pfFilterTo.value;
      applyPortfolioFilters();
    });
  }

  const pfFilterAccount = document.getElementById('pfFilterAccount');
  if (pfFilterAccount) {
    pfFilterAccount.addEventListener('change', () => {
      pfState.filters.account = pfFilterAccount.value;
      applyPortfolioFilters();
    });
  }
  
  const pfSortOrder = document.getElementById('pfSortOrder');
  if (pfSortOrder) {
    pfSortOrder.addEventListener('change', () => {
      pfState.filters.order = pfSortOrder.value;
      applyPortfolioFilters();
    });
  }

  const pfClearBtn = document.getElementById('pfClearFilters');
  if (pfClearBtn) {
    pfClearBtn.addEventListener('click', () => {
      pfState.filters = { from: '', to: '', account: '', order: 'alpha' };
      if (pfFilterFrom) pfFilterFrom.value = '';
      if (pfFilterTo) pfFilterTo.value = '';
      if (pfFilterAccount) pfFilterAccount.value = '';
      if (pfSortOrder) pfSortOrder.value = 'alpha';
      applyPortfolioFilters();
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