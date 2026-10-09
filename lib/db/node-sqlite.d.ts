// Minimal ambient types for Node's built-in `node:sqlite` (stable enough in
// Node 24, but not yet shipped in @types/node@20). Declares only the surface
// this project uses. Remove once @types/node ships `node:sqlite` typings.
declare module "node:sqlite" {
  type SupportedValue = null | number | bigint | string | Uint8Array;

  interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  class StatementSync {
    get(...params: SupportedValue[]): unknown;
    all(...params: SupportedValue[]): unknown[];
    run(...params: SupportedValue[]): StatementResultingChanges;
    iterate(...params: SupportedValue[]): IterableIterator<unknown>;
  }

  interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    open(): void;
    close(): void;
  }
}
