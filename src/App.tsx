import ky from "ky";
import { useState } from "react";

const PROD_SERVER_ORIGIN = "http://localhost:3000/api";
const DEV_SERVER_ORIGIN = "/api";

const apiEndpoint = import.meta.env.DEV
  ? DEV_SERVER_ORIGIN
  : PROD_SERVER_ORIGIN;

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

function App() {
  const [pdfURL, setPDFURL] = useState<string>("");

  const onChagneFile = async (file: File | null) => {
    if (!file) return;

    const formData = new FormData();
    formData.append("pdf", file);
    const { filename } = await postPDFUpload(formData);
    if (filename) {
      setPDFURL(`${apiEndpoint}/v1/${filename}`);
    }
  };

  console.log(pdfURL);

  return (
    <div>
      <input
        id="pdf"
        type="file"
        onChange={(e) => onChagneFile(e.target.files?.item(0) ?? null)}
      />
    </div>
  );
}

export default App;
