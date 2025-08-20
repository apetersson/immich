import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { RepositoryInterface } from 'src/types';
import { clearConfigCache } from 'src/utils/config';
import { Mocked, vitest } from 'vitest';

import { Kysely } from 'kysely';
import { DB } from 'src/schema';

export const newSystemMetadataRepositoryMock = (db: Kysely<DB> = {} as Kysely<DB>): Mocked<SystemMetadataRepository> => {
  clearConfigCache();
  return {
    db, // Add db property
    get: vitest.fn() as any,
    set: vitest.fn(),
    delete: vitest.fn(),
    readFile: vitest.fn(),
  };
};
