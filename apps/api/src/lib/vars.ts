import { all } from '../db.js';
import type { Variable } from './scenario.js';

export interface FarmRow {
  id: string;
  name: string;
  tin: string;
  one_c_url: string | null;
}

function systemValue(key: Variable['systemKey'], farm: FarmRow, at: Date): string {
  switch (key) {
    case 'farm.name':
      return farm.name;
    case 'farm.tin':
      return farm.tin;
    case 'date':
      return `${String(at.getDate()).padStart(2, '0')}.${String(at.getMonth() + 1).padStart(2, '0')}.${at.getFullYear()}`;
    case 'period':
      return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
    default:
      return '';
  }
}

export function resolveVariables(
  variables: Variable[],
  farm: FarmRow,
  datasetId: string | null,
  at = new Date(),
): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  const datasetRows = datasetId
    ? all<{ variable: string; value: string }>(
        'SELECT variable, value FROM dataset_values WHERE dataset_id = ? AND farm_tin = ?',
        datasetId,
        farm.tin,
      )
    : [];
  const fromDataset = new Map(datasetRows.map((row) => [row.variable, row.value]));

  for (const variable of variables) {
    let value = '';
    if (variable.source === 'system') value = systemValue(variable.systemKey, farm, at);
    if (variable.source === 'constant') value = variable.value ?? '';
    if (variable.source === 'dataset') value = fromDataset.get(variable.name) ?? '';
    values[variable.name] = value;
    if (variable.source === 'dataset' && value === '') missing.push(variable.name);
  }

  return { values, missing };
}
