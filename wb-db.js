const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) throw new Error('DB pool not initialised — call initPool() first');
  return pool;
}

async function initPool(databaseUrl) {
  if (pool) return; // already initialised
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { require: true, rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10000,
  });

  // Create tables if they don't exist
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_boards (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug_token  UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        slug        VARCHAR(80),
        name        VARCHAR(200) NOT NULL DEFAULT 'New Board',
        department  VARCHAR(100),
        cols        INTEGER NOT NULL DEFAULT 4,
        rows        INTEGER NOT NULL DEFAULT 3,
        background  VARCHAR(20) NOT NULL DEFAULT '#0a0f1c',
        created_by  VARCHAR(200),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Add department column for installs that predate it
    await client.query(`ALTER TABLE wb_boards ADD COLUMN IF NOT EXISTS department VARCHAR(100)`);
    // Add slug column for human-readable kiosk URLs
    await client.query(`ALTER TABLE wb_boards ADD COLUMN IF NOT EXISTS slug VARCHAR(80)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS wb_boards_slug_unique ON wb_boards (LOWER(slug)) WHERE slug IS NOT NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_widgets (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id            UUID NOT NULL,
        type                VARCHAR(20) NOT NULL DEFAULT 'number',
        title               VARCHAR(200) NOT NULL DEFAULT 'Widget',
        data_source_type    VARCHAR(20) NOT NULL DEFAULT 'sql',
        data_source_config  JSONB NOT NULL DEFAULT '{}',
        display_config      JSONB NOT NULL DEFAULT '{}',
        col_start           INTEGER NOT NULL DEFAULT 1,
        col_span            INTEGER NOT NULL DEFAULT 1,
        row_start           INTEGER NOT NULL DEFAULT 1,
        row_span            INTEGER NOT NULL DEFAULT 1,
        refresh_interval    INTEGER NOT NULL DEFAULT 60,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_datasets (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(200) NOT NULL UNIQUE,
        schema      JSONB NOT NULL DEFAULT '[]',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_dataset_data (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dataset_id  UUID NOT NULL UNIQUE,
        data        JSONB NOT NULL DEFAULT '[]',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Per-board, per-day "rank when this agent first booked today".
    // Drives the persistent ▲N/▼N chip on the showcase. Rows are keyed
    // (board_slug, day, agent_key) and inserted with ON CONFLICT DO
    // NOTHING so the FIRST observation wins — same agent across two
    // TVs ends up with one shared baseline.
    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_rank_baselines (
        board_slug    VARCHAR(120) NOT NULL,
        day           DATE NOT NULL,
        agent_key     VARCHAR(200) NOT NULL,
        baseline_rank INTEGER NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (board_slug, day, agent_key)
      )
    `);

    await client.query('COMMIT');
    console.log('[wb-db] tables ready');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─── Boards ────────────────────────────────────────────────────────────────

async function getBoard(id) {
  const p = getPool();
  const { rows } = await p.query('SELECT * FROM wb_boards WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const board = rows[0];
  const { rows: widgets } = await p.query(
    'SELECT * FROM wb_widgets WHERE board_id = $1 ORDER BY row_start, col_start',
    [id]
  );
  return { ...board, widgets };
}

async function getBoardByToken(token) {
  const p = getPool();
  const { rows } = await p.query('SELECT * FROM wb_boards WHERE slug_token = $1', [token]);
  if (!rows[0]) return null;
  const board = rows[0];
  const { rows: widgets } = await p.query(
    'SELECT * FROM wb_widgets WHERE board_id = $1 ORDER BY row_start, col_start',
    [board.id]
  );
  return { ...board, widgets };
}

/** Case-insensitive slug lookup. Returns null if not found. */
async function getBoardBySlug(slug) {
  if (!slug) return null;
  const p = getPool();
  const { rows } = await p.query('SELECT * FROM wb_boards WHERE LOWER(slug) = LOWER($1)', [slug]);
  if (!rows[0]) return null;
  const board = rows[0];
  const { rows: widgets } = await p.query(
    'SELECT * FROM wb_widgets WHERE board_id = $1 ORDER BY row_start, col_start',
    [board.id]
  );
  return { ...board, widgets };
}

async function listBoards() {
  const p = getPool();
  const { rows: boards } = await p.query('SELECT * FROM wb_boards ORDER BY created_at DESC');
  const result = [];
  for (const b of boards) {
    const { rows: [{ count }] } = await p.query(
      'SELECT COUNT(*) FROM wb_widgets WHERE board_id = $1',
      [b.id]
    );
    result.push({ ...b, widget_count: parseInt(count, 10) });
  }
  return result;
}

async function createBoard(name, department) {
  const p = getPool();
  const { rows } = await p.query(
    `INSERT INTO wb_boards (name, department) VALUES ($1, $2) RETURNING *`,
    [name || 'New Board', department || null]
  );
  return { ...rows[0], widgets: [] };
}

async function updateBoard(id, fields) {
  const p = getPool();
  const allowed = ['name', 'department', 'slug', 'cols', 'rows', 'background', 'display_config'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      // display_config is a JSONB column — stringify here so the pg driver
      // doesn't try to bind a JS object as TEXT.
      vals.push(k === 'display_config' ? JSON.stringify(fields[k]) : fields[k]);
      sets.push(`${k} = $${vals.length}`);
    }
  }
  if (sets.length === 0) return getBoard(id);
  vals.push(id);
  sets.push(`updated_at = NOW()`);
  await p.query(
    `UPDATE wb_boards SET ${sets.join(', ')} WHERE id = $${vals.length}`,
    vals
  );
  return getBoard(id);
}

async function deleteBoard(id) {
  const p = getPool();
  await p.query('DELETE FROM wb_widgets WHERE board_id = $1', [id]);
  await p.query('DELETE FROM wb_boards WHERE id = $1', [id]);
}

// ─── Widgets ───────────────────────────────────────────────────────────────

async function getWidget(id) {
  const { rows } = await getPool().query('SELECT * FROM wb_widgets WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createWidget(boardId, fields) {
  const p = getPool();
  const cols = ['board_id', 'type', 'title', 'data_source_type', 'data_source_config',
    'display_config', 'col_start', 'col_span', 'row_start', 'row_span', 'refresh_interval'];
  const vals = [
    boardId,
    fields.type || 'number',
    fields.title || 'Widget',
    fields.data_source_type || 'sql',
    JSON.stringify(fields.data_source_config || {}),
    JSON.stringify(fields.display_config || {}),
    fields.col_start || 1,
    fields.col_span || 1,
    fields.row_start || 1,
    fields.row_span || 1,
    fields.refresh_interval || 60,
  ];
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await p.query(
    `INSERT INTO wb_widgets (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  return rows[0];
}

async function updateWidget(id, fields) {
  const p = getPool();
  const allowed = ['type', 'title', 'data_source_type', 'data_source_config', 'display_config',
    'col_start', 'col_span', 'row_start', 'row_span', 'refresh_interval'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      vals.push(typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k]);
      sets.push(`${k} = $${vals.length}`);
    }
  }
  if (sets.length === 0) return getWidget(id);
  vals.push(id);
  sets.push(`updated_at = NOW()`);
  await p.query(
    `UPDATE wb_widgets SET ${sets.join(', ')} WHERE id = $${vals.length}`,
    vals
  );
  const { rows } = await p.query('SELECT * FROM wb_widgets WHERE id = $1', [id]);
  return rows[0] || null;
}

async function deleteWidget(id) {
  await getPool().query('DELETE FROM wb_widgets WHERE id = $1', [id]);
}

// ─── Datasets ──────────────────────────────────────────────────────────────

async function upsertDataset(name, schema) {
  const p = getPool();
  const { rows } = await p.query(
    `INSERT INTO wb_datasets (name, schema) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET schema = $2, updated_at = NOW()
     RETURNING *`,
    [name, JSON.stringify(schema || [])]
  );
  return rows[0];
}

async function setDatasetData(datasetId, rows) {
  const p = getPool();
  const { rows: result } = await p.query(
    `INSERT INTO wb_dataset_data (dataset_id, data) VALUES ($1, $2)
     ON CONFLICT (dataset_id) DO UPDATE SET data = $2, updated_at = NOW()
     RETURNING *`,
    [datasetId, JSON.stringify(rows)]
  );
  return result[0];
}

async function getDatasetData(datasetId) {
  const { rows } = await getPool().query(
    'SELECT * FROM wb_dataset_data WHERE dataset_id = $1',
    [datasetId]
  );
  return rows[0] || null;
}

async function listDatasets() {
  const { rows } = await getPool().query('SELECT * FROM wb_datasets ORDER BY name');
  return rows;
}

async function deleteDataset(name) {
  const p = getPool();
  const { rows } = await p.query('SELECT id FROM wb_datasets WHERE name = $1', [name]);
  if (!rows[0]) return;
  await p.query('DELETE FROM wb_dataset_data WHERE dataset_id = $1', [rows[0].id]);
  await p.query('DELETE FROM wb_datasets WHERE id = $1', [rows[0].id]);
}

// ─── Rank baselines (showcase ▲N/▼N chips) ────────────────────────────

/** Insert today's first-observed ranks for any agents not yet recorded
 *  for this board today. ON CONFLICT DO NOTHING means the FIRST client
 *  to POST a given (board, day, agent) wins — every later TV sees the
 *  same baseline. Returns nothing; caller is expected to follow up with
 *  getBaselines() to read the canonical map. */
async function recordBaselines(boardSlug, day, entries) {
  if (!entries || entries.length === 0) return;
  const p = getPool();
  const values = [];
  const params = [boardSlug, day];
  entries.forEach((e, i) => {
    const a = i * 2 + 3; // $3, $5, $7… for agent_key
    const r = i * 2 + 4; // $4, $6, $8… for baseline_rank
    values.push(`($1, $2, $${a}, $${r})`);
    params.push(String(e.agent_key).slice(0, 200));
    params.push(Math.max(1, Math.min(9999, Math.floor(Number(e.rank)))));
  });
  await p.query(
    `INSERT INTO wb_rank_baselines (board_slug, day, agent_key, baseline_rank)
     VALUES ${values.join(', ')}
     ON CONFLICT (board_slug, day, agent_key) DO NOTHING`,
    params
  );
}

/** Returns { agent_key: baseline_rank } for the given board+day. */
async function getBaselines(boardSlug, day) {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT agent_key, baseline_rank
     FROM wb_rank_baselines
     WHERE board_slug = $1 AND day = $2`,
    [boardSlug, day]
  );
  const out = {};
  for (const r of rows) out[r.agent_key] = r.baseline_rank;
  return out;
}

module.exports = {
  initPool,
  getBoard, getBoardByToken, getBoardBySlug, listBoards, createBoard, updateBoard, deleteBoard,
  getWidget, createWidget, updateWidget, deleteWidget,
  upsertDataset, setDatasetData, getDatasetData, listDatasets, deleteDataset,
  recordBaselines, getBaselines,
};
