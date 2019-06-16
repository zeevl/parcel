// @flow

import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
import coffee from 'coffeescript';

export default new Transformer({
  async transform({asset, options}) {
    asset.type = 'js';

    if (options.sourceMaps) {
      let {js, v3SourceMap} = coffee.compile(await asset.getCode(), {
        sourceMap: true,
        bare: true
      });

      asset.setCode(js);
      asset.setMap(SourceMap.fromRawSourceMap(v3SourceMap));
    } else {
      let js = coffee.compile(await asset.getCode(), {bare: true});
      asset.setCode(js);
    }

    return [asset];
  }
});
