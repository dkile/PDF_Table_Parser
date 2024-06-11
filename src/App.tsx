import { useState } from "react";

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
