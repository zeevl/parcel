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

function removeBinding(node, scope) {
  const binding = scope.getBinding(node.name);
  if (binding) {
    binding.referencePaths = binding.referencePaths.filter(p => {
      if (p.node === node) {
        binding.dereference();
        return false;
      } else {
        return true;
      }
    });
  }
}

const VisitorRemovePathBindingRecursive = {
  Identifier(node, scope) {
    removeBinding(node, scope);
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
exports.removeBinding = removeBinding;
