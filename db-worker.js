// db-worker.js
// Web Worker: SQLite WASM + OPFS-SAH-Pool VFS

import sqlite3InitModule from './lib/sqlite3.mjs';

let db = null;
let poolUtil = null;

const DB_FILE = '/investments.db';
const POOL_NAME = 'investments-pool';

// Добавляет колонку, если её ещё нет
function ensureColumn(tableName, columnName, columnType) {
  const cols = db.selectObjects(`PRAGMA table_info(${tableName})`);
  const exists = cols.some(c => c.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    console.log(`[migration] Добавлена колонка ${tableName}.${columnName}`);
  }
}

async function initDb() {
  if (db) return 'База уже открыта';

  const sqlite3 = await sqlite3InitModule({
    print: (...args) => console.log('[sqlite]', ...args),
    printErr: (...args) => console.error('[sqlite]', ...args),
  });

  poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: POOL_NAME,
    initialCapacity: 6,
  });

  db = new poolUtil.OpfsSAHPoolDb(DB_FILE);

  // ===== Базовые таблицы =====

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      display_name TEXT,
      broker TEXT,
      currency TEXT NOT NULL DEFAULT 'RUB',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS securities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isin TEXT NOT NULL UNIQUE,
      reg_number TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT,
      nominal REAL,
      coupon_rate REAL,
      maturity_date TEXT,
      issuer TEXT,
      last_seen_date TEXT
    );
	
	CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      security_isin TEXT NOT NULL,
      security_name TEXT,
      security_type TEXT,
      quantity REAL NOT NULL,
      price REAL,
      currency TEXT,
      nominal REAL,
      nkd REAL,
      coupon_rate REAL,
      payment_date TEXT,
      value_rub_kopecks INTEGER,
      planned_value_rub_kopecks INTEGER,
      external_hash TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_number TEXT UNIQUE,
      account_id INTEGER NOT NULL,
      security_id INTEGER,
      security_isin TEXT,
      security_name TEXT,
      trade_date TEXT NOT NULL,
      trade_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      amount_kopecks INTEGER NOT NULL,
      nkd_kopecks INTEGER,
      commission_calc_kopecks INTEGER,
      commission_exec_kopecks INTEGER,
      counterparty TEXT,
      place TEXT,
      market TEXT
    );

    CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      security_id INTEGER,
      security_isin TEXT,
      purchase_date TEXT NOT NULL,
      initial_quantity REAL NOT NULL,
      remaining_quantity REAL NOT NULL,
      price_per_unit REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lot_consumption (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL,
      sell_trade_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      sell_price REAL NOT NULL,
      pnl_kopecks INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cash_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      operation_date TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      amount_kopecks INTEGER NOT NULL,
      currency TEXT NOT NULL,
      comment TEXT,
      market TEXT,
      external_hash TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      security_id INTEGER,
      security_isin TEXT,
      account_id INTEGER NOT NULL,
      payment_type TEXT NOT NULL,
      fixation_date TEXT,
      payment_date TEXT NOT NULL,
      amount_per_unit REAL,
      quantity REAL NOT NULL,
      amount_kopecks INTEGER,
      tax_kopecks INTEGER,
      is_fixed INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'planned'
    );

    CREATE TABLE IF NOT EXISTS taxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      rate REAL NOT NULL,
      source TEXT NOT NULL,
      taxable_income_kopecks INTEGER NOT NULL,
      assessed_kopecks INTEGER NOT NULL,
      paid_kopecks INTEGER NOT NULL,
      due_kopecks INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      total_value_kopecks INTEGER NOT NULL,
      cash_rub_kopecks INTEGER NOT NULL DEFAULT 0,
      cash_cny_kopecks INTEGER NOT NULL DEFAULT 0,
      cash_usd_kopecks INTEGER NOT NULL DEFAULT 0,
      total_with_cash_kopecks INTEGER
    );

    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      import_date TEXT NOT NULL,
      report_type TEXT,
      period_start TEXT,
      period_end TEXT,
      account_id INTEGER,
      subaccount_code TEXT,
      operations_count INTEGER DEFAULT 0,
      duplicates_count INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success'
    );

    CREATE TABLE IF NOT EXISTS import_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_log_id INTEGER NOT NULL,
      row_number INTEGER,
      error_description TEXT NOT NULL,
      row_content TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS futures_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      contract_code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      trade_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL,
      strike_price REAL,
      commission_calc_kopecks INTEGER,
      commission_exec_kopecks INTEGER,
      counterparty TEXT,
      place TEXT,
      comment TEXT,
      market TEXT,
      external_hash TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS futures_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      contract_code TEXT NOT NULL,
      incoming_qty REAL,
      added_qty REAL,
      removed_qty REAL,
      executed_qty REAL,
      outgoing_qty REAL,
      go REAL,
      margin REAL,
      expiration_date TEXT,
      external_hash TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS currency_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      trade_number TEXT UNIQUE,
      instrument TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      trade_type TEXT NOT NULL,
      quantity REAL,
      price REAL,
      currency TEXT,
      amount_kopecks INTEGER,
      commission_calc_kopecks INTEGER,
      commission_exec_kopecks INTEGER,
      execution_date TEXT,
      counterparty TEXT,
      place TEXT,
      comment TEXT,
      market TEXT
    );

    CREATE TABLE IF NOT EXISTS report_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_log_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      broker TEXT,
      period_from TEXT,
      period_to TEXT,
      client_name TEXT,
      inn TEXT,
      contract TEXT,
      subaccount_code TEXT,
      account_number TEXT,
      cny_start_rate REAL,
      cny_end_rate REAL,
      total_value_kopecks INTEGER,
      cash_rub_kopecks INTEGER,
      cash_cny_kopecks INTEGER,
      cash_usd_kopecks INTEGER,
	  UNIQUE(account_id, snapshot_date)
    );
  `);

  // ===== Миграции для существующих баз =====

  ensureColumn('accounts', 'display_name', 'TEXT');
  ensureColumn('accounts', 'broker', 'TEXT');

  ensureColumn('securities', 'last_seen_date', 'TEXT');
  ensureColumn('securities', 'is_defaulted', 'INTEGER DEFAULT 0');

  ensureColumn('trades', 'market', 'TEXT');
  ensureColumn('trades', 'currency', 'TEXT');
  ensureColumn('trades', 'currency_settle', 'TEXT');
  ensureColumn('trades', 'security_isin', 'TEXT');
  ensureColumn('trades', 'security_name', 'TEXT');
  ensureColumn('trades', 'commission_calc_kopecks', 'INTEGER');
  ensureColumn('trades', 'commission_exec_kopecks', 'INTEGER');
  ensureColumn('trades', 'place', 'TEXT');

  ensureColumn('lots', 'security_isin', 'TEXT');

  ensureColumn('cash_operations', 'market', 'TEXT');
  ensureColumn('cash_operations', 'external_hash', 'TEXT');

  ensureColumn('payments', 'security_isin', 'TEXT');

  ensureColumn('portfolio_snapshots', 'total_with_cash_kopecks', 'INTEGER');

  ensureColumn('import_log', 'account_id', 'INTEGER');
  ensureColumn('import_log', 'subaccount_code', 'TEXT');

  ensureColumn('futures_trades', 'account_id', 'INTEGER');
  ensureColumn('futures_trades', 'market', 'TEXT');

  // ===== Специальные миграции =====

  // Миграция report_snapshots: правильный уникальный ключ
  try {
    const tblSql = db.selectObjects(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='report_snapshots'"
    );
    const sql = tblSql[0] ? tblSql[0].sql : '';
    if (sql.includes('report_log_id, account_id') || sql.includes('report_log_id,account_id')) {
      console.log('[migration] Пересоздаём report_snapshots с правильным UNIQUE');
      db.exec(`
        CREATE TABLE report_snapshots_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          report_log_id INTEGER NOT NULL,
          account_id INTEGER NOT NULL,
          snapshot_date TEXT NOT NULL,
          broker TEXT,
          period_from TEXT,
          period_to TEXT,
          client_name TEXT,
          inn TEXT,
          contract TEXT,
          subaccount_code TEXT,
          account_number TEXT,
          cny_start_rate REAL,
          cny_end_rate REAL,
          total_value_kopecks INTEGER,
          cash_rub_kopecks INTEGER,
          cash_cny_kopecks INTEGER,
          cash_usd_kopecks INTEGER,
          UNIQUE(account_id, snapshot_date)
        );

        INSERT OR IGNORE INTO report_snapshots_new
          (id, report_log_id, account_id, snapshot_date, broker, period_from, period_to,
           client_name, inn, contract, subaccount_code, account_number,
           cny_start_rate, cny_end_rate, total_value_kopecks,
           cash_rub_kopecks, cash_cny_kopecks, cash_usd_kopecks)
        SELECT
          id, report_log_id, account_id, snapshot_date, broker, period_from, period_to,
          client_name, inn, contract, subaccount_code, account_number,
          cny_start_rate, cny_end_rate, total_value_kopecks,
          cash_rub_kopecks, cash_cny_kopecks, cash_usd_kopecks
        FROM report_snapshots;

        DROP TABLE report_snapshots;
        ALTER TABLE report_snapshots_new RENAME TO report_snapshots;
      `);
      console.log('[migration] report_snapshots пересоздана');
    }
  } catch (e) {
    console.error('[migration] Ошибка report_snapshots:', e);
    throw e;
  }
  
  // Миграция trades: убираем security_id NOT NULL, если он есть
  try {
    const tradesCols = db.selectObjects("PRAGMA table_info(trades)");
    const securityIdCol = tradesCols.find(c => c.name === 'security_id');
    if (securityIdCol && securityIdCol.notnull === 1) {
      console.log('[migration] Пересоздаём trades без security_id NOT NULL');
      db.exec(`
        CREATE TABLE trades_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trade_number TEXT UNIQUE,
          account_id INTEGER NOT NULL,
          security_id INTEGER,
          security_isin TEXT,
          security_name TEXT,
          trade_date TEXT NOT NULL,
          trade_type TEXT NOT NULL,
          quantity REAL NOT NULL,
          price REAL NOT NULL,
          amount_kopecks INTEGER NOT NULL,
          nkd_kopecks INTEGER,
          commission_calc_kopecks INTEGER,
          commission_exec_kopecks INTEGER,
          counterparty TEXT,
          place TEXT,
          market TEXT
        );

        INSERT INTO trades_new
          (id, trade_number, account_id, security_id, security_isin, security_name,
           trade_date, trade_type, quantity, price, amount_kopecks, nkd_kopecks,
           commission_calc_kopecks, commission_exec_kopecks, counterparty, place, market)
        SELECT
          id, trade_number, account_id, security_id, security_isin, security_name,
          trade_date, trade_type, quantity, price, amount_kopecks, nkd_kopecks,
          commission_calc_kopecks, commission_exec_kopecks, counterparty, place, market
        FROM trades;

        DROP TABLE trades;
        ALTER TABLE trades_new RENAME TO trades;
      `);
      console.log('[migration] trades пересоздана');
    }
  } catch (e) {
    console.error('[migration] Ошибка миграции trades:', e);
    throw e;
  }
  
  // ===== Счёт по умолчанию =====
  const count = db.selectValue('SELECT COUNT(*) FROM accounts');
  if (count === 0) {
    db.exec("INSERT INTO accounts (code, name, currency) VALUES ('MAIN', 'Основной счёт', 'RUB')");
  }

  return 'База готова';
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  try {
    if (type === 'init') {
      const msg = await initDb();
      self.postMessage({ id, ok: true, result: msg });
      return;
    }

    if (!db) throw new Error('База не инициализирована');

    if (type === 'exec') {
      db.exec(payload.sql);
      self.postMessage({ id, ok: true, result: { ok: true } });
      return;
    }

    if (type === 'select') {
      const rows = db.selectObjects(payload.sql, payload.params || []);
      self.postMessage({ id, ok: true, result: rows });
      return;
    }

    if (type === 'run') {
      db.exec({ sql: payload.sql, bind: payload.params || [] });
      const lastId = db.selectValue('SELECT last_insert_rowid()');
      self.postMessage({ id, ok: true, result: { lastId } });
      return;
    }

    if (type === 'batch') {
      // Массовая вставка в одной транзакции
      // payload.operations = [{ sql, params }]
      const results = [];
      db.exec('BEGIN');
      try {
        for (const op of payload.operations) {
          db.exec({ sql: op.sql, bind: op.params || [] });
          results.push({ ok: true });
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      self.postMessage({ id, ok: true, result: { count: results.length } });
      return;
    }

    if (type === 'transaction') {
      // Пакет SQL-запросов в одной транзакции
      // payload.queries = [{ type: 'run'|'exec', sql, params }]
      const results = [];
      db.exec('BEGIN');
      try {
        for (const q of payload.queries) {
          if (q.type === 'exec') {
            db.exec(q.sql);
            results.push({ ok: true });
          } else {
            db.exec({ sql: q.sql, bind: q.params || [] });
            const lastId = db.selectValue('SELECT last_insert_rowid()');
            results.push({ lastId });
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      self.postMessage({ id, ok: true, result: { results } });
      return;
    }

    throw new Error('Неизвестный тип сообщения: ' + type);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};