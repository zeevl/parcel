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

const VisitorRemovePathUpdateBinding = {
  Identifier(node, scope) {
    removeBinding(node, scope);
  }
};

function removePathUpdateBinding(path) {
  (function updateScope(s) {
    if (!s) return;
    walk.simple(path.node, VisitorRemovePathUpdateBinding, s);
    updateScope(s.parent);
  })(path.scope);

  path.remove();
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

exports.getName = getName;
exports.getIdentifier = getIdentifier;
exports.getExportIdentifier = getExportIdentifier;
exports.removePathUpdateBinding = removePathUpdateBinding;
exports.removeBinding = removeBinding;
