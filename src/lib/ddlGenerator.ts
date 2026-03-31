import type { DbEngine } from "@/stores/dbStore";

// ── Types ───────────────────────────────────────────────────────────

export interface ColumnDef {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  extra: string | null; // e.g. AUTO_INCREMENT
  isNew?: boolean;
}

export interface IndexDef {
  name: string;
  type: "PRIMARY" | "UNIQUE" | "INDEX";
  columns: string[];
  isNew?: boolean;
}

export interface ForeignKeyDef {
  name: string;
  column: string;
  refTable: string;
  refColumn: string;
  onDelete: string;
  onUpdate: string;
  isNew?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

function quoteIdentifier(name: string, engine?: DbEngine): string {
  if (engine === "mysql" || engine === "mariadb") {
    return `\`${name.replace(/`/g, "``")}\``;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

// ── ALTER TABLE generators ──────────────────────────────────────────

export function generateAddColumn(
  table: string,
  col: ColumnDef,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  let sql = `ALTER TABLE ${q(table)} ADD COLUMN ${q(col.name)} ${col.dataType}`;
  if (!col.nullable) sql += " NOT NULL";
  if (col.defaultValue !== null) sql += ` DEFAULT ${col.defaultValue}`;
  if (col.extra) sql += ` ${col.extra}`;
  return sql + ";";
}

export function generateDropColumn(
  table: string,
  columnName: string,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  return `ALTER TABLE ${q(table)} DROP COLUMN ${q(columnName)};`;
}

export function generateModifyColumn(
  table: string,
  col: ColumnDef,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  if (engine === "mysql" || engine === "mariadb") {
    let sql = `ALTER TABLE ${q(table)} MODIFY COLUMN ${q(col.name)} ${col.dataType}`;
    if (!col.nullable) sql += " NOT NULL";
    else sql += " NULL";
    if (col.defaultValue !== null) sql += ` DEFAULT ${col.defaultValue}`;
    if (col.extra) sql += ` ${col.extra}`;
    return sql + ";";
  }
  // PostgreSQL
  const stmts: string[] = [];
  stmts.push(`ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} TYPE ${col.dataType};`);
  stmts.push(
    `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} ${col.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`,
  );
  if (col.defaultValue !== null) {
    stmts.push(
      `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} SET DEFAULT ${col.defaultValue};`,
    );
  } else {
    stmts.push(`ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} DROP DEFAULT;`);
  }
  return stmts.join("\n");
}

export function generateRenameColumn(
  table: string,
  oldName: string,
  newName: string,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  return `ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)};`;
}

export function generateAddIndex(
  table: string,
  idx: IndexDef,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  const cols = idx.columns.map((c) => q(c)).join(", ");
  if (idx.type === "PRIMARY") {
    return `ALTER TABLE ${q(table)} ADD PRIMARY KEY (${cols});`;
  }
  const unique = idx.type === "UNIQUE" ? "UNIQUE " : "";
  return `CREATE ${unique}INDEX ${q(idx.name)} ON ${q(table)} (${cols});`;
}

export function generateDropIndex(
  table: string,
  indexName: string,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  if (engine === "mysql" || engine === "mariadb") {
    return `DROP INDEX ${q(indexName)} ON ${q(table)};`;
  }
  return `DROP INDEX IF EXISTS ${q(indexName)};`;
}

export function generateAddForeignKey(
  table: string,
  fk: ForeignKeyDef,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  return `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.refTable)} (${q(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate};`;
}

export function generateDropForeignKey(
  table: string,
  fkName: string,
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  if (engine === "mysql" || engine === "mariadb") {
    return `ALTER TABLE ${q(table)} DROP FOREIGN KEY ${q(fkName)};`;
  }
  return `ALTER TABLE ${q(table)} DROP CONSTRAINT IF EXISTS ${q(fkName)};`;
}

// ── CREATE TABLE ────────────────────────────────────────────────────

export function generateCreateTable(
  tableName: string,
  columns: ColumnDef[],
  indexes: IndexDef[],
  foreignKeys: ForeignKeyDef[],
  engine?: DbEngine,
): string {
  const q = (n: string) => quoteIdentifier(n, engine);
  const lines: string[] = [];

  // Columns
  for (const col of columns) {
    let line = `  ${q(col.name)} ${col.dataType}`;
    if (col.isPrimaryKey && columns.filter((c) => c.isPrimaryKey).length === 1) {
      line += " PRIMARY KEY";
    }
    if (!col.nullable && !col.isPrimaryKey) line += " NOT NULL";
    if (col.defaultValue !== null) line += ` DEFAULT ${col.defaultValue}`;
    if (col.extra) line += ` ${col.extra}`;
    lines.push(line);
  }

  // Composite primary key
  const pkCols = columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length > 1) {
    lines.push(`  PRIMARY KEY (${pkCols.map((c) => q(c.name)).join(", ")})`);
  }

  // Indexes (UNIQUE constraints inline)
  for (const idx of indexes) {
    if (idx.type === "UNIQUE") {
      lines.push(`  UNIQUE (${idx.columns.map((c) => q(c)).join(", ")})`);
    }
  }

  // Foreign keys
  for (const fk of foreignKeys) {
    lines.push(
      `  CONSTRAINT ${q(fk.name)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.refTable)} (${q(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`,
    );
  }

  let sql = `CREATE TABLE ${q(tableName)} (\n${lines.join(",\n")}\n)`;
  if (engine === "mysql" || engine === "mariadb") {
    sql += " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
  }
  sql += ";";

  // Non-unique indexes as separate statements
  const extraIndexes = indexes.filter((i) => i.type === "INDEX");
  if (extraIndexes.length > 0) {
    sql +=
      "\n" +
      extraIndexes.map((idx) => generateAddIndex(tableName, idx, engine)).join("\n");
  }

  return sql;
}
