// @flow strict-local

import type {ParcelOptions, AssetRequest, JSONObject} from '@parcel/types';
import type {Bundle} from './types';
import type BundleGraph from './BundleGraph';

import TransformerRunner from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import Config from './Config';
import Cache from '@parcel/cache';

import invariant from 'assert';

type Options = {|
  config: Config,
  options: ParcelOptions,
  env: JSONObject
|};

let transformerRunner: TransformerRunner | null = null;
let packagerRunner: PackagerRunner | null = null;

export function init({config, options, env}: Options) {
  Object.assign(process.env, env || {});

  Cache.init(options);

  transformerRunner = new TransformerRunner({
    config,
    options
  });
  packagerRunner = new PackagerRunner({
    config,
    options
  });
}

export function runTransform(req: AssetRequest) {
  if (!transformerRunner) {
    throw new Error('.runTransform() called before .init()');
  }

  return transformerRunner.transform(req);
}

export async function runPackage(bundle: Bundle, bundleGraph: BundleGraph) {
  await null;
  bundle.assetGraph.traverse(node => {
    if (node.type !== 'dependency') {
      return;
    }

    let dep = node.value;
    if (!dep.isURL || !dep.isAsync) {
      return;
    }

    let [bundleGroupNode] = bundle.assetGraph.getNodesConnectedFrom(node);
    invariant(bundleGroupNode && bundleGroupNode.type === 'bundle_group');

    let [entryBundleNode] = bundle.assetGraph.getNodesConnectedFrom(
      bundleGroupNode
    );
    invariant(entryBundleNode && entryBundleNode.type === 'bundle_reference');

    if (!entryBundleNode.value.target) {
      console.log('TARGET NULLISH IN WORKER RUN PACKAGE');
      console.log('ENTRY BUNDLE', entryBundleNode.value.bundle);
      console.log('PackagerRunner PID', process.pid);
    }
  });
  if (!packagerRunner) {
    throw new Error('.runPackage() called before .init()');
  }

  return packagerRunner.writeBundle(bundle, bundleGraph);
}
