const http = require('http');
const https = require('https');
const path = require('path');
const SourceMap = require('./SourceMap');
const WebSocket = require('ws');
const generateCertificate = require('./utils/generateCertificate');
const getCertificate = require('./utils/getCertificate');
const logger = require('@parcel/logger');

class HMRServer {
  async start(options = {}) {
    await new Promise(async resolve => {
      if (!options.https) {
        this.server = http.createServer();
      } else if (typeof options.https === 'boolean') {
        this.server = https.createServer(generateCertificate(options));
      } else {
        this.server = https.createServer(await getCertificate(options.https));
      }

      let websocketOptions = {
        server: this.server
      };

      if (options.hmrHostname) {
        websocketOptions.origin = `${options.https ? 'https' : 'http'}://${
          options.hmrHostname
        }`;
      }

      this.wss = new WebSocket.Server(websocketOptions);
      this.server.listen(options.hmrPort, resolve);
    });

    this.wss.on('connection', ws => {
      ws.onerror = this.handleSocketError;
      if (this.unresolvedError) {
        ws.send(JSON.stringify(this.unresolvedError));
      }
    });

    this.wss.on('error', this.handleSocketError);

    return this.wss._server.address().port;
  }

  stop() {
    this.wss.close();
    this.server.close();
  }

  emitError(err) {
    let {message, stack} = logger.formatError(err);

    // store the most recent error so we can notify new connections
    // and so we can broadcast when the error is resolved
    this.unresolvedError = {
      type: 'error',
      error: {
        message,
        stack
      }
    };

    this.broadcast(this.unresolvedError);
  }

  emitUpdate(assets) {
    if (this.unresolvedError) {
      this.unresolvedError = null;
      this.broadcast({
        type: 'error-resolved'
      });
    }

    const shouldReload = assets.some(asset => asset.hmrPageReload);
    if (shouldReload) {
      this.broadcast({
        type: 'reload'
      });
    } else {
      let processedAssets = Promise.all(
        assets.map(async asset => {
          let deps = {};
          for (let [dep, depAsset] of asset.depAssets) {
            deps[dep.name] = depAsset.id;
          }

          let map;
          if (asset.generated.map) {
            const output = (await new SourceMap().addMap(
              asset.generated.map
            )).stringify(
              null,
              path.relative(asset.options.outDir, asset.options.rootDir)
            );
            map = `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(
              output
            ).toString('base64')}`;
          }
          return {
            id: asset.id,
            generated: {
              ...asset.generated,
              map
            },
            deps: deps
          };
        })
      );

      processedAssets.then(a =>
        this.broadcast({
          type: 'update',
          assets: a
        })
      );
    }
  }

  handleSocketError(err) {
    if (err.error.code === 'ECONNRESET') {
      // This gets triggered on page refresh, ignore this
      return;
    }
    logger.warn(err);
  }

  broadcast(msg) {
    const json = JSON.stringify(msg);
    for (let ws of this.wss.clients) {
      ws.send(json);
    }
  }
}

module.exports = HMRServer;
