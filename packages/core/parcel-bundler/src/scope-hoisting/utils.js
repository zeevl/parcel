const t = require('@babel/types');
const walk = require('babylon-walk');

function getName(asset, type, ...rest) {
  return (
    '$' +
    t.toIdentifier(asset.id) +
    '$' +
    type +
    (rest.length
      ? '$' +
        rest
          .map(name => (name === 'default' ? name : t.toIdentifier(name)))
          .join('$')
      : '')
  );
}

function getIdentifier(asset, type, ...rest) {
  return t.identifier(getName(asset, type, ...rest));
}

function getExportIdentifier(asset, name) {
  return getIdentifier(asset, 'export', name);
}

function removeReference(node, scope) {
  let binding = scope.getBinding(node.name);
  if (binding) {
    let i = binding.referencePaths.findIndex(v => v.node === node);
    if (i >= 0) {
      binding.dereference();
      binding.referencePaths.splice(i, 1);
    }
  }
}

const VisitorRemovePathBindingRecursive = {
  Identifier(node, scope) {
    removeReference(node, scope);
  }
};

function removePathBindingRecursive(path, scope) {
  walk.simple(path.node, VisitorRemovePathBindingRecursive, scope);
  path.remove();
}

exports.getName = getName;
exports.getIdentifier = getIdentifier;
exports.getExportIdentifier = getExportIdentifier;
exports.removePathBindingRecursive = removePathBindingRecursive;
exports.removeReference = removeReference;
