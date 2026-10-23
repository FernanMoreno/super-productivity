import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataInitStateService } from '../core/data-init/data-init-state.service';
import { PluginService } from '../plugins/plugin.service';
import { PluginLog } from '../core/log';

/** Native navigation can load enabled plugins before any iframe is mounted. */
@Injectable({ providedIn: 'root' })
export class WorkspacePluginStartupService {
  private readonly _plugins = inject(PluginService);
  private readonly _dataInit = inject(DataInitStateService);
  private _pending?: Promise<void>;
  readonly isLoading = signal(false);
  readonly hasError = signal(false);

  ensureInitialized(): Promise<void> {
    if (this._plugins.isInitialized()) {
      return Promise.resolve();
    }
    if (this._pending) {
      return this._pending;
    }
    this.isLoading.set(true);
    this.hasError.set(false);
    this._pending = this._initialize().finally(() => {
      this.isLoading.set(false);
      this._pending = undefined;
    });
    return this._pending;
  }

  private async _initialize(): Promise<void> {
    try {
      // Migration discovery reads native providers; never run it against an
      // unhydrated store. It must not depend on a rendered plugin iframe.
      await firstValueFrom(this._dataInit.isAllDataLoadedInitially$);
      await this._plugins.initializePlugins();
    } catch (error) {
      this.hasError.set(true);
      PluginLog.err('Workspace plugin initialization failed:', error);
    }
  }
}
