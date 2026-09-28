// db.js
// Обёртка над воркером: даёт Promise-based API

class DbClient {
  constructor() {
    this.worker = new Worker('db-worker.js', { type: 'module' });
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;

    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {};
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };

    this.worker.onerror = (e) => {
      console.error('[db-worker]', e.message || e);
    };
  }

  _send(type, payload) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  async init() {
    const msg = await this._send('init');
    this.ready = true;
    return msg;
  }

  exec(sql) {
    return this._send('exec', { sql });
  }

  select(sql, params = []) {
    return this._send('select', { sql, params });
  }

  run(sql, params = []) {
    return this._send('run', { sql, params });
  }
}

window.db = new DbClient();