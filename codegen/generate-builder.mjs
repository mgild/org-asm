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
            const fMatch = part.trim().match(/^(\w+)\s*:\s*([^;=]+?)(?:\s*=\s*([^;]+?))?\s*$/);
            if (fMatch) fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim(), defaultValue: fMatch[3] ? fMatch[3].trim() : null });
          }
        }
        i++;
      } else {
        i++;
        while (i < lines.length) {
          const sLine = lines[i].trim();
          if (sLine.startsWith('}')) { i++; break; }
          const fMatch = sLine.match(/^(\w+)\s*:\s*([^;=]+?)(?:\s*=\s*([^;]+?))?\s*;?\s*$/);
          if (fMatch) {
            fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim(), defaultValue: fMatch[3] ? fMatch[3].trim() : null });
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
            const fMatch = part.trim().match(/^(\w+)\s*:\s*([^;=]+?)(?:\s*=\s*([^;]+?))?\s*$/);
            if (fMatch) fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim(), defaultValue: fMatch[3] ? fMatch[3].trim() : null });
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
          const fMatch = tLine.match(/^(\w+)\s*:\s*([^;=]+?)(?:\s*=\s*([^;]+?))?\s*;?\s*$/);
          if (fMatch) {
            fields.push({ name: fMatch[1].trim(), type: fMatch[2].trim(), defaultValue: fMatch[3] ? fMatch[3].trim() : null });
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

  // ── Generate table helper classes ────────────────────────────────────────

  const helperClasses = [];
  const propDecls = [];

  for (const table of tables) {
    const propName = toCamelCase(table.name);
    const helperName = `${table.name}$`;
    const methods = [];

    // start — returns this for chaining
    methods.push(`  start(): ${helperName} { ${table.name}.start${table.name}(this.fb); return this; }`);

    // fields
    for (const field of table.fields) {
      const methodName = snakeToCamel(field.name);
      const addMethodName = `add${methodName[0].toUpperCase()}${methodName.slice(1)}`;

      if (unionNames.has(field.type)) {
        // Union field → generate Type + value methods
        methods.push(`  ${addMethodName}Type(${methodName}Type: ${field.type}): ${helperName} { ${table.name}.${addMethodName}Type(this.fb, ${methodName}Type); return this; }`);
        methods.push(`  ${addMethodName}(${methodName}: flatbuffers.Offset): ${helperName} { ${table.name}.${addMethodName}(this.fb, ${methodName}); return this; }`);
      } else {
        const tsType = resolveFieldType(field.type);
        if (tsType) {
          methods.push(`  ${addMethodName}(${methodName}: ${tsType}): ${helperName} { ${table.name}.${addMethodName}(this.fb, ${methodName}); return this; }`);
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

        methods.push(`  ${createMethodName}(data: ${arrayType}): flatbuffers.Offset { return ${table.name}.${createMethodName}(this.fb, data); }`);
      }
    }

    // end — returns offset (breaks the chain)
    methods.push(`  end(): flatbuffers.Offset { return ${table.name}.end${table.name}(this.fb); }`);

    helperClasses.push(`class ${helperName} {\n  constructor(private readonly fb: flatbuffers.Builder) {}\n${methods.join('\n')}\n}`);
    propDecls.push(`  readonly ${propName}: ${helperName};`);
  }

  // ── Constructor ──────────────────────────────────────────────────────────

  const ctorAssigns = tables.map((t) => `    this.${toCamelCase(t.name)} = new ${t.name}$(this.fb);`);
  const ctorBlock = [
    '  constructor(initialCapacity?: number) {',
    '    super(initialCapacity);',
    ...ctorAssigns,
    '  }',
  ];

  // ── Assemble ─────────────────────────────────────────────────────────────

  const output = [
    imports.join('\n'),
    '',
    ...helperClasses.map((c) => c + '\n'),
    `export class ${className} extends CommandBuilder {`,
    ...propDecls,
    '',
    ...ctorBlock,
    '}',
    '',
  ];

  return output.join('\n');
}

// ─── Sender Detection ─────────────────────────────────────────────────────

/**
 * Returns true when the schema has a root_type whose table contains a union field.
 * Only such schemas get sender + hook generation.
 *
 * @param {ReturnType<typeof parseFbs>} schema
 * @returns {boolean}
 */
export function canGenerateSender(schema) {
  if (!schema.rootType) return false;
  const rootTable = schema.tables.find((t) => t.name === schema.rootType);
  if (!rootTable) return false;
  const unionNames = new Set(schema.unions.map((u) => u.name));
  return rootTable.fields.some((f) => unionNames.has(f.type));
}

// ─── Sender Generator ─────────────────────────────────────────────────────

/**
 * Generate TypeScript source for a CommandSender subclass with typed methods.
 *
 * @param {ReturnType<typeof parseFbs>} schema
 * @param {{ senderClassName?: string, builderClassName?: string, frameworkImport?: string }} options
 * @returns {string}
 */
export function generateSender(schema, options = {}) {
  const { namespace, tables, unions, enums } = schema;
  const senderClassName = options.senderClassName || 'GeneratedSender';
  const builderClassName = options.builderClassName || 'GeneratedBuilder';
  const frameworkImport = options.frameworkImport || 'org-asm/controller';

  const nsPath = namespace ? namespaceToPath(namespace) : '';

  const unionNames = new Set(unions.map((u) => u.name));
  const tableMap = new Map(tables.map((t) => [t.name, t]));

  // Find the root table and its union field
  const rootTable = tableMap.get(schema.rootType);
  const unionField = rootTable.fields.find((f) => unionNames.has(f.type));
  const union = unions.find((u) => u.name === unionField.type);

  // ── Imports ──────────────────────────────────────────────────────────────

  const lines = [
    `/** Auto-generated by org-asm gen-builder — do not edit. */`,
    `import { CommandSender } from '${frameworkImport}';`,
    `import type { WebSocketPipeline } from '${frameworkImport}';`,
    `import { ${builderClassName} } from './${builderClassName}';`,
  ];

  // Import the union enum
  const unionImportPath = nsPath ? `./${nsPath}/${toKebabCase(union.name)}` : `./${toKebabCase(union.name)}`;
  lines.push(`import { ${union.name} } from '${unionImportPath}';`);

  lines.push('');

  // ── Sender-level type resolver ───────────────────────────────────────────

  const enumNames = new Set(enums.map((e) => e.name));

  function senderFieldType(fbsType) {
    if (SCALAR_TYPES.has(fbsType)) return SCALAR_TYPES.get(fbsType);
    if (fbsType === 'string') return 'string';
    if (fbsType.startsWith('[') && fbsType.endsWith(']')) {
      const inner = fbsType.slice(1, -1);
      if (SCALAR_TYPES.has(inner)) return `${SCALAR_TYPES.get(inner)}[]`;
      return 'string[]'; // fallback
    }
    if (enumNames.has(fbsType)) return fbsType;
    return 'number'; // fallback for refs
  }

  // ── Interface for each union member ──────────────────────────────────────

  const methodBodies = [];

  for (const memberName of union.members) {
    const memberTable = tableMap.get(memberName);
    if (!memberTable) continue;

    const methodName = toCamelCase(memberName);
    const memberPropName = toCamelCase(memberName);
    const rootPropName = toCamelCase(rootTable.name);

    // Filter out fields that are the union field itself or 'id' on the root table
    const fields = memberTable.fields;
    const hasFields = fields.length > 0;

    // Build arg type
    const argParts = [];
    for (const field of fields) {
      const camelName = snakeToCamel(field.name);
      const tsType = senderFieldType(field.type);
      const optional = field.defaultValue !== null;
      argParts.push(`${camelName}${optional ? '?' : ''}: ${tsType}`);
    }

    const argsParam = hasFields ? `args: { ${argParts.join('; ')} }` : '';

    // Build method body
    const bodyLines = [];
    bodyLines.push(`    return this.send(b => {`);

    // Pre-create string/vector offsets BEFORE start()
    const preCreates = [];
    for (const field of fields) {
      const camelName = snakeToCamel(field.name);
      if (field.type === 'string') {
        const valExpr = field.defaultValue !== null
          ? `args.${camelName} ?? ${JSON.stringify(field.defaultValue)}`
          : `args.${camelName}`;
        preCreates.push(`      const _${camelName} = b.createString(${valExpr});`);
      } else if (field.type.startsWith('[') && field.type.endsWith(']')) {
        const inner = field.type.slice(1, -1);
        const valExpr = field.defaultValue !== null
          ? `args.${camelName} ?? ${field.defaultValue}`
          : `args.${camelName}`;
        if (SCALAR_TYPES.has(inner)) {
          // Scalar vector — use typed array
          const tsInner = SCALAR_TYPES.get(inner);
          preCreates.push(`      const _${camelName} = b.${memberPropName}.create${camelName[0].toUpperCase() + camelName.slice(1)}Vector(${valExpr});`);
        } else {
          preCreates.push(`      const _${camelName} = b.${memberPropName}.create${camelName[0].toUpperCase() + camelName.slice(1)}Vector(${valExpr});`);
        }
      }
    }

    if (preCreates.length > 0) {
      bodyLines.push(...preCreates);
    }

    // Build the member table
    bodyLines.push(`      const _offset = b.${memberPropName}.start()`);
    for (const field of fields) {
      const camelName = snakeToCamel(field.name);
      const addMethodName = `add${camelName[0].toUpperCase()}${camelName.slice(1)}`;

      if (field.type === 'string' || (field.type.startsWith('[') && field.type.endsWith(']'))) {
        // Use pre-created offset
        bodyLines.push(`        .${addMethodName}(_${camelName})`);
      } else {
        // Scalar/enum — pass directly
        const valExpr = field.defaultValue !== null
          ? `args.${camelName} ?? ${field.defaultValue}`
          : `args.${camelName}`;
        bodyLines.push(`        .${addMethodName}(${valExpr})`);
      }
    }
    bodyLines.push(`        .end();`);

    // Build the root table
    bodyLines.push(`      return b.${rootPropName}.start()`);
    for (const rootField of rootTable.fields) {
      const rootCamelName = snakeToCamel(rootField.name);
      const rootAddMethod = `add${rootCamelName[0].toUpperCase()}${rootCamelName.slice(1)}`;

      if (rootField.name === 'id') {
        bodyLines.push(`        .${rootAddMethod}(b.id)`);
      } else if (unionNames.has(rootField.type)) {
        // Union field — add type + value
        bodyLines.push(`        .${rootAddMethod}Type(${union.name}.${memberName})`);
        bodyLines.push(`        .${rootAddMethod}(_offset)`);
      } else {
        // Other root fields — skip (they're set by the sender pattern)
      }
    }
    bodyLines.push(`        .end();`);
    bodyLines.push(`    });`);

    methodBodies.push(`  ${methodName}(${argsParam}): bigint {\n${bodyLines.join('\n')}\n  }`);
  }

  // ── Class ────────────────────────────────────────────────────────────────

  lines.push(`export class ${senderClassName} extends CommandSender<${builderClassName}> {`);
  lines.push(`  constructor(pipeline: WebSocketPipeline) {`);
  lines.push(`    super(pipeline, new ${builderClassName}());`);
  lines.push(`  }`);
  lines.push('');
  lines.push(methodBodies.join('\n\n'));
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ─── Hook Generator ───────────────────────────────────────────────────────

/**
 * Generate a React hook that creates a sender from a pipeline.
 *
 * @param {ReturnType<typeof parseFbs>} schema
 * @param {{ hookName?: string, senderClassName?: string, frameworkImport?: string }} options
 * @returns {string}
 */
export function generateHook(schema, options = {}) {
  const hookName = options.hookName || 'useGeneratedSender';
  const senderClassName = options.senderClassName || 'GeneratedSender';
  const frameworkImport = options.frameworkImport || 'org-asm/controller';

  const lines = [
    `/** Auto-generated by org-asm gen-builder — do not edit. */`,
    `import { useRef } from 'react';`,
    `import type { WebSocketPipeline } from '${frameworkImport}';`,
    `import { ${senderClassName} } from './${senderClassName}';`,
    '',
    `export function ${hookName}(pipeline: WebSocketPipeline | null): ${senderClassName} | null {`,
    `  const ref = useRef<${senderClassName} | null>(null);`,
    `  if (pipeline && !ref.current) {`,
    `    ref.current = new ${senderClassName}(pipeline);`,
    `  }`,
    `  if (!pipeline) { ref.current = null; }`,
    `  return ref.current;`,
    `}`,
    '',
  ];

  return lines.join('\n');
}
