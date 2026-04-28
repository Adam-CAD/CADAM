/**
 * Wraps OpenSCAD code in a generated module, then projects that module from
 * above. Library imports stay global because OpenSCAD does not allow use/include
 * directives inside module bodies.
 * @param code The OpenSCAD source code to project for DXF export
 * @returns OpenSCAD code wrapped in a top-down projection
 */
export function createDXFProjectionCode(code: string): string {
  const { imports, body } = extractTopLevelLibraryImports(code);
  const importBlock = imports.join('\n');
  const sourceModule = `module __cadam_dxf_source__() {\n${body.trim()}\n}`;
  const projection = 'projection(cut = false) __cadam_dxf_source__();';

  return [importBlock, sourceModule, projection].filter(Boolean).join('\n\n');
}

/**
 * OpenSCAD currently emits LWPOLYLINE entities while declaring an older
 * AC1006 DXF version. Convert those contours to plain LINE entities, which
 * CAD importers tend to handle more consistently.
 * @param dxf Raw DXF text emitted by OpenSCAD
 * @returns DXF text normalized for broader CAD importer compatibility
 */
export function normalizeOpenSCADDxf(dxf: string): string {
  const pairs = toDxfPairs(dxf);
  const output: DxfPair[] = [];

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];

    if (pair.code === '9' && pair.value === '$ACADVER') {
      output.push(pair);
      if (pairs[index + 1]?.code === '1') {
        output.push({ code: '1', value: 'AC1009' });
        index += 1;
      }
      continue;
    }

    if (pair.code === '0' && pair.value === 'LWPOLYLINE') {
      const converted = convertLightweightPolylineToLines(pairs, index);
      output.push(...converted.pairs);
      index = converted.nextIndex - 1;
      continue;
    }

    output.push(pair);
  }

  return fromDxfPairs(output);
}

type DxfPair = {
  code: string;
  value: string;
};

/**
 * Parses DXF text into code/value pairs.
 * @param dxf DXF text to parse
 * @returns DXF group-code pairs
 */
function toDxfPairs(dxf: string): DxfPair[] {
  const lines = dxf.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const pairs: DxfPair[] = [];

  for (let index = 0; index < lines.length - 1; index += 2) {
    pairs.push({
      code: lines[index].trim(),
      value: lines[index + 1].trim(),
    });
  }

  return pairs;
}

/**
 * Serializes DXF code/value pairs back to DXF text.
 * @param pairs DXF group-code pairs to serialize
 * @returns DXF text with a trailing newline
 */
function fromDxfPairs(pairs: DxfPair[]): string {
  return `${pairs.map(({ code, value }) => `${code}\n${value}`).join('\n')}\n`;
}

/**
 * Converts one LWPOLYLINE entity into a set of LINE entities.
 * @param pairs Full DXF pair list
 * @param startIndex Index of the LWPOLYLINE entity marker
 * @returns Converted pairs and the index where the next entity starts
 */
function convertLightweightPolylineToLines(
  pairs: DxfPair[],
  startIndex: number,
): { pairs: DxfPair[]; nextIndex: number } {
  let layer = '0';
  let closed = false;
  let pendingX: string | null = null;
  const vertices: Array<{ x: string; y: string }> = [];
  let nextIndex = pairs.length;

  for (let index = startIndex + 1; index < pairs.length; index += 1) {
    const pair = pairs[index];

    if (pair.code === '0') {
      nextIndex = index;
      break;
    }

    if (pair.code === '8') layer = pair.value;
    if (pair.code === '70') closed = (Number(pair.value) & 1) === 1;
    if (pair.code === '10') pendingX = pair.value;
    if (pair.code === '20' && pendingX !== null) {
      vertices.push({ x: pendingX, y: pair.value });
      pendingX = null;
    }
  }

  const converted: DxfPair[] = [];
  const segmentCount = closed ? vertices.length : vertices.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];

    converted.push(
      { code: '0', value: 'LINE' },
      { code: '8', value: layer },
      { code: '10', value: start.x },
      { code: '20', value: start.y },
      { code: '30', value: '0.0' },
      { code: '11', value: end.x },
      { code: '21', value: end.y },
      { code: '31', value: '0.0' },
    );
  }

  return { pairs: converted, nextIndex };
}

/**
 * Separates top-level OpenSCAD library directives from projectable body code.
 * Uses a line-aligned comment-stripped scan so import detection ignores `use<>`
 * tokens that appear inside line or block comments while preserving the original
 * source verbatim in the returned body.
 * @param source OpenSCAD source code
 * @returns Global imports and the remaining source body
 */
function extractTopLevelLibraryImports(source: string): {
  imports: string[];
  body: string;
} {
  const normalizedSource = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sourceLines = normalizedSource.split('\n');
  const scanLines = normalizedSource
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n]*/g, '')
    .split('\n');

  const importRegex = /^[ \t]*(?:use|include)\s*<[^>]+>\s*;?\s*$/;
  const imports: string[] = [];
  const body: string[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    if (importRegex.test(scanLines[index])) {
      imports.push(sourceLines[index].trim());
    } else {
      body.push(sourceLines[index]);
    }
  }

  return { imports, body: body.join('\n') };
}
