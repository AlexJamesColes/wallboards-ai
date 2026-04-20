const Sequelize = require('sequelize');

let WbBoard = null;
let WbWidget = null;
let WbDataset = null;
let WbDatasetData = null;

function defineWbModels(sql) {
  WbBoard = sql.define('WbBoard', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
    slug_token: { type: Sequelize.UUID, allowNull: false, unique: true, defaultValue: Sequelize.UUIDV4 },
    name: { type: Sequelize.STRING(200), allowNull: false, defaultValue: 'New Board' },
    cols: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 4 },
    rows: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
    background: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '#0a0f1c' },
    created_by: { type: Sequelize.STRING(200), allowNull: true, defaultValue: null },
  }, { tableName: 'wb_boards', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

  WbWidget = sql.define('WbWidget', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
    board_id: { type: Sequelize.UUID, allowNull: false },
    type: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'number' },
    title: { type: Sequelize.STRING(200), allowNull: false, defaultValue: 'Widget' },
    data_source_type: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'sql' },
    data_source_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    display_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    col_start: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    col_span: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    row_start: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    row_span: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    refresh_interval: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 },
  }, { tableName: 'wb_widgets', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

  WbDataset = sql.define('WbDataset', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
    name: { type: Sequelize.STRING(200), allowNull: false, unique: true },
    schema: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
  }, { tableName: 'wb_datasets', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

  WbDatasetData = sql.define('WbDatasetData', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
    dataset_id: { type: Sequelize.UUID, allowNull: false, unique: true },
    data: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
  }, { tableName: 'wb_dataset_data', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
}

async function getBoard(id) {
  if (!WbBoard) return null;
  const board = await WbBoard.findByPk(id);
  if (!board) return null;
  const widgets = await WbWidget.findAll({
    where: { board_id: id },
    order: [['row_start', 'ASC'], ['col_start', 'ASC']],
  });
  return { ...board.get({ plain: true }), widgets: widgets.map(w => w.get({ plain: true })) };
}

async function getBoardByToken(token) {
  if (!WbBoard) return null;
  const board = await WbBoard.findOne({ where: { slug_token: token } });
  if (!board) return null;
  const widgets = await WbWidget.findAll({
    where: { board_id: board.id },
    order: [['row_start', 'ASC'], ['col_start', 'ASC']],
  });
  return { ...board.get({ plain: true }), widgets: widgets.map(w => w.get({ plain: true })) };
}

async function listBoards() {
  if (!WbBoard) return [];
  const boards = await WbBoard.findAll({ order: [['created_at', 'DESC']] });
  const result = [];
  for (const b of boards) {
    const plain = b.get({ plain: true });
    const count = await WbWidget.count({ where: { board_id: b.id } });
    result.push({ ...plain, widget_count: count });
  }
  return result;
}

async function createBoard(name) {
  if (!WbBoard) throw new Error('Models not initialised');
  const board = await WbBoard.create({ name: name || 'New Board' });
  return board.get({ plain: true });
}

async function updateBoard(id, fields) {
  if (!WbBoard) throw new Error('Models not initialised');
  const allowed = ['name', 'cols', 'rows', 'background'];
  const update = {};
  for (const k of allowed) { if (fields[k] !== undefined) update[k] = fields[k]; }
  await WbBoard.update(update, { where: { id } });
  return getBoard(id);
}

async function deleteBoard(id) {
  if (!WbBoard) throw new Error('Models not initialised');
  await WbWidget.destroy({ where: { board_id: id } });
  await WbBoard.destroy({ where: { id } });
}

async function getWidget(id) {
  if (!WbWidget) return null;
  const row = await WbWidget.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

async function createWidget(boardId, fields) {
  if (!WbWidget) throw new Error('Models not initialised');
  const widget = await WbWidget.create({ board_id: boardId, ...fields });
  return widget.get({ plain: true });
}

async function updateWidget(id, fields) {
  if (!WbWidget) throw new Error('Models not initialised');
  const allowed = ['type', 'title', 'data_source_type', 'data_source_config', 'display_config',
    'col_start', 'col_span', 'row_start', 'row_span', 'refresh_interval'];
  const update = {};
  for (const k of allowed) { if (fields[k] !== undefined) update[k] = fields[k]; }
  await WbWidget.update(update, { where: { id } });
  const row = await WbWidget.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

async function deleteWidget(id) {
  if (!WbWidget) throw new Error('Models not initialised');
  await WbWidget.destroy({ where: { id } });
}

async function upsertDataset(name, schema) {
  if (!WbDataset) throw new Error('Models not initialised');
  const [ds] = await WbDataset.findOrCreate({ where: { name }, defaults: { name, schema: schema || [] } });
  if (schema) await ds.update({ schema });
  return ds.get({ plain: true });
}

async function setDatasetData(datasetId, rows) {
  if (!WbDatasetData) throw new Error('Models not initialised');
  const existing = await WbDatasetData.findOne({ where: { dataset_id: datasetId } });
  if (existing) { await existing.update({ data: rows }); return existing.get({ plain: true }); }
  const created = await WbDatasetData.create({ dataset_id: datasetId, data: rows });
  return created.get({ plain: true });
}

async function getDatasetData(datasetId) {
  if (!WbDatasetData) return null;
  const row = await WbDatasetData.findOne({ where: { dataset_id: datasetId } });
  return row ? row.get({ plain: true }) : null;
}

async function listDatasets() {
  if (!WbDataset) return [];
  const rows = await WbDataset.findAll({ order: [['name', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
}

async function deleteDataset(name) {
  if (!WbDataset) return;
  const ds = await WbDataset.findOne({ where: { name } });
  if (!ds) return;
  await WbDatasetData.destroy({ where: { dataset_id: ds.id } });
  await ds.destroy();
}

module.exports = {
  defineWbModels,
  getBoard, getBoardByToken, listBoards, createBoard, updateBoard, deleteBoard,
  getWidget, createWidget, updateWidget, deleteWidget,
  upsertDataset, setDatasetData, getDatasetData, listDatasets, deleteDataset,
};
