for (var X = 123, i = 0; i < 1; ++i) {}

if(true){
  var Arr = Uint8Array;
}

function test() {
  return Arr.from([1, 2, X]);
}

exports.test = test
