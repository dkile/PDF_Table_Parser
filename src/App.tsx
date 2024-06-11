import ky from "ky";
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from "pdfjs-dist";
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
    </div>
  );
}

export default App;
