import ky from "ky";
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from "pdfjs-dist";
import { useRef, useState } from "react";
import {
  extractTable,
  extractTableContent,
  getPages,
  joinTextInSameCell,
  renderPage,
  zip,
} from "./utils/table";

GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";

const PROD_SERVER_ORIGIN = "http://localhost:3000";
const DEV_SERVER_ORIGIN = "";

const origin = import.meta.env.DEV ? DEV_SERVER_ORIGIN : PROD_SERVER_ORIGIN;

const API_ENDPOINT = `${origin}/api`;

const api = ky.create({
  prefixUrl: API_ENDPOINT,
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

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pdf, setPDF] = useState<PDFDocumentProxy | null>(null);
  const [tableContent, setTableContent] = useState<string[][][]>([]);

  const handleChangeFile = async (file: File | null) => {
    if (!file) return;

    const formData = new FormData();
    formData.append("pdf", file);
    const { filename } = await postPDFUpload(formData);

    if (filename) {
      const pdfURL = `${origin}/uploads/${filename}`;
      const pdf = await getDocument(pdfURL).promise;
      if (canvasRef.current) renderPage(pdf, pageNum, canvasRef.current);

      const pages = await getPages(pdf);

      const tables = [];
      for (const page of pages) {
        const table = await extractTable(page);
        tables.push(table);
      }
      const contentList = await Promise.all([
        ...pages.map((page) => page.getTextContent()),
      ]);

      const contentInTables = zip(tables, contentList)
        .filter(
          ([table, content]) => table.length !== 0 && content.items.length !== 0
        )
        .map(([table, content]) => extractTableContent(table, content));

      const joinedContentInTables: string[][][] = [];

      for (const table of contentInTables) {
        const joinedTable = [];
        for (const row of table) {
          const joinedRow = row.map(joinTextInSameCell);
          joinedTable.push(joinedRow);
        }
        joinedContentInTables.push(joinedTable);
      }

      setPDF(pdf);
      setTableContent(joinedContentInTables);
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
        accept=".pdf"
        onChange={(e) => handleChangeFile(e.target.files?.item(0) ?? null)}
      />
      <canvas ref={canvasRef} />
      {pdf ? (
        <>
          <div>
            <button type="button" onClick={handleClickPrev}>
              prev
            </button>
            <button type="button" onClick={handleClickNext}>
              next
            </button>
          </div>
          <div>{JSON.stringify(tableContent)}</div>
        </>
      ) : null}
    </div>
  );
}

export default App;
