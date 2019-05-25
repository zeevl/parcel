const gulp = require('gulp');
const babel = require('gulp-babel');
const rimraf = require('rimraf');
const merge = require('merge-stream');
const cache = require('gulp-cached');
const path = require('path');
const {Transform} = require('stream');
const {spawn} = require('child_process');
const fs = require('fs');

const babelConfig = require('./babel.config.js');

const paths = {
  packageSrc: [
    'packages/*/*/src/**/*.js',
    '!packages/*/scope-hoisting/src/helpers.js',
    '!**/loaders/**',
    '!**/prelude.js',
    '!packages/examples/**',
    '!packages/core/integration-tests/**',
    '!packages/core/workers/test/integration/**'
  ],
  packageOther: [
    'packages/**',
    '!packages/**/*.js',
    'packages/*/scope-hoisting/src/helpers.js',
    'packages/*/*/src/**/loaders/**',
    'packages/*/*/src/**/prelude.js'
  ],
  rest: ['**', '!packages/**', '!node_modules/**'],
  packageDest: path.join('bootstrap', 'packages'),
  dest: 'bootstrap'
};

let bootstrapClean = (exports['bootstrap:clean'] = function clean(cb) {
  rimraf('bootstrap', cb);
});

function bootstrapBuildOnly() {
  return gulp
    .src(paths.packageSrc)
    .pipe(cache('packageSrc', {optimizeMemory: true}))
    .pipe(babel(babelConfig))
    .pipe(renameStream(relative => relative.replace('src', 'lib')))
    .pipe(gulp.dest(paths.packageDest));
}

let bootstrapBuild = (exports['bootstrap:build'] = function bootstrapBuild() {
  // See example of merging cloned streams at gulp-clone README:
  // https://github.com/mariocasciaro/gulp-clone/blob/4476fcf34a5336c2d33c2fc4a6ab2cd163e302e7/README.md
  // Which is licensed MIT
  return merge(
    bootstrapBuildOnly(),
    gulp
      .src(paths.packageOther)
      .pipe(cache('packageOther', {optimizeMemory: true}))
      .pipe(renameStream(relative => relative.replace('src', 'lib')))
      .pipe(gulp.dest(paths.packageDest)),
    gulp
      .src(paths.rest)
      .pipe(cache('rest', {optimizeMemory: true}))
      .pipe(gulp.dest(paths.dest))
  );
});

let bootstrapYarn = (exports['bootstrap:build'] = function bootstrapYarn(cb) {
  let spawned = spawn('yarn', ['--production'], {
    cwd: path.join(__dirname, 'bootstrap'),
    stdio: 'inherit'
  });
  spawned.on('close', cb);
});

let bootstrapLink = (exports['bootstrap:link'] = function bootstrapLink(cb) {
  let linkDest = path.join(
    __dirname,
    'node_modules',
    '@parcel',
    'register-dev'
  );

  // remove an existing symlink
  try {
    fs.unlinkSync(linkDest);
  } catch (e) {
    // Ignore ENOENT where the symlink didn't already exist
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }

  fs.symlinkSync(
    path.join('..', '..', 'bootstrap', 'packages', 'core', 'register'),
    linkDest
  );

  cb();
});

exports.bootstrap = gulp.series(
  bootstrapClean,
  bootstrapBuild,
  bootstrapYarn,
  bootstrapLink
);
exports.default = exports.bootstrap;

exports['bootstrap:watch'] = gulp.series(exports.bootstrap, function watch() {
  gulp.watch('packages/*/*/src/**', bootstrapBuildOnly);
});

let build = (exports.build = async function build() {
  const Parcel = require('./bootstrap/packages/core/core').default;
  let source = path.resolve(
    './packages/core/core',
    require('./packages/core/core/package.json').source
  );

  let defaultConfigPackage = './bootstrap/packages/configs/default';
  let defaultConfig = {
    ...require(defaultConfigPackage),
    filePath: require.resolve(defaultConfigPackage)
  };

  console.log('source', source);
  let parcel = new Parcel({
    entries: [source],
    logLevel: 'verbose',
    defaultConfig
  });

  await parcel.run();

  // console.log('YO PARCEL', Parcel);
});

function renameStream(fn) {
  return new TapStream(vinyl => {
    let relative = path.relative(vinyl.base, vinyl.path);
    vinyl.path = path.join(vinyl.base, fn(relative));
  });
}

/*
 * "Taps" into the contents of a flowing stream, yielding chunks to the passed
 * callback. Continues to pass data chunks down the stream.
 */
class TapStream extends Transform {
  constructor(tap, options) {
    super({...options, objectMode: true});
    this._tap = tap;
  }

  _transform(chunk, encoding, callback) {
    try {
      this._tap(chunk);
      callback(null, chunk);
    } catch (err) {
      callback(err);
    }
  }
}
