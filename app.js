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
        market,
        row: r + 1
      };
      trades.push(trade);

      const mKey = market || 'Без рынка';
      marketBreakdown[mKey] = (marketBreakdown[mKey] || 0) + 1;
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
      row: r + 1
    };
    trade.external_hash = [contractCode, isoDate, tradeType, qty, price].join('|');
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

function buildCashPreview(fileName, workbook, parsedCash, parsedSec, parsedTrades, parsedMv, parsedFutures, parsedMeta, parsedSummary, parsedBalances, parsedFuturesPositions) {
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
    ${cashHtml}
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
      const parsedMeta = parseReportMetadata(workbook);
      const parsedSummary = parseAccountSummary(workbook);
      const parsedBalances = parseCashBalances(workbook);
      const parsedSec = parseSecurities(workbook);
      const parsedMv = parseSecuritiesMovement(workbook);
      const parsedTrades = parseTrades(workbook);
      const parsedFutures = parseFuturesTrades(workbook);
      const parsedFuturesPositions = parseFuturesPositions(workbook);
      const parsedCash = parseCashOperations(workbook);

      console.log('[parser] Метаданные:', parsedMeta);
      console.log('[parser] Сводка по субсчёту:', parsedSummary.items.length);
      console.log('[parser] Остатки денег:', parsedBalances.rows.length);
      console.log('[parser] ЦБ:', parsedSec.positions.length);
      console.log('[parser] Движение ЦБ:', parsedMv.movements.length);
      console.log('[parser] Сделки:', parsedTrades.trades.length, '(дубл.:', parsedTrades.duplicates, ')');
      console.log('[parser] Фьючерсы (сделки):', parsedFutures.trades.length);
      console.log('[parser] Фьючерсы (позиции):', parsedFuturesPositions.positions.length);
      console.log('[parser] Операции:', parsedCash.operations.length);

      setPreview(buildCashPreview(
        file.name, workbook,
        parsedCash, parsedSec, parsedTrades, parsedMv, parsedFutures,
        parsedMeta, parsedSummary, parsedBalances, parsedFuturesPositions
      ));
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