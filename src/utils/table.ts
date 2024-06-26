import { OPS, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  TextContent,
  TextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";

type Point = {
  x: number;
  y: number;
};

type Line = Point & {
  width: number;
  height: number;
};

type Cell = Point & {
  width: number;
  height: number;
};

type OPSKey = keyof typeof OPS;

type OPSValue = (typeof OPS)[OPSKey];

const throttle = 0.5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processConstructPath = (pathArg: any[]) => {
  const ops: OPSValue[] = pathArg[0];
  const args: OPSValue[] = pathArg[1];

  let cur: Point | undefined;
  const lines: Line[] = [];
  let pathIndex = 0;
  ops.forEach((op) => {
    switch (op) {
      case OPS.moveTo: {
        cur = { x: args[pathIndex++], y: args[pathIndex++] };
        break;
      }
      case OPS.lineTo: {
        if (!cur) break;

        const to = { x: args[pathIndex++], y: args[pathIndex++] };
        const newLine: Line = {
          x: Math.min(cur.x, to.x),
          y: Math.max(cur.y, to.y),
          width: Math.abs(to.x - cur.x),
          height: Math.abs(to.y - cur.y),
        };

        lines.push(newLine);
        cur = to;
        break;
      }
      case OPS.curveTo: {
        pathIndex += 6;
        break;
      }
      case (OPS.curveTo2, OPS.curveTo3): {
        pathIndex += 4;
        break;
      }
      case OPS.closePath: {
        break;
      }
    }
  });

  return lines;
};

export const extractTable = async (page: PDFPageProxy): Promise<Cell[][]> => {
  const operatorList = await page.getOperatorList();
  const pathArgs = operatorList.fnArray
    .map((fnId, i) => ({ fnId, index: i }))
    .filter(({ fnId }) => fnId === OPS.constructPath)
    .map(({ index }) => operatorList.argsArray[index]);

  const lines = pathArgs.flatMap(processConstructPath);
  const uniqueLines = removeDuplicateLines(lines);

  const horizontalMergedLines = mergeOverlappingHorizontalLines(uniqueLines);
  const verticalMergedLines = mergeOverlappingVerticalLines(uniqueLines);

  const cells = groupCellsByRow(
    generateCells(verticalMergedLines, horizontalMergedLines)
  );

  return cells;
};

const removeDuplicateLines = (lines: Line[]) => {
  const uniqueLines: Line[] = [];

  lines
    .map((line) => ({
      x: Number(line.x.toFixed(3)),
      y: Number(line.y.toFixed(3)),
      width: Number(line.width.toFixed(3)),
      height: Number(line.height.toFixed(3)),
    }))
    .forEach((line) => {
      if (!uniqueLines.some((uniqueLine) => areLinesEqual(uniqueLine, line))) {
        uniqueLines.push(line);
      }
    });

  return uniqueLines;
};

const areLinesEqual = (line1: Line, line2: Line): boolean => {
  return (
    Math.abs(line1.x - line2.x) <= throttle &&
    Math.abs(line1.y - line2.y) <= throttle &&
    Math.abs(line1.width - line2.width) <= throttle &&
    Math.abs(line1.height - line2.height) <= throttle
  );
};

const mergeOverlappingHorizontalLines = (lines: Line[]): Line[] => {
  const horizontalLines = lines.filter((line) => line.height === 0);
  const mergedLines: Line[] = [];

  if (horizontalLines.length === 0) return [];

  horizontalLines.sort((a, b) => b.y - a.y || a.x - b.x);

  let mLine: Line = {
    x: horizontalLines[0].x,
    y: horizontalLines[0].y,
    width: horizontalLines[0].width,
    height: 0,
  };
  for (const line of horizontalLines) {
    const isSameY = Math.abs(line.y - mLine.y) < throttle;
    const isBetween =
      line.x >= mLine.x - throttle &&
      line.x <= mLine.x + mLine.width + throttle;

    if (isSameY && isBetween) {
      const newX = Math.min(line.x, mLine.x);
      const newWidth =
        Math.max(line.x + line.width, mLine.x + mLine.width) - newX;
      mLine = { x: newX, y: line.y, width: newWidth, height: 0 };
    } else {
      mergedLines.push(mLine);
      mLine = line;
    }
  }
  mergedLines.push(mLine);

  return mergedLines;
};

const mergeOverlappingVerticalLines = (lines: Line[]): Line[] => {
  const verticalLines = lines.filter((line) => line.width === 0);
  const mergedLines: Line[] = [];

  if (verticalLines.length === 0) return [];

  verticalLines.sort((a, b) => a.x - b.x || b.y - a.y);

  let mLine: Line = {
    x: verticalLines[0].x,
    y: verticalLines[0].y,
    width: 0,
    height: verticalLines[0].height,
  };
  for (const line of verticalLines) {
    const isOverlapped =
      Math.abs(line.x - mLine.x) < throttle &&
      line.y >= mLine.y - mLine.height - throttle &&
      line.y <= mLine.y + throttle;

    if (isOverlapped) {
      const newY = Math.max(line.y, mLine.y);
      const newHeight =
        newY - Math.min(line.y - line.height, mLine.y - mLine.height);
      mLine = { x: line.x, y: newY, width: 0, height: newHeight };
    } else {
      mergedLines.push(mLine);
      mLine = line;
    }
  }
  mergedLines.push(mLine);

  return mergedLines;
};

const groupCellsByRow = (cells: Cell[]): Cell[][] => {
  const rowMap: Map<number, Cell[]> = new Map();
  cells.sort((a, b) => b.y - a.y);

  cells.forEach((cell) => {
    const yKey = Math.round(cell.y / 2) * 2;
    if (!rowMap.has(yKey)) {
      rowMap.set(yKey, []);
    }
    rowMap.get(yKey)!.push(cell);
  });

  const groupedCells: Cell[][] = Array.from(rowMap.values());

  groupedCells.forEach((row) => row.sort((a, b) => a.x - b.x));

  return groupedCells;
};

const generateCells = (
  verticalLines: Line[],
  horizontalLines: Line[]
): Cell[] => {
  const cells: Cell[] = [];
  if (verticalLines.length === 0 || horizontalLines.length === 0) return [];

  const bottomY = Math.min(
    ...verticalLines.map((line) => line.y - line.height)
  );
  const bottomVerticalLines = verticalLines.filter(
    (line) => Math.abs(bottomY - (line.y - line.height)) < 1
  );
  bottomVerticalLines.sort((a, b) => a.x - b.x);
  const bottomLeft = bottomVerticalLines[0];
  const bottomRight = bottomVerticalLines[bottomVerticalLines.length - 1];

  const [mostBottomLine] = horizontalLines.filter(
    (line) =>
      Math.abs(line.y - bottomY) < 1 &&
      Math.abs(line.width - (bottomRight.x - bottomLeft.x)) < 1
  );
  if (!mostBottomLine) {
    const newBottomLine: Line = {
      x: bottomLeft.x,
      y: bottomY,
      width: bottomRight.x - bottomLeft.x,
      height: 0,
    };
    horizontalLines.push(newBottomLine);
  }

  const topY = Math.max(...verticalLines.map((line) => line.y));
  const topVerticalLines = verticalLines.filter(
    (line) => Math.abs(topY - line.y) < 1
  );
  topVerticalLines.sort((a, b) => a.x - b.x);
  const topLeft = topVerticalLines[0];
  const topRight = topVerticalLines[topVerticalLines.length - 1];

  const [mostTopLine] = horizontalLines.filter(
    (line) =>
      Math.abs(line.y - topY) < 1 &&
      Math.abs(line.width - (topRight.x - topLeft.x)) < 1
  );
  if (!mostTopLine) {
    const newTopLine: Line = {
      x: topLeft.x,
      y: topY,
      width: topRight.x - topLeft.x,
      height: 0,
    };
    horizontalLines.push(newTopLine);
  }

  const { filteredHorizontalLines, filteredVerticalLines } =
    filterLinesWithTwoOrMoreIntersections(verticalLines, horizontalLines);

  for (let i = 0; i < filteredHorizontalLines.length - 1; i++) {
    for (let j = 0; j < filteredVerticalLines.length - 1; j++) {
      const leftLine = filteredVerticalLines[j];
      const rightLine = filteredVerticalLines[j + 1];
      const topLine = filteredHorizontalLines[i];
      const bottomLine = filteredHorizontalLines[i + 1];

      const topLeft = getIntersectionPoint(leftLine, topLine);
      const topRight = getIntersectionPoint(rightLine, topLine);
      const bottomLeft = getIntersectionPoint(leftLine, bottomLine);
      const bottomRight = getIntersectionPoint(rightLine, bottomLine);

      if (topLeft && topRight && bottomLeft && bottomRight) {
        const cell: Cell = {
          x: topLeft.x,
          y: topLeft.y,
          width: topRight.x - topLeft.x,
          height: topLeft.y - bottomLeft.y,
        };
        cells.push(cell);
      }
    }
  }

  return cells;
};

const filterLinesWithTwoOrMoreIntersections = (
  verticalLines: Line[],
  horizontalLines: Line[]
): { filteredVerticalLines: Line[]; filteredHorizontalLines: Line[] } => {
  const intersectionCount = new Map<Line, number>();

  verticalLines.sort((a, b) => b.y - a.y || a.x - b.x);
  horizontalLines.sort((a, b) => b.y - a.y || a.x - b.x);

  verticalLines.forEach((vLine) => {
    horizontalLines.forEach((hLine) => {
      const intersection = getIntersectionPoint(vLine, hLine);
      if (intersection) {
        intersectionCount.set(vLine, (intersectionCount.get(vLine) || 0) + 1);
        intersectionCount.set(hLine, (intersectionCount.get(hLine) || 0) + 1);
      }
    });
  });

  const filteredVerticalLines = verticalLines.filter(
    (line) => (intersectionCount.get(line) || 0) >= 2
  );
  const filteredHorizontalLines = horizontalLines.filter(
    (line) => (intersectionCount.get(line) || 0) >= 2
  );

  return { filteredVerticalLines, filteredHorizontalLines };
};

const getIntersectionPoint = (line1: Line, line2: Line): Point | null => {
  const x1 = line1.x;
  const y1 = line1.y;
  const x2 = line1.x + line1.width;
  const y2 = line1.y - (line1.height || 0);

  const x3 = line2.x;
  const y3 = line2.y;
  const x4 = line2.x + (line2.width || 0);
  const y4 = line2.y - line2.height;

  const detL1 = det(x1, y1, x2, y2);
  const detL2 = det(x3, y3, x4, y4);
  const x1mx2 = x1 - x2;
  const x3mx4 = x3 - x4;
  const y1my2 = y1 - y2;
  const y3my4 = y3 - y4;

  const denominator = det(x1mx2, y1my2, x3mx4, y3my4);
  if (denominator === 0) {
    return null;
  }

  const xNumerator = det(detL1, x1mx2, detL2, x3mx4);
  const yNumerator = det(detL1, y1my2, detL2, y3my4);
  const px = Number((xNumerator / denominator).toFixed(3));
  const py = Number((yNumerator / denominator).toFixed(3));

  if (
    isPointOnLineSegment(px, py, line1) &&
    isPointOnLineSegment(px, py, line2)
  ) {
    return { x: px, y: py };
  } else {
    return null;
  }
};

const det = (a: number, b: number, c: number, d: number): number => {
  return a * d - b * c;
};

const isPointOnLineSegment = (px: number, py: number, line: Line): boolean => {
  const { x, y, width, height } = line;
  const xEnd = x + width;
  const yEnd = y - height;

  return (
    Math.min(x, xEnd) - 0.1 <= px &&
    px <= Math.max(x, xEnd) + 0.1 &&
    Math.min(y, yEnd) - 0.1 <= py &&
    py <= Math.max(y, yEnd) + 0.1
  );
};

export const renderPage = async (
  document: PDFDocumentProxy,
  pageNum: number,
  canvas: HTMLCanvasElement
) => {
  const page = await document.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const context = canvas.getContext("2d");
  if (context) {
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };
    page.render(renderContext);
  }
};

const isTextItem = (txt: TextItem | TextMarkedContent): txt is TextItem => {
  return "str" in txt;
};

export const extractTableContent = (
  table: Cell[][],
  content: TextContent
): TextItem[][][] => {
  const textItems = content.items.filter(isTextItem);

  const contentInTable: TextItem[][][] = [];
  for (const row of table) {
    const contentInRow = [];
    for (const cell of row) {
      const contentInCell = [];
      for (const text of textItems) {
        const textPos = { x: text.transform[4], y: text.transform[5] };
        const isInCell =
          cell.x < textPos.x &&
          textPos.x < cell.x + cell.width &&
          cell.y - cell.height < textPos.y &&
          textPos.y < cell.y;

        if (isInCell) {
          contentInCell.push(text);
        }
      }
      contentInRow.push(contentInCell);
    }
    contentInTable.push(contentInRow);
  }

  return contentInTable;
};

export const joinTextInSameCell = (textItems: TextItem[]) => {
  const lineMap = new Map<number, TextItem[]>();
  for (const text of textItems) {
    const y = text.transform[5];

    lineMap.set(y, [...(lineMap.get(y) ?? []), text]);
  }
  for (const y of lineMap.keys()) {
    lineMap.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
  }
  const lines = [...lineMap]
    .map(([y, items]) => ({ y, str: items.map((text) => text.str).join("") }))
    .sort(({ y: y1 }, { y: y2 }) => y2 - y1)
    .flatMap(({ str }) => str);

  return lines.join("\n");
};

export const getPages = async (pdf: PDFDocumentProxy) => {
  const pages = await Promise.all(
    [...Array.from({ length: pdf.numPages }, (_v, i) => i + 1)].map((pageNum) =>
      pdf.getPage(pageNum)
    )
  );

  return pages;
};

export const zip = <T1, T2>(
  iter1: Array<T1>,
  iter2: Array<T2>
): Array<[T1, T2]> => {
  const len = Math.min(iter1.length, iter2.length);
  const zipped: Array<[T1, T2]> = [];

  for (let i = 0; i < len; i++) {
    zipped.push([iter1[i], iter2[i]]);
  }

  return zipped;
};
