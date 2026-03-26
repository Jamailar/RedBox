#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const rootDir = path.resolve(__dirname, '..');
const runtimeDir = path.join(rootDir, '.private-runtime');
const privateEntry = path.join(rootDir, 'private', 'electron', 'registerOfficialFeatures.ts');

const filesToCompile = [
  ['electron/officialFeatureBridge.ts', '.private-runtime/electron/officialFeatureBridge.js'],
  ['electron/core/urlUtils.ts', '.private-runtime/electron/core/urlUtils.js'],
  ['private/electron/redboxAuthService.ts', '.private-runtime/private/electron/redboxAuthService.js'],
  ['private/electron/registerOfficialFeatures.ts', '.private-runtime/private/electron/registerOfficialFeatures.js'],
];

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
};

const cleanupRuntimeDir = () => {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
};

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const compileFile = (sourceRelativePath, targetRelativePath) => {
  const sourcePath = path.join(rootDir, sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing private runtime source: ${sourcePath}`);
  }

  const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions,
    fileName: sourcePath,
    reportDiagnostics: true,
  });

  if (result.diagnostics?.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
      getCanonicalFileName: (value) => value,
      getCurrentDirectory: () => rootDir,
      getNewLine: () => '\n',
    }));
  }

  const targetPath = path.join(rootDir, targetRelativePath);
  ensureParentDir(targetPath);
  fs.writeFileSync(targetPath, result.outputText, 'utf8');
};

if (!fs.existsSync(privateEntry)) {
  cleanupRuntimeDir();
  console.log('[prepare-private-runtime] private feature entry not found, skipped');
  process.exit(0);
}

cleanupRuntimeDir();
for (const [sourceRelativePath, targetRelativePath] of filesToCompile) {
  compileFile(sourceRelativePath, targetRelativePath);
}

console.log('[prepare-private-runtime] generated runtime modules');
