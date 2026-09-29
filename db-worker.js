// db-worker.js
// Web Worker: SQLite WASM + OPFS-SAH-Pool VFS

// Локальная библиотека (лежит в lib/sqlite3.mjs)
import sqlite3InitModule from './lib/sqlite3.mjs';

let db = null;
let poolUtil = null;

const DB_FILE = '/investments.db';
const POOL_NAME = 'investments-pool';

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
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
      issuer TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_number TEXT UNIQUE,
      account_id INTEGER NOT NULL,
      security_id INTEGER NOT NULL,
      trade_date TEXT NOT NULL,
      trade_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      amount_kopecks INTEGER NOT NULL,
      nkd_kopecks INTEGER,
      commission_kopecks INTEGER,
      counterparty TEXT
    );

    CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      security_id INTEGER NOT NULL,
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
      comment TEXT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      security_id INTEGER NOT NULL,
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
      cash_usd_kopecks INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      import_date TEXT NOT NULL,
      report_type TEXT,
      period_start TEXT,
      period_end TEXT,
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
  `);

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

    throw new Error('Неизвестный тип сообщения: ' + type);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};