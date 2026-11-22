/** Entities are addressed by id, so a repeated id renders one row twice and breaks React keys.
 *  Snapshots are the boundary where that is caught: duplicates are dropped and named in dev. */
export function uniqueRows<T extends {id: string}>(rows: T[] | undefined, name: string, report: boolean = true): T[] {
 if (!Array.isArray(rows)) return [];
 const seen = new Set<string>();
 const kept: T[] = [];
 for (const row of rows) {
  if (!row || typeof row.id !== 'string') {
   kept.push(row);
   continue;
  }
  if (seen.has(row.id)) {
   if (report) console.warn(`[Сомбра] повтор id в ${name}: ${row.id} — запись пропущена`);
   continue;
  }
  seen.add(row.id);
  kept.push(row);
 }
 return kept;
}

export function uniqueIds(ids: string[] | undefined): string[] {
 return Array.isArray(ids) ? [...new Set(ids)] : [];
}
