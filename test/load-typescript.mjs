import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import ts from "typescript";

export function loadTypeScript(url, { modules = {}, globals = {} } = {}) {
  const filename = fileURLToPath(url);
  const { outputText } = ts.transpileModule(readFileSync(url, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const module = { exports: {} };
  const require = createRequire(url);
  const load = (specifier) => Object.hasOwn(modules, specifier) ? modules[specifier] : require(specifier);
  const evaluate = compileFunction(
    outputText, ["module", "exports", "require", ...Object.keys(globals)], { filename },
  );
  evaluate(module, module.exports, load, ...Object.values(globals));
  return module.exports;
}
