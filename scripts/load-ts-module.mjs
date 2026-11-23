import { readFileSync } from "node:fs";
import ts from "typescript";

// Reuse the project's compiler to test pure TS modules and server-rendered UI without a second runner.
export function moduleUrl(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const resolved = outputText.replace(/from "([^"]+)"/g, (_, name) => `from ${JSON.stringify(dependencies[name] ?? import.meta.resolve(name))}`);
  return `data:text/javascript;base64,${Buffer.from(resolved).toString("base64")}`;
}
