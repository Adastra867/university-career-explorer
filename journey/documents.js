const MAX_BYTES = 5 * 1024 * 1024;

export async function parseDocumentFile(file, onProgress = () => {}) {
  if (!file || file.size > MAX_BYTES) throw new Error('每份资料最多 5 MB。');
  const id = `document_${crypto.randomUUID()}`;
  const title = file.name.slice(0, 120);
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import('/journey/vendor/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/journey/vendor/pdf.worker.mjs';
    const loading = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, disableFontFace: true, stopAtErrors: true });
    let document;
    try {
      document = await loading.promise;
      if (document.numPages > 60) throw new Error('一次最多解析 60 页，请拆分资料后导入。');
      const pages = [];
      let size = 0;
      for (let i = 1; i <= document.numPages; i++) {
        onProgress(`正在本地解析第 ${i}/${document.numPages} 页`);
        const page = await document.getPage(i), content = await page.getTextContent();
        const text = content.items.map(item => item.str || '').join(' ').trim();
        if (text) { size += `[第${i}页] `.length + text.length + (pages.length ? 1 : 0); pages.push({ page: i, text }); }
        if (size > 20000) throw new Error('解析文字超过 20,000 字，请只导入相关页面。');
      }
      if (!pages.length) throw new Error('PDF 没有可提取文字，扫描件需要先做 OCR。');
      return { id, title, kind: 'pdf_excerpt', text: pages.map(p => `[第${p.page}页] ${p.text}`).join('\n'), locator: `第1–${document.numPages}页（片段含页码）`, pages, createdAt: new Date().toISOString() };
    } finally { await loading.destroy(); }
  }
  if (!/\.(txt|md|csv)$/i.test(file.name)) throw new Error('支持 PDF、TXT、Markdown 或 CSV 文本资料。');
  const text = (await file.text()).trim();
  if (!text || text.length > 20000) throw new Error('文本须为 1–20,000 字。');
  return { id, title, kind: 'text', text, locator: '用户上传文本', createdAt: new Date().toISOString() };
}
