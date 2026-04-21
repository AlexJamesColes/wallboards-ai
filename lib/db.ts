const Sequelize = require('sequelize');
const wbDb = require('../wb-db');

let readyPromise: Promise<void> | null = null;

export function ensureDbReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) { console.warn('[db] DATABASE_URL not set'); return; }
    try {
      const sql = new Sequelize(url, {
        dialect: 'postgres',
        dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
        logging: false,
        pool: { max: 5, min: 0, idle: 10000 },
      });
      wbDb.defineWbModels(sql);
      await sql.sync({ alter: true });
      console.log('[db] ready');
    } catch (e) {
      console.error('[db] init failed:', e);
      readyPromise = null;
      throw e;
    }
  })();
  return readyPromise;
}

export interface WbWidget {
  id: string;
  board_id: string;
  type: 'number' | 'table' | 'leaderboard' | 'line' | 'bar';
  title: string;
  data_source_type: 'sql' | 'dataset' | 'zendesk';
  data_source_config: Record<string, any>;
  display_config: Record<string, any>;
  col_start: number;
  col_span: number;
  row_start: number;
  row_span: number;
  refresh_interval: number;
}

export interface WbBoard {
  id: string;
  slug_token: string;
  name: string;
  cols: number;
  rows: number;
  background: string;
  created_by: string | null;
  widgets: WbWidget[];
}

export interface WbDataset {
  id: string;
  name: string;
  schema: any[];
}

export const getBoard: (id: string) => Promise<WbBoard | null> = wbDb.getBoard;
export const getBoardByToken: (token: string) => Promise<WbBoard | null> = wbDb.getBoardByToken;
export const listBoards: () => Promise<(WbBoard & { widget_count: number })[]> = wbDb.listBoards;
export const createBoard: (name: string) => Promise<WbBoard> = wbDb.createBoard;
export const updateBoard: (id: string, fields: Partial<WbBoard>) => Promise<WbBoard | null> = wbDb.updateBoard;
export const deleteBoard: (id: string) => Promise<void> = wbDb.deleteBoard;
export const getWidget: (id: string) => Promise<WbWidget | null> = wbDb.getWidget;
export const createWidget: (boardId: string, fields: Partial<WbWidget>) => Promise<WbWidget> = wbDb.createWidget;
export const updateWidget: (id: string, fields: Partial<WbWidget>) => Promise<WbWidget | null> = wbDb.updateWidget;
export const deleteWidget: (id: string) => Promise<void> = wbDb.deleteWidget;
export const upsertDataset: (name: string, schema?: any[]) => Promise<WbDataset> = wbDb.upsertDataset;
export const setDatasetData: (datasetId: string, rows: any[]) => Promise<any> = wbDb.setDatasetData;
export const getDatasetData: (datasetId: string) => Promise<any> = wbDb.getDatasetData;
export const listDatasets: () => Promise<WbDataset[]> = wbDb.listDatasets;
export const deleteDataset: (name: string) => Promise<void> = wbDb.deleteDataset;
