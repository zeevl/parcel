// @flow
import {Packager} from '@parcel/plugin';

export default new Packager({
  async package(bundle) {
    let promises = [];
    bundle.assetGraph.traverseAssets(asset => {
      promises.push(asset.getOutput());
    });
    let outputs = await Promise.all(promises);

    let assets = '';
    let i = 0;
    bundle.assetGraph.traverseAssets(asset => {
      let output = outputs[i];
      i++;
      assets += output.code;
    });

    return assets;
  }
});
