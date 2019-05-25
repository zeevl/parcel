// @flow

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async transform({asset}) {
    let content = await asset.getCode();
    asset.type = 'js';
    asset.setCode(`module.exports = ${content}`);
    return [asset];
  }
});
