/**
 * gen-builder — Auto-generate CommandBuilder subclass from .fbs schema.
 *
 * USAGE:
 *   import { parseFbs, generateBuilder } from './generate-builder.mjs';
 *   const schema = parseFbs(fbsSource);
 *   const ts = generateBuilder(schema, { className, frameworkImport });
 */

// ─── FBS Type → TS Type mapping ──────────────────────────────────────────────

const SCALAR_TYPES = new Map([
  ['bool', 'boolean'],
  ['byte', 'number'],
  ['ubyte', 'number'],
  ['short', 'number'],
  ['ushort', 'number'],
  ['int', 'number'],
  ['uint', 'number'],
  ['float', 'number'],
  ['double', 'number'],
  ['int8', 'number'],
  ['uint8', 'number'],
  ['int16', 'number'],
  ['uint16', 'number'],
  ['int32', 'number'],
  ['uint32', 'number'],
  ['float32', 'number'],
  ['float64', 'number'],
  ['long', 'bigint'],
  ['ulong', 'bigint'],
  ['int64', 'bigint'],
  ['uint64', 'bigint'],
]);

// ─── Name conversions ────────────────────────────────────────────────────────

/** PascalCase → camelCase */
function toCamelCase(name) {
  return name[0].toLowerCase() + name.slice(1);
}

/** PascalCase → kebab-case */
function toKebabCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** snake_case → camelCase */
function snakeToCamel(name) {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Namespace → kebab directory path: OrgAsm.Commands → org-asm/commands */
function namespaceToPath(ns) {
  return ns.split('.').map(toKebabCase).join('/');
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a .fbs source string into a schema object.
 *
 * @param {string} source - FlatBuffers schema source
 * @returns {{ namespace: string|null, tables: Array, unions: Array, enums: Array, structs: Array, rootType: string|null }}
 */
export function parseFbs(source) {
  const lines = source.split('\n');

  let namespace = null;
  const tables = [];
  const unions = [];
  const enums = [];
  const structs = [];
  let rootType = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip comments and empty lines
    if (line === '' || line.startsWith('//')) {
      i++;
      continue;
    }

    // Namespace
    const nsMatch = line.match(/^namespace\s+([\w.]+)\s*;/);
    if (nsMatch) {
      namespace = nsMatch[1];
      i++;
      continue;
    }

    // Root type
    const rtMatch = line.match(/^root_type\s+(\w+)\s*;/);
    if (rtMatch) {
      rootType = rtMatch[1];
      i++;
      continue;
    }

    // Union
    const unionMatch = line.match(/^union\s+(\w+)\s*\{([^}]*)\}/);
    if (unionMatch) {
      const name = unionMatch[1];
      const members = unionMatch[2].split(',').map((m) => m.trim()).filter(Boolean);
      unions.push({ name, members });
      i++;
      continue;
    }

    // Enum
    const enumMatch = line.match(/^enum\s+(\w+)\s*:\s*\w+\s*\{/);
    if (enumMatch) {
      const name = enumMatch[1];
      const members = [];
      i++;
      while (i < lines.length) {
        const eLine = lines[i].trim();
        if (eLine.startsWith('}')) { i++; break; }
        const eMatch = eLine.match(/^(\w+)/);
        if (eMatch) members.push(eMatch[1]);
        i++;
      }
      enums.push({ name, members });
      continue;
    }

    // Struct
    const structMatch = line.match(/^struct\s+(\w+)\s*\{/);
    if (structMatch) {
      const name = structMatch[1];
      const fields = [];
      // Handle single-line: struct Foo { ... } or struct Foo {}
      if (line.includes('}')) {
        const bodyMatch = line.match(/\{([^}]*)\}/);
        if (bodyMatch && bodyMatch[1].trim()) {
          for (const part of bodyMatch[1].split(';')) {
            const fMatch = part.trim().match(/^(\w+)\s*:\s*(.+)/);
            if (fMatch) fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim() });
          }
        }
        i++;
      } else {
        i++;
        while (i < lines.length) {
          const sLine = lines[i].trim();
          if (sLine.startsWith('}')) { i++; break; }
          const fMatch = sLine.match(/^(\w+)\s*:\s*([^;=]+)/);
          if (fMatch) {
            fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim() });
          }
          i++;
        }
      }
      structs.push({ name, fields });
      continue;
    }

    // Table
    const tableMatch = line.match(/^table\s+(\w+)\s*\{/);
    if (tableMatch) {
      const name = tableMatch[1];
      const fields = [];
      // Handle single-line: table Foo {} or table Foo { field: type; }
      if (line.includes('}')) {
        const bodyMatch = line.match(/\{([^}]*)\}/);
        if (bodyMatch && bodyMatch[1].trim()) {
          for (const part of bodyMatch[1].split(';')) {
            const fMatch = part.trim().match(/^(\w+)\s*:\s*(.+)/);
            if (fMatch) fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim() });
          }
        }
        i++;
      } else {
        i++;
        while (i < lines.length) {
          const tLine = lines[i].trim();
          if (tLine.startsWith('}')) { i++; break; }
          // Skip comments
          if (tLine.startsWith('//') || tLine.startsWith('///') || tLine === '') {
            i++;
            continue;
          }
          // Field: name: type = default;
          const fMatch = tLine.match(/^(\w+)\s*:\s*([^;=]+)/);
          if (fMatch) {
            fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim() });
          }
          i++;
        }
      }
      tables.push({ name, fields });
      continue;
    }

    i++;
  }

  return { namespace, tables, unions, enums, structs, rootType };
}

// ─── Code Generator ──────────────────────────────────────────────────────────

/**
 * Generate TypeScript source for a CommandBuilder subclass.
 *
 * @param {ReturnType<typeof parseFbs>} schema
 * @param {{ className?: string, frameworkImport?: string }} options
 * @returns {string}
 */
export function generateBuilder(schema, options = {}) {
  const { namespace, tables, unions, enums, structs } = schema;
  const className = options.className || 'GeneratedBuilder';
  const frameworkImport = options.frameworkImport || 'org-asm/controller';

  const nsPath = namespace ? namespaceToPath(namespace) : '';

  // Build lookup sets
  const unionNames = new Set(unions.map((u) => u.name));
  const enumNames = new Set(enums.map((e) => e.name));
  const tableNames = new Set(tables.map((t) => t.name));
  const structNames = new Set(structs.map((s) => s.name));

  // Collect all union member names (these are tables referenced by unions)
  const unionMemberSet = new Set();
  for (const u of unions) {
    for (const m of u.members) {
      unionMemberSet.add(m);
    }
  }

  // ── Imports ──────────────────────────────────────────────────────────────

  const imports = [
    `/** Auto-generated by org-asm gen-builder — do not edit. */`,
    `import * as flatbuffers from 'flatbuffers';`,
    `import { CommandBuilder } from '${frameworkImport}';`,
  ];

  // Import tables
  for (const t of tables) {
    const importPath = nsPath ? `./${nsPath}/${toKebabCase(t.name)}` : `./${toKebabCase(t.name)}`;
    imports.push(`import { ${t.name} } from '${importPath}';`);
  }

  // Import enums
  for (const e of enums) {
    const importPath = nsPath ? `./${nsPath}/${toKebabCase(e.name)}` : `./${toKebabCase(e.name)}`;
    imports.push(`import { ${e.name} } from '${importPath}';`);
  }

  // Import unions (they generate an enum with the union name)
  for (const u of unions) {
    const importPath = nsPath ? `./${nsPath}/${toKebabCase(u.name)}` : `./${toKebabCase(u.name)}`;
    imports.push(`import { ${u.name} } from '${importPath}';`);
  }

  // Import structs
  for (const s of structs) {
    const importPath = nsPath ? `./${nsPath}/${toKebabCase(s.name)}` : `./${toKebabCase(s.name)}`;
    imports.push(`import { ${s.name} } from '${importPath}';`);
  }

  // ── Resolve TS type for a field ──────────────────────────────────────────

  function resolveFieldType(fbsType) {
    // Scalar
    if (SCALAR_TYPES.has(fbsType)) {
      return SCALAR_TYPES.get(fbsType);
    }
    // Vector
    if (fbsType.startsWith('[') && fbsType.endsWith(']')) {
      return 'flatbuffers.Offset';
    }
    // String
    if (fbsType === 'string') {
      return 'flatbuffers.Offset';
    }
    // Enum
    if (enumNames.has(fbsType)) {
      return fbsType;
    }
    // Union
    if (unionNames.has(fbsType)) {
      return null; // handled specially
    }
    // Table or struct reference → offset
    if (tableNames.has(fbsType) || structNames.has(fbsType)) {
      return 'flatbuffers.Offset';
    }
    // Unknown — treat as offset
    return 'flatbuffers.Offset';
  }

  // ── Generate table objects ───────────────────────────────────────────────

  const tableBlocks = [];

  for (const table of tables) {
    const propName = toCamelCase(table.name);
    const methods = [];

    // start
    methods.push(`    start: (): void => { ${table.name}.start${table.name}(this.fb); },`);

    // fields
    for (const field of table.fields) {
      const methodName = snakeToCamel(field.name);
      const addMethodName = `add${methodName[0].toUpperCase()}${methodName.slice(1)}`;

      if (unionNames.has(field.type)) {
        // Union field → generate Type + value methods
        methods.push(`    ${addMethodName}Type: (${methodName}Type: ${field.type}): void => { ${table.name}.${addMethodName}Type(this.fb, ${methodName}Type); },`);
        methods.push(`    ${addMethodName}: (${methodName}: flatbuffers.Offset): void => { ${table.name}.${addMethodName}(this.fb, ${methodName}); },`);
      } else {
        const tsType = resolveFieldType(field.type);
        if (tsType) {
          methods.push(`    ${addMethodName}: (${methodName}: ${tsType}): void => { ${table.name}.${addMethodName}(this.fb, ${methodName}); },`);
        }
      }
    }

    // createXVector helpers for vector fields
    for (const field of table.fields) {
      if (field.type.startsWith('[') && field.type.endsWith(']')) {
        const methodName = snakeToCamel(field.name);
        const createMethodName = `create${methodName[0].toUpperCase()}${methodName.slice(1)}Vector`;
        const innerType = field.type.slice(1, -1);

        let arrayType;
        if (structNames.has(innerType) || tableNames.has(innerType)) {
          arrayType = 'flatbuffers.Offset[]';
        } else if (SCALAR_TYPES.has(innerType)) {
          arrayType = `${SCALAR_TYPES.get(innerType)}[]`;
        } else {
          arrayType = 'flatbuffers.Offset[]';
        }

        methods.push(`    ${createMethodName}: (data: ${arrayType}): flatbuffers.Offset => ${table.name}.${createMethodName}(this.fb, data),`);
      }
    }

    // end
    methods.push(`    end: (): flatbuffers.Offset => ${table.name}.end${table.name}(this.fb),`);

    tableBlocks.push(`  readonly ${propName} = {\n${methods.join('\n')}\n  };`);
  }

  // ── Assemble ─────────────────────────────────────────────────────────────

  const output = [
    imports.join('\n'),
    '',
    `export class ${className} extends CommandBuilder {`,
    tableBlocks.join('\n\n'),
    '}',
    '',
  ];

  return output.join('\n');
}
