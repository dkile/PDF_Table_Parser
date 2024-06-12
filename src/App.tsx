import ky from "ky";
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from "pdfjs-dist";
import {
  PDFPageProxy,
  TextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";
import { useRef, useState } from "react";

GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";

const PROD_SERVER_ORIGIN = "http://localhost:3000";
const DEV_SERVER_ORIGIN = "";

const origin = import.meta.env.DEV ? DEV_SERVER_ORIGIN : PROD_SERVER_ORIGIN;

const apiEndpoint = `${origin}/api`;

const api = ky.create({
  prefixUrl: apiEndpoint,
});

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

const isTextItem = (txt: TextItem | TextMarkedContent): txt is TextItem => {
  return "str" in txt;
};

const getPageHorizontalCenter = (page: PDFPageProxy) => {
  const viewport = page.getViewport({ scale: 1 });

  return viewport.width / 2;
};

const parseComparingTable = async (document: PDFDocumentProxy) => {
  const pagesPromises = Array.from(
    { length: document.numPages },
    (_v, i) => i + 1
  ).map((pageNum) => document.getPage(pageNum));
  const pages = await Promise.all(pagesPromises);
  const pageTextContentList = await Promise.all(
    pages.map((page) => page.getTextContent())
  );

  const pageTextItemsList = pageTextContentList.map((tc) =>
    tc.items
      .filter(isTextItem)
      .filter((item) => item.width !== 0 && !item.str.match(/- \d -/))
  );

  let tableHeadIndex = -1;
  const tableTextItemsPerPage: TextItem[][] = [];

  for (const textItems of pageTextItemsList) {
    if (tableHeadIndex !== -1) {
      tableTextItemsPerPage.push(textItems);
      continue;
    }
    tableHeadIndex = textItems.findIndex((item) =>
      item.str.includes("신·구조문대비표")
    );
    if (tableHeadIndex !== -1) {
      tableTextItemsPerPage.push(textItems.slice(tableHeadIndex + 1));
    }
  }

  const horizontalCenter = getPageHorizontalCenter(pages[0]);

  const comparedTableTextItemsPerPage = tableTextItemsPerPage.map(
    (textItems) => {
      const previous = textItems.filter(
        (item) => item.transform[4] < horizontalCenter
      );
      const modified = textItems.filter(
        (item) => item.transform[4] > horizontalCenter
      );

      return { previous, modified };
    }
  );

  const comparedTableRowsPerPage = comparedTableTextItemsPerPage.map(
    ({ previous, modified }) => {
      const prevColMap = new Map<number, string[]>();
      for (const item of previous) {
        const posY = Number((item.transform[5] as number).toFixed(2));
        if (prevColMap.has(posY)) {
          prevColMap.set(posY, [...prevColMap.get(posY)!, item.str]);
        } else {
          prevColMap.set(posY, [item.str]);
        }
      }

      const prevRows = new Map<number, string>();
      for (const posY of prevColMap.keys()) {
        prevRows.set(posY, prevColMap.get(posY)!.join(""));
      }

      const modifiedColMap = new Map<number, string[]>();
      for (const item of modified) {
        const posY = Number((item.transform[5] as number).toFixed(2));
        if (modifiedColMap.has(posY)) {
          modifiedColMap.set(posY, [...modifiedColMap.get(posY)!, item.str]);
        } else {
          modifiedColMap.set(posY, [item.str]);
        }
      }

      const modifiedRows = new Map<number, string>();
      for (const posY of modifiedColMap.keys()) {
        modifiedRows.set(posY, modifiedColMap.get(posY)!.join(""));
      }

      const posYs = Array.from(
        new Set([...prevRows.keys(), ...modifiedRows.keys()])
      ).sort((a, b) => b - a);
      const rows: [string, string][] = [];

      for (const posY of posYs) {
        const prev = prevRows.get(posY) ?? "";
        const modified = modifiedRows.get(posY) ?? "";

        rows.push([prev, modified]);
      }

      return rows;
    }
  );

  return comparedTableRowsPerPage;
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
      const table = await parseComparingTable(pdf);
      setPageTableContent(table);
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
