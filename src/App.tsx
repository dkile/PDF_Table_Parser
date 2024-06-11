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

function App() {
  const [file, setFile] = useState<File | null | undefined>(null);

  return (
    <div>
      <input
        id="pdf"
        type="file"
        onChange={(e) => setFile(e.target.files?.item(0))}
      />
    </div>
  );
}

export default App;
