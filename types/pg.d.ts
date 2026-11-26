declare module 'pg' {
  export interface PoolConfig {
    connectionString?: string;
  }

  export interface QueryConfig {
    text: string;
    values?: readonly unknown[];
    query_timeout?: number;
  }

  export interface PoolClient {
    query<Row = Record<string, unknown>>(
      query: string | QueryConfig,
      values?: readonly unknown[],
    ): Promise<{ rows: Row[] }>;
    on(event: 'error', listener: (error: Error) => void): this;
    removeListener(event: 'error', listener: (error: Error) => void): this;
    release(error?: Error | boolean): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
