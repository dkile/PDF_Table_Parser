import ky from "ky";
import {
  getDocument,
  GlobalWorkerOptions,
  PDFDocumentProxy,
  OPS,
} from "pdfjs-dist";
import { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { useRef, useState } from "react";

GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";

const PROD_SERVER_ORIGIN = "http://localhost:3000";
const DEV_SERVER_ORIGIN = "";

const origin = import.meta.env.DEV ? DEV_SERVER_ORIGIN : PROD_SERVER_ORIGIN;

const apiEndpoint = `${origin}/api`;

const api = ky.create({
  prefixUrl: apiEndpoint,
});

const ops = new Map();
for (const op in OPS) {
  ops.set((OPS as Record<string, number>)[op], op);
}

const postPDFUpload = async (body: FormData) => {
  try {
    const res = await api
      .post("v1/upload", {
        body: body,
      })
      .json<{ filename: string }>();

    return res;
  } catch (err) {
    console.error(err);
    return { filename: null };
  }
};

type Line = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const extractTable = async (page: PDFPageProxy) => {
  const operatorList = await page.getOperatorList();
  const lines: Line[] = [];
  let currentLineWidth: number | null = null;

  operatorList.fnArray.forEach((fnId, i) => {
    const args = operatorList.argsArray[i];

    if (fnId === OPS.constructPath) {
      const pathOps: number[] = args[0];
      const pathArgs: number[] = args[1];
      let x1: number | undefined,
        y1: number | undefined,
        x2: number,
        y2: number;

      let pathIndex = 0;
      pathOps.forEach((op) => {
        if (op === OPS.moveTo) {
          x1 = pathArgs[pathIndex++];
          y1 = pathArgs[pathIndex++];
        } else if (op === OPS.lineTo && x1 !== undefined && y1 !== undefined) {
          x2 = pathArgs[pathIndex++];
          y2 = pathArgs[pathIndex++];
          const x = Math.min(x1, x2);
          const y = Math.max(y1, y2);
          const width = Math.abs(x2 - x1);
          const height = Math.abs(y2 - y1);

          if (currentLineWidth !== null && currentLineWidth > 0) {
            lines.push({ x, y, width, height });
          }
          x1 = x2;
          y1 = y2;
        } else {
          if (op === OPS.curveTo) {
            pathIndex += 6;
          } else if (op === OPS.curveTo2) {
            pathIndex += 4;
          } else if (op === OPS.curveTo3) {
            pathIndex += 4;
          } else if (op === OPS.closePath) {
            // closePath has no arguments
          }
        }
      });
    } else if (fnId === OPS.setLineWidth) {
      currentLineWidth = args[0];
    }
  });

  const uniqueLines: Line[] = [];
  lines.forEach((line) => {
    if (!uniqueLines.some((uniqueLine) => areLinesEqual(uniqueLine, line))) {
      uniqueLines.push(line);
    }
  });

  const horizontalMergedLines = mergeHorizontalLines(uniqueLines);
  const verticalMergedLines = mergeVerticalLines(uniqueLines);

  const cells = generateCells(verticalMergedLines, horizontalMergedLines);

  return cells;
};

const areLinesEqual = (line1: Line, line2: Line): boolean => {
  const throttle = 2;

  return (
    Math.abs(line1.x - line2.x) <= throttle &&
    Math.abs(line1.y - line2.y) <= throttle &&
    Math.abs(line1.width - line2.width) <= throttle &&
    Math.abs(line1.height - line2.height) <= throttle
  );
};

const mergeHorizontalLines = (lines: Line[]): Line[] => {
  const horizontalLines = lines.filter((line) => line.height === 0);
  const mergedLines: Line[] = [];
  const throttle = 2;

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

const mergeVerticalLines = (lines: Line[]): Line[] => {
  const verticalLines = lines.filter((line) => line.width === 0);
  const mergedLines: Line[] = [];
  const throttle = 2;

  verticalLines.sort((a, b) => a.x - b.x || b.y - a.y);

  let mLine: Line = {
    x: verticalLines[0].x,
    y: verticalLines[0].y,
    width: 0,
    height: verticalLines[0].height,
  };
  for (const line of verticalLines) {
    const isSameX = Math.abs(line.x - mLine.x) < throttle;
    const isBetween =
      line.y >= mLine.y - mLine.height - throttle &&
      line.y <= mLine.y + throttle;

    if (isSameX && isBetween) {
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

type Point = {
  x: number;
  y: number;
};

type Cell = Point & {
  width: number;
  height: number;
};

const generateCells = (
  verticalLines: Line[],
  horizontalLines: Line[]
): Cell[] => {
  const cells: Cell[] = [];

  const bottomY = Math.min(
    ...verticalLines.map((line) => line.y - line.height)
  );
  const [mostBottomLine] = horizontalLines.filter(
    (line) => Math.abs(line.y - bottomY) < 1
  );
  if (!mostBottomLine) {
    const bottomVerticalLines = verticalLines.filter(
      (line) => Math.abs(bottomY - (line.y - line.height)) < 1
    );
    bottomVerticalLines.sort((a, b) => a.x - b.x);
    const left = bottomVerticalLines[0];
    const right = bottomVerticalLines[bottomVerticalLines.length - 1];

    const newBottomLine: Line = {
      x: left.x,
      y: bottomY,
      width: right.x - left.x,
      height: 0,
    };
    horizontalLines.push(newBottomLine);
  }

  const topY = Math.max(...horizontalLines.map((line) => line.y));
  const [mostTopLine] = horizontalLines.filter(
    (line) => Math.abs(line.y - topY) < 1
  );
  if (!mostTopLine) {
    const topVerticalLines = verticalLines.filter(
      (line) => Math.abs(topY - line.y) < 1
    );
    topVerticalLines.sort((a, b) => a.x - b.x);
    const left = topVerticalLines[0];
    const right = topVerticalLines[topVerticalLines.length - 1];

    const newTopLine: Line = {
      x: left.x,
      y: topY,
      width: right.x - left.x,
      height: 0,
    };
    horizontalLines.push(newTopLine);
  }

  const { filteredHorizontalLines, filteredVerticalLines } =
    filterLinesWithTwoOrMoreIntersections(verticalLines, horizontalLines);

  filteredVerticalLines.sort((a, b) => b.y - a.y || a.x - b.x);
  filteredHorizontalLines.sort((a, b) => b.y - a.y || a.x - b.x);

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
    Math.min(x, xEnd) - 1 <= px &&
    px <= Math.max(x, xEnd) + 1 &&
    Math.min(y, yEnd) - 1 <= py &&
    py <= Math.max(y, yEnd) + 1
  );
};

const renderPage = async (
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

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pdf, setPDF] = useState<PDFDocumentProxy | null>(null);
  const [pageTableContent, setPageTableContent] = useState<
    [string, string][][]
  >([]);

  const handleChagneFile = async (file: File | null) => {
    if (!file) return;

    const formData = new FormData();
    formData.append("pdf", file);
    const { filename } = await postPDFUpload(formData);
    if (filename) {
      const pdfURL = `${origin}/uploads/${filename}`;
      const pdf = await getDocument(pdfURL).promise;
      setPDF(pdf);
      if (canvasRef.current) renderPage(pdf, pageNum, canvasRef.current);
      const pages = await Promise.all(
        [...Array.from({ length: pdf.numPages }, (_v, i) => i + 1)].map(
          (pageNum) => pdf.getPage(pageNum)
        )
      );
      const tables = await Promise.all(pages.map((page) => extractTable(page)));
      console.log(tables);
    }
  };

  const handleClickNext = () => {
    if (!pdf) return;
    const limit = pdf.numPages;
    const nextPageNum = pageNum + 1 <= limit ? pageNum + 1 : pageNum;

    setPageNum(nextPageNum);
    if (canvasRef.current) {
      renderPage(pdf, nextPageNum, canvasRef.current);
    }
  };

  const handleClickPrev = () => {
    if (!pdf) return;
    const prevPageNum = pageNum - 1 > 0 ? pageNum - 1 : pageNum;

    setPageNum(prevPageNum);
    if (canvasRef.current) {
      renderPage(pdf, prevPageNum, canvasRef.current);
    }
  };

  return (
    <div>
      <input
        id="pdf"
        type="file"
        onChange={(e) => handleChagneFile(e.target.files?.item(0) ?? null)}
      />
      <canvas ref={canvasRef} />
      {pdf ? (
        <div>
          <button type="button" onClick={handleClickPrev}>
            prev
          </button>
          <button type="button" onClick={handleClickNext}>
            next
          </button>
        </div>
      ) : null}
      <div>{JSON.stringify(pageTableContent)}</div>
    </div>
  );
}

export default App;
