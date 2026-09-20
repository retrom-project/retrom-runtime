import ts from "typescript";
function literal(node, resolve) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left, resolve), right = literal(node.right, resolve);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isIdentifier(node)) {
    const values = resolve(node, true);
    return values.length === 1 ? values[0] : null;
  }
  return null;
}
export function boundaryResolver(source) {
  const host = {getSourceFile: name => name === source.fileName ? source : undefined,
    getDefaultLibFileName: () => "", writeFile() {}, getCurrentDirectory: () => "",
    getDirectories: () => [], fileExists: name => name === source.fileName,
    readFile: () => undefined, getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n"};
  const checker = ts.createProgram([source.fileName], {noLib: true, noResolve: true, allowJs: true}, host).getTypeChecker();
  const resolve = (node, strings = false, seen = new Set()) => {
    if (!node) return [];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return resolve(node.expression, strings, seen);
    if (ts.isStringLiteralLike(node)) return strings ? [node.text] : [];
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol && !seen.has(symbol)) {
        const next = new Set(seen).add(symbol);
        const values = (symbol.declarations ?? []).flatMap(declaration => {
          if (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) return resolve(declaration.initializer, strings, next);
          if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
            const base = resolve(declaration.parent.parent.initializer, false, next);
            const key = declaration.propertyName ?? declaration.name;
            const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null;
            return name ? base.map(value => value + "." + name) : [];
          }
          return [];
        });
        if (values.length) return [...new Set(values)];
      }
      return strings ? [] : [node.text];
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text :
        literal(node.argumentExpression, (value, mode) => resolve(value, mode, seen));
      return name === null ? [] : resolve(node.expression, false, seen).map(base => base + "." + name);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "bind") {
      return resolve(node.expression.expression, strings, seen);
    }
    return [];
  };
  return node => resolve(node);
}
