// @flow

import type {
  BuildFailureEvent,
  BuildSuccessEvent,
  InitialParcelOptions,
  ParcelOptions,
  Stats
} from '@parcel/types';
import type {Bundle} from './types';
import type InternalBundleGraph from './BundleGraph';

import invariant from 'assert';
import {Asset} from './public/Asset';
import {BundleGraph} from './public/BundleGraph';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import nullthrows from 'nullthrows';
import clone from 'clone';
import Cache from '@parcel/cache';
import watcher from '@parcel/watcher';
import path from 'path';
import AssetGraphBuilder, {BuildAbortError} from './AssetGraphBuilder';
import ConfigResolver from './ConfigResolver';
import ReporterRunner from './ReporterRunner';
import MainAssetGraph from './public/MainAssetGraph';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import resolveOptions from './resolveOptions';

type BuildEvent = BuildSuccessEvent | BuildFailureEvent;

export default class Parcel {
  #assetGraphBuilder; // AssetGraphBuilder
  #bundlerRunner; // BundlerRunner
  #farm; // WorkerFarm
  #initialized = false; // boolean
  #initialOptions; // InitialParcelOptions;
  #reporterRunner; // ReporterRunner
  #resolvedOptions = null; // ?ParcelOptions
  #runPackage; // (bundle: Bundle, bundleGraph: InternalBundleGraph) => Promise<Stats>;
  watcherObservable: ?Observable<BuildEvent>; // Observable<BuildEvent>

  constructor(options: InitialParcelOptions) {
    this.#initialOptions = clone(options);
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    let resolvedOptions: ParcelOptions = await resolveOptions(
      this.#initialOptions
    );
    this.#resolvedOptions = resolvedOptions;
    await Cache.createCacheDir(resolvedOptions.cacheDir);

    let configResolver = new ConfigResolver();
    let config;

    // If an explicit `config` option is passed use that, otherwise resolve a .parcelrc from the filesystem.
    if (resolvedOptions.config) {
      config = await configResolver.create(resolvedOptions.config);
    } else {
      config = await configResolver.resolve(resolvedOptions.rootDir);
    }

    // If no config was found, default to the `defaultConfig` option if one is provided.
    if (!config && resolvedOptions.defaultConfig) {
      config = await configResolver.create(resolvedOptions.defaultConfig);
    }

    if (!config) {
      throw new Error('Could not find a .parcelrc');
    }

    this.#bundlerRunner = new BundlerRunner({
      options: resolvedOptions,
      config
    });

    this.#reporterRunner = new ReporterRunner({
      config,
      options: resolvedOptions
    });

    this.#assetGraphBuilder = new AssetGraphBuilder({
      options: resolvedOptions,
      config,
      entries: resolvedOptions.entries,
      targets: resolvedOptions.targets
    });

    this.#farm = await WorkerFarm.getShared(
      {
        config,
        options: resolvedOptions,
        env: resolvedOptions.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.#runPackage = this.#farm.mkhandle('runPackage');
    this.#initialized = true;
  }

  watch(): Observable<BuildEvent> {
    if (this.watcherObservable != null) {
      return this.watcherObservable;
    }

    this.watcherObservable = new SharedObservable(observer => {
      let subscriptionPromise = (async () => {
        if (!this.#initialized) {
          await this.init();
        }

        observer.next(await this.build());

        let resolvedOptions = nullthrows(this.#resolvedOptions);
        let projectRoot = resolvedOptions.projectRoot;
        let targetDirs = resolvedOptions.targets.map(target => target.distDir);
        let vcsDirs = ['.git', '.hg'].map(dir => path.join(projectRoot, dir));
        let ignore = [resolvedOptions.cacheDir, ...targetDirs, ...vcsDirs];

        return watcher.subscribe(
          projectRoot,
          (err, events) => {
            if (err) {
              observer.error(err);
              return;
            }

            this.#assetGraphBuilder.respondToFSEvents(events);
            if (this.#assetGraphBuilder.isInvalid()) {
              this.build()
                .then(event => observer.next(event))
                .catch(() => {
                  // Do nothing, in watch mode reporters should alert the user something is broken, which
                  // allows Parcel to gracefully continue once the user makes the correct changes
                });
            }
          },
          {ignore}
        );
      })();

      subscriptionPromise.catch(err => observer.error(err));

      return () =>
        subscriptionPromise.then(async subscription => {
          await subscription.unsubscribe();
          this.watcherObservable = null;
        });
    });

    return this.watcherObservable;
  }

  // `run()` returns `Promise<?BundleGraph>` because in watch mode it does not
  // return a bundle graph, but outside of watch mode it always will.
  async run(): Promise<BundleGraph> {
    if (!this.#initialized) {
      await this.init();
    }

    // $FlowFixMe
    let event = await this.build();
    if (nullthrows(this.#resolvedOptions).killWorkers !== false) {
      await this.#farm.end();
    }
    invariant(event.type === 'buildSuccess');
    return event.bundleGraph;
  }

  async build(): Promise<BuildEvent> {
    try {
      this.#reporterRunner.report({
        type: 'buildStart'
      });

      let startTime = Date.now();
      let {assetGraph, changedAssets} = await this.#assetGraphBuilder.build();
      dumpGraphToGraphViz(assetGraph, 'MainAssetGraph');

      let internalBundleGraph = await this.#bundlerRunner.bundle(assetGraph);
      dumpGraphToGraphViz(internalBundleGraph, 'BundleGraph');

      await packageBundles(internalBundleGraph, this.#runPackage);

      let buildTime = Date.now() - startTime;
      let bundleGraph = new BundleGraph(internalBundleGraph);

      let event = {
        type: 'buildSuccess',
        changedAssets: new Map(
          Array.from(changedAssets).map(([id, asset]) => [id, new Asset(asset)])
        ),
        assetGraph: new MainAssetGraph(assetGraph),
        bundleGraph: bundleGraph,
        buildTime
      };

      this.#reporterRunner.report(event);
      return event;
    } catch (error) {
      if (!(error instanceof BuildAbortError)) {
        let event = {
          type: 'buildFailure',
          error
        };

        await this.#reporterRunner.report(event);
        return event;
      }

      throw new BuildError(error);
    }
  }
}

function packageBundles(
  bundleGraph: InternalBundleGraph,
  runPackage: (
    bundle: Bundle,
    bundleGraph: InternalBundleGraph
  ) => Promise<Stats>
): Promise<mixed> {
  let promises = [];
  bundleGraph.traverseBundles(bundle => {
    promises.push(
      runPackage(bundle, bundleGraph).then(stats => {
        bundle.stats = stats;
      })
    );
  });

  return Promise.all(promises);
}

type Observer<T> = {|
  next: T => void,
  error: mixed => void,
  complete: () => void
|};

type PartialObserver<T> = {|
  next?: T => void,
  error?: mixed => void,
  complete?: () => void
|};

type Subscription = {|
  unsubscribe: () => mixed
|};

class Observable<T> {
  cb: (observer: Observer<T>) => () => mixed;
  constructor(cb: (observer: Observer<T>) => () => mixed) {
    this.cb = cb;
  }
  subscribe(observer?: PartialObserver<T>): Subscription {
    return {
      unsubscribe: this.cb({
        // eslint-disable-next-line no-unused-vars
        next: _ => {},
        error: () => {},
        complete: () => {},
        ...observer
      })
    };
  }
}

class SharedObservable<T> extends Observable<T> {
  subscription: ?Subscription;
  subscribers: Array<PartialObserver<T>> = [];

  subscribe(observer?: PartialObserver<T>): Subscription {
    this.subscribers.push(observer ?? {});

    if (this.subscription == null) {
      this.subscription = new Observable(this.cb).subscribe({
        next: val => {
          for (let subscriber of this.subscribers.slice()) {
            subscriber.next && subscriber.next(val);
          }
        },
        error: err => {
          for (let subscriber of this.subscribers.slice()) {
            subscriber.error && subscriber.error(err);
          }
        },
        complete: () => {
          for (let subscriber of this.subscribers.slice()) {
            subscriber.complete && subscriber.complete();
          }
        }
      });
    }

    return {
      unsubscribe: () => {
        let subscriberIndex = this.subscribers.indexOf(observer);
        if (subscriberIndex > -1) {
          this.subscribers.splice(subscriberIndex, 1);
        }
        if (this.subscribers.length === 0) {
          nullthrows(this.subscription).unsubscribe();
          this.subscription = null;
        }
      }
    };
  }
}

export class BuildError extends Error {
  name = 'BuildError';
  error: mixed;

  constructor(error: mixed) {
    super(error instanceof Error ? error.message : 'Unknown Build Error');
    this.error = error;
  }
}

export {default as Asset} from './Asset';
export {default as Dependency} from './Dependency';
export {default as Environment} from './Environment';
