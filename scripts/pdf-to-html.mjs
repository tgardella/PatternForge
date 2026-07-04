// Assemble a self-contained HTML that renders every page of a PDF to canvas
// via inlined pdf.js (for headless visual QA of the PDF export).
import { readFileSync, writeFileSync } from "node:fs";

const [, , pdfPath, outPath] = process.argv;
const pdfB64 = readFileSync(pdfPath).toString("base64");
const pdfjs = readFileSync("node_modules/pdfjs-dist/legacy/build/pdf.min.js", "utf8");
const worker = readFileSync("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js", "utf8");

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#666;font-family:sans-serif}
canvas{display:block;margin:8px auto;box-shadow:0 0 8px rgba(0,0,0,.5)}
</style></head><body>
<div id="pages"></div><div id="status">loading</div>
<script>${pdfjs}</script>
<script>
const workerBlob = new Blob([${JSON.stringify(worker)}], {type: "application/javascript"});
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
const bytes = Uint8Array.from(atob("${pdfB64}"), c => c.charCodeAt(0));
pdfjsLib.getDocument({data: bytes}).promise.then(async (doc) => {
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({scale: 1.4});
    const canvas = document.createElement("canvas");
    canvas.id = "page" + i;
    canvas.width = vp.width; canvas.height = vp.height;
    document.getElementById("pages").appendChild(canvas);
    await page.render({canvasContext: canvas.getContext("2d"), viewport: vp}).promise;
  }
  const s = document.getElementById("status");
  s.textContent = "done " + doc.numPages;
  s.id = "done";
}).catch(e => { document.getElementById("status").textContent = "ERROR " + e.message; });
</script></body></html>`;
writeFileSync(outPath, html);
console.log("wrote", outPath, (html.length / 1024 / 1024).toFixed(1), "MB");
