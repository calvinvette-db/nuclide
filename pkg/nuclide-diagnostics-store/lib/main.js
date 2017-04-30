/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {
  DiagnosticUpdater,
  CallbackDiagnosticProvider,
  LinterProvider,
  ObservableDiagnosticProvider,
  ObservableDiagnosticUpdater,
} from '../../nuclide-diagnostics-common';
import type {LinterAdapter} from './LinterAdapter';
import type {IndieLinterDelegate} from './IndieLinterRegistry';

import createPackage from '../../commons-atom/createPackage';
import UniversalDisposable from '../../commons-node/UniversalDisposable';
import {observableFromSubscribeFunction} from '../../commons-node/event';
import {getLogger} from '../../nuclide-logging';
import {DiagnosticStore} from '../../nuclide-diagnostics-common';

import {createAdapters} from './LinterAdapterFactory';
import IndieLinterRegistry from './IndieLinterRegistry';

type RegisterIndieLinter = ({name: string}) => IndieLinterDelegate;

class Activation {
  _disposables: UniversalDisposable;
  _diagnosticStore: DiagnosticStore;

  _diagnosticUpdater: ?DiagnosticUpdater;
  _observableDiagnosticUpdater: ?ObservableDiagnosticUpdater;

  _allLinterAdapters: Set<LinterAdapter>;
  _indieRegistry: ?IndieLinterRegistry;

  constructor() {
    this._allLinterAdapters = new Set();
    this._diagnosticStore = new DiagnosticStore();

    this._disposables = new UniversalDisposable(this._diagnosticStore, () => {
      this._allLinterAdapters.forEach(adapter => adapter.dispose());
      this._allLinterAdapters.clear();
    });
  }

  dispose() {
    this._disposables.dispose();
  }

  _getIndieRegistry(): IndieLinterRegistry {
    if (this._indieRegistry == null) {
      const registry = new IndieLinterRegistry();
      this._disposables.add(registry);
      this._indieRegistry = registry;
      return registry;
    }
    return this._indieRegistry;
  }

  /**
   * @return A wrapper around the methods on DiagnosticStore that allow reading data.
   */
  provideDiagnosticUpdates(): DiagnosticUpdater {
    if (!this._diagnosticUpdater) {
      const store = this._diagnosticStore;
      this._diagnosticUpdater = {
        onFileMessagesDidUpdate: store.onFileMessagesDidUpdate.bind(store),
        onProjectMessagesDidUpdate: store.onProjectMessagesDidUpdate.bind(
          store,
        ),
        onAllMessagesDidUpdate: store.onAllMessagesDidUpdate.bind(store),
        applyFix: store.applyFix.bind(store),
        applyFixesForFile: store.applyFixesForFile.bind(store),
      };
    }
    return this._diagnosticUpdater;
  }

  provideObservableDiagnosticUpdates(): ObservableDiagnosticUpdater {
    if (this._observableDiagnosticUpdater == null) {
      const store = this._diagnosticStore;
      this._observableDiagnosticUpdater = {
        getFileMessageUpdates: path => store.getFileMessageUpdates(path),
        projectMessageUpdates: store.getProjectMessageUpdates(),
        allMessageUpdates: store.getAllMessageUpdates(),
        applyFix: message => store.applyFix(message),
        applyFixesForFile: file => store.applyFixesForFile(file),
      };
    }
    return this._observableDiagnosticUpdater;
  }

  provideIndie(): RegisterIndieLinter {
    return config => {
      const delegate = this._getIndieRegistry().register(config);
      const disposable = this.consumeDiagnosticsProviderV2(delegate);
      delegate.onDidDestroy(() => {
        disposable.dispose();
      });
      return delegate;
    };
  }

  consumeLinterProvider(
    provider: LinterProvider | Array<LinterProvider>,
  ): IDisposable {
    const newAdapters = createAdapters(provider);
    const adapterDisposables = new UniversalDisposable();
    for (const adapter of newAdapters) {
      this._allLinterAdapters.add(adapter);
      const diagnosticDisposable = this.consumeDiagnosticsProviderV2({
        updates: adapter.getUpdates(),
        invalidations: adapter.getInvalidations(),
      });
      adapterDisposables.add(() => {
        diagnosticDisposable.dispose();
        adapter.dispose();
        this._allLinterAdapters.delete(adapter);
      });
    }
    return adapterDisposables;
  }

  consumeDiagnosticsProviderV1(
    provider: CallbackDiagnosticProvider,
  ): IDisposable {
    // Register the diagnostic store for updates from the new provider.
    const observableProvider = {
      updates: observableFromSubscribeFunction(
        provider.onMessageUpdate.bind(provider),
      ),
      invalidations: observableFromSubscribeFunction(
        provider.onMessageInvalidation.bind(provider),
      ),
    };
    return this.consumeDiagnosticsProviderV2(observableProvider);
  }

  consumeDiagnosticsProviderV2(
    provider: ObservableDiagnosticProvider,
  ): IDisposable {
    const store = this._diagnosticStore;

    const subscriptions = new UniversalDisposable(
      provider.updates.subscribe(
        update => store.updateMessages(provider, update),
        error => {
          getLogger().error(`Error: updates.subscribe ${error}`);
        },
        () => {
          getLogger().error('updates.subscribe completed');
        },
      ),
      provider.invalidations.subscribe(
        invalidation => store.invalidateMessages(provider, invalidation),
        error => {
          getLogger().error(`Error: invalidations.subscribe ${error}`);
        },
        () => {
          getLogger().error('invalidations.subscribe completed');
        },
      ),
    );
    this._disposables.add(subscriptions);

    return new UniversalDisposable(
      // V1 providers have no way of terminating the streams, so unsubscribe just in case.
      subscriptions,
      () => {
        // When the provider package goes away, we need to invalidate its messages.
        store.invalidateMessages(provider, {scope: 'all'});
      },
    );
  }
}

createPackage(module.exports, Activation);
