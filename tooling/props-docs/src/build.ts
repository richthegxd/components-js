import 'regenerator-runtime/runtime';
import glob from 'glob';
import path from 'path';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as docgen from 'react-docgen-typescript';
import { ComponentDoc } from 'react-docgen-typescript';
import { mkdirp } from 'mkdirp';

type ComponentInfo = {
  def: ComponentDoc;
  displayName: string;
  fileName: string;
  exportName: string;
  importPath: string;
};

const globAsync = promisify(glob);

// const excludedPropNames = propNames.concat(['as', 'apply', 'sx', '__css', 'css']);

const rootDir = path.join(__dirname, '..', '..', '..');
const sourcePath = path.join(rootDir, 'packages');
const outputPath = path.join(__dirname, '..', 'dist', 'components');

const basePath = path.join(__dirname, '..', 'dist');

const cjsIndexFilePath = path.join(basePath, 'index.cjs.js');
const esmIndexFilePath = path.join(basePath, 'index.esm.js');
const typeFilePath = path.join(basePath, 'index.d.ts');

const tsConfigPath = path.join(sourcePath, '..', 'tsconfig.json');

export async function main() {
  const componentFiles = await findComponentFiles();
  if (componentFiles.length) {
    await mkdirp(outputPath);
  }

  log('Parsing files for component types...');
  const parsedInfo = parseInfo(componentFiles);

  log('Extracting component info...');
  const componentInfo = extractComponentInfo(parsedInfo);

  log('Writing component info files...');
  await writeComponentInfoFiles(componentInfo);

  log('Writing index files...');
  await Promise.all([
    writeIndexCJS(componentInfo),
    writeIndexESM(componentInfo),
    writeTypes(componentInfo),
  ]);

  log(`Processed ${componentInfo.length} components`);
}

if (require.main === module) {
  // run main function if called via cli
  main().catch(console.error);
}

/**
 * Find all TypeScript files which could contain component definitions
 */
async function findComponentFiles() {
  return globAsync('**/src/**/*.@(ts|tsx)', {
    cwd: sourcePath,
    ignore: ['**/core/**', '**/node_modules/**', '**/index.ts'],
  });
}

/**
 * Parse files with react-doc-gen-typescript
 */
function parseInfo(filePaths: string[]) {
  const { parse } = docgen.withCustomConfig(tsConfigPath, {
    shouldRemoveUndefinedFromOptional: true,
    propFilter: (prop, component) => {
      // const isStyledSystemProp = excludedPropNames.includes(prop.name);
      const isHTMLElementProp = prop.parent?.fileName.includes('node_modules') ?? false;
      const isHook = component.name.startsWith('use');
      const isTypeScriptNative = prop.parent?.fileName.includes('node_modules/typescript') ?? false;

      return (isHook && !isTypeScriptNative && !isHTMLElementProp) || !isHTMLElementProp;
    },
  });

  return parse(filePaths.flatMap((file) => path.join(sourcePath, file)));
}

/**
 * Extract meta data of component docs
 */
function extractComponentInfo(docs: ComponentDoc[]) {
  return docs.reduce((acc, def) => {
    if (!Object.keys(def.props || {}).length) {
      return acc;
    }

    function createUniqueName(displayName: string) {
      const existing = acc.filter(
        (prev) => String(prev.def.displayName).toLowerCase() === displayName.toLowerCase(),
      );

      if (!existing.length) {
        return displayName;
      }

      return `${displayName}${existing.length}`;
    }

    const exportName = createUniqueName(def.displayName);
    const fileName = `${exportName}.json`;

    acc.push({
      def,
      displayName: def.displayName,
      fileName,
      exportName,
      importPath: `./components/${fileName}`,
    });
    return acc;
  }, [] as ComponentInfo[]);
}

/**
 * Write component info as JSON to disk
 */
async function writeComponentInfoFiles(componentInfo: ComponentInfo[]) {
  return Promise.all(
    componentInfo.map((info) => {
      const filePath = path.join(outputPath, info.fileName);
      const content = JSON.stringify(info.def);
      return fs.writeFile(filePath, content);
    }),
  );
}

/**
 * Create and write the index file in CJS format
 */
async function writeIndexCJS(componentInfo: ComponentInfo[]) {
  const cjsExports = componentInfo.map(
    ({ displayName, importPath }) => `module.exports.${displayName} = require('${importPath}');`,
  );
  return fs.writeFile(cjsIndexFilePath, cjsExports.join('\n') + '\n');
}

/**
 * Create and write the index file in ESM format
 */
async function writeIndexESM(componentInfo: ComponentInfo[]) {
  const esmPropImports = componentInfo
    .map(({ exportName, importPath }) => `import ${exportName}Import from '${importPath}';`)
    .join('\n');

  const esmPropExports = componentInfo
    .map(({ exportName }) => `export const ${exportName} = ${exportName}Import;`)
    .join('\n');

  return fs.writeFile(
    esmIndexFilePath,
    `${esmPropImports}
${esmPropExports}\n`,
  );
}

async function writeTypes(componentInfo: ComponentInfo[]) {
  const typeExports = componentInfo
    .map(({ exportName }) => `export declare const ${exportName}: PropDoc;`)
    .join('\n');

  const baseType = `export interface Parent {
  fileName: string;
  name: string;
}

export interface Declaration {
  fileName: string;
  name: string;
}

export interface DefaultProps {
  defaultValue?: any;
  description: string | JSX.Element;
  name: string;
  parent: Parent;
  declarations: Declaration[];
  required: boolean;
  type: { name: string };
}

export interface PropDoc {
  tags: { see: string };
  filePath: string;
  description: string | JSX.Element;
  displayName: string;
  methods: any[];
  props: {
    defaultProps?: DefaultProps;
    components?: DefaultProps;
  };
}`;

  return fs.writeFile(typeFilePath, `${baseType}\n${typeExports}\n`);
}

function log(...args: unknown[]) {
  console.info(`[props-docs]`, ...args);
}
