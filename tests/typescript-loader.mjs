import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!specifier.startsWith('.') || !context.parentURL?.startsWith('file:')) throw error
    for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const url = new URL(specifier + suffix, context.parentURL)
      if (await stat(fileURLToPath(url)).then((s) => s.isFile(), () => false)) return { url: url.href, shortCircuit: true }
    }
    throw error
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    return { format: 'module', source: `export default ${await readFile(fileURLToPath(url), 'utf8')}`, shortCircuit: true }
  }
  if (!url.startsWith('file:') || !/\.tsx?(?:\?|$)/.test(url)) return nextLoad(url, context)
  const source = (await readFile(fileURLToPath(url), 'utf8')).replaceAll('import.meta.env', '({BASE_URL:"/",DEV:false,PROD:true})')
  const result = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true },
  })
  return { format: 'module', source: result.outputText, shortCircuit: true }
}
