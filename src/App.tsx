import ky from "ky";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { useState } from "react";

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

const parsePDF = async (pdfURL: string) => {
  const doc = await getDocument(pdfURL).promise;
  const numPages = doc.numPages;

  let textContent: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const textContentPage = await page.getTextContent();
    textContent = [
      ...textContent,
      ...textContentPage.items.map((item) => ("str" in item ? item.str : "")),
    ];
  }

  return textContent;
};

function App() {
  const [content, setContent] = useState<string[]>([]);

  const onChagneFile = async (file: File | null) => {
    if (!file) return;

    const formData = new FormData();
    formData.append("pdf", file);
    const { filename } = await postPDFUpload(formData);
    if (filename) {
      const pdfURL = `${origin}/uploads/${filename}`;
      const content = await parsePDF(pdfURL);
      setContent(content);
    }
  };

  return (
    <div>
      <input
        id="pdf"
        type="file"
        onChange={(e) => onChagneFile(e.target.files?.item(0) ?? null)}
      />
      <p>{content}</p>
    </div>
  );
}

export default App;
