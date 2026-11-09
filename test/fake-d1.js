// テスト用：Node の SQLite で Cloudflare D1 と同じ呼び方ができるようにする
export async function createFakeD1() {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return null; }
  const db = new DatabaseSync(':memory:');
  class Stmt {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { return new Stmt(this.sql, args); }
    async first() { return this._get(); }
    async all() { return { results: db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) }; }
    async run() { return this._run(); }
    _get() { const r = db.prepare(this.sql).get(...this.args); return r ? { ...r } : null; }
    _run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; }
  }
  return {
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = stmts.map((s) => s._run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    raw: db,
  };
}
