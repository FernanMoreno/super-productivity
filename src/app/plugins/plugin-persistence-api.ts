import { Injector } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { pluginAssert } from './plugin-bridge-asserts';
import {
  assertPluginPersistenceKey,
  composeId,
} from './util/plugin-persistence-key.util';
import { OperationWriteFlushService } from '../op-log/sync/operation-write-flush.service';
import { OperationCaptureService } from '../op-log/capture/operation-capture.service';
import { PluginLog } from '../core/log';
import { T } from '../t.const';

export const assertPluginWritesHealthy = (injector: Injector): void => {
  if (injector.get(OperationCaptureService).hasUnrecoveredPersistFailure()) {
    throw new Error('Plugin data could not be made durable; reload before retrying');
  }
};
export const flushPluginWrites = async (injector: Injector): Promise<void> => {
  await injector.get(OperationWriteFlushService).flushPendingWrites();
  assertPluginWritesHealthy(injector);
};

export const persistPluginDataSynced = async (
  injector: Injector,
  persistence: PluginUserPersistenceService,
  translate: TranslateService,
  pluginId: string,
  dataStr: string,
  key?: string,
): Promise<void> => {
  pluginAssert.string(dataStr);
  assertPluginPersistenceKey(key);
  try {
    await persistence.persistPluginUserData(composeId(pluginId, key), dataStr);
    await flushPluginWrites(injector);
    PluginLog.log('PluginBridge: Plugin data persisted successfully', {
      pluginId,
      keyLen: key?.length ?? 0,
      dataSize: new Blob([dataStr]).size,
    });
  } catch (error) {
    PluginLog.err('PluginBridge: Failed to persist plugin data:', error);
    if (error instanceof Error) throw error;
    throw new Error(translate.instant(T.PLUGINS.UNABLE_TO_PERSIST_DATA));
  }
};

export const compareAndSwapPluginData = async (
  persistence: PluginUserPersistenceService,
  pluginId: string,
  expected: string | null,
  dataStr: string,
  key?: string,
): Promise<boolean> => {
  if (expected !== null) pluginAssert.string(expected);
  pluginAssert.string(dataStr);
  assertPluginPersistenceKey(key);
  return persistence.compareAndSwapPluginUserData(
    composeId(pluginId, key),
    expected,
    dataStr,
  );
};
