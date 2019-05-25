// @flow strict-local

import type {IDisposable, InitialParcelOptions} from '@parcel/types';

// $FlowFixMe this is untyped
import Module from 'module';
import path from 'path';
// $FlowFixMe this is untyped
import {addHook} from 'pirates';
import Parcel, {INTERNAL_RESOLVE, INTERNAL_TRANSFORM} from './Parcel';
import {syncPromise} from '@parcel/utils';

let hooks = {};
let lastDisposable;

export default function register(opts?: InitialParcelOptions): IDisposable {
  // Replace old hook, as this one likely contains options.
  if (lastDisposable) {
    lastDisposable.dispose();
  }

  let parcel = new Parcel({
    logLevel: 'error',
    ...opts
  });

  let env = {
    context: 'node',
    engines: {
      node: process.versions.node
    }
  };

  syncPromise(parcel.init());

  let isProcessing = false;

  // As Parcel is pretty much fully asynchronous, create an async function and wrap it in a syncPromise later...
  async function fileProcessor(code, filePath) {
    if (isProcessing) {
      return code;
    }

    try {
      isProcessing = true;
      // $FlowFixMe
      let result = await parcel[INTERNAL_TRANSFORM]({
        filePath,
        env
      });

      if (result.assets && result.assets.length >= 1) {
        let output = '';
        let asset = result.assets.find(a => a.type === 'js');
        if (asset) {
          output = await asset.getCode();
        }
        if (filePath.endsWith('@parcel/fs/src/index.js')) {
          console.log('output', output);
        }
        return output;
      }
    } catch (e) {
      /* eslint-disable no-console */
      console.error('@parcel/register failed to process: ', filePath);
      console.error(e);
      /* eslint-enable */
    } finally {
      isProcessing = false;
    }

    return '';
  }

  let hookFunction = (...args) => syncPromise(fileProcessor(...args));

  function resolveFile(currFile, targetFile) {
    try {
      isProcessing = true;

      let resolved = syncPromise(
        // $FlowFixMe
        parcel[INTERNAL_RESOLVE]({
          moduleSpecifier: targetFile,
          sourcePath: currFile,
          env
        })
      );

      let targetFileExtension = path.extname(resolved);
      if (!hooks[targetFileExtension]) {
        hooks[targetFileExtension] = addHook(hookFunction, {
          exts: [targetFileExtension],
          ignoreNodeModules: false
        });
      }

      console.log(
        '\n\nresolved from\n',
        currFile,
        'to\n',
        targetFile,
        'as\n',
        resolved
      );

      console.log('from node');
      try {
        console.log(
          require('resolve').sync(targetFile, {
            basedir: currFile ?? process.cwd()
          })
        );
      } catch (e) {}

      return resolved;
    } finally {
      isProcessing = false;
    }
  }

  hooks.js = addHook(hookFunction, {
    exts: ['.js'],
    ignoreNodeModules: false
  });

  let disposed;

  // Patching Module._resolveFilename takes care of patching the underlying
  // resolver in both `require` and `require.resolve`:
  // https://github.com/nodejs/node-v0.x-archive/issues/1125#issuecomment-10748203
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function parcelResolveFilename(to, from, ...rest) {
    let normalizedFrom;
    if (from && from.filename == null) {
      // HACK: if a request origin's filename is `null`, fall back to cwd.
      //       for example, in a node repl, requires originate from a null filename
      //       but are expected to resolve relative to where the repl's cwd.
      //       Add an `index` to the end since this gets run through `dirname`.
      normalizedFrom = path.join(process.cwd(), 'index');
    } else {
      normalizedFrom = from?.filename;
    }

    return isProcessing || disposed
      ? originalResolveFilename(to, from, ...rest)
      : resolveFile(normalizedFrom, to);
  };

  let disposable = (lastDisposable = {
    dispose() {
      if (disposed) {
        return;
      }

      for (let extension in hooks) {
        hooks[extension]();
      }

      disposed = true;
    }
  });

  return disposable;
}
