// ════════════════════════════════════════════════════════════════════
// lib/pdf-montar.ts — junta fotos (JPG/PNG) e PDFs num PDF só
//
// A Crefisa exige cada tipo de documento como UM pdf (máx. 5MB). O
// operador costuma ter foto do celular, então convertemos aqui no
// navegador. Fotos grandes são reduzidas antes de entrar no PDF.
// ════════════════════════════════════════════════════════════════════

const LADO_MAX = 1800;     // px — suficiente pra documento legível
const QUALIDADE_JPG = 0.82;

/** Reduz a foto e devolve os bytes em JPEG. */
async function reduzirImagem(file: File): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => erro(new Error(`Não consegui abrir a imagem ${file.name}`));
      i.src = url;
    });
    const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Navegador sem suporte a canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', QUALIDADE_JPG));
    if (!blob) throw new Error(`Falha ao converter ${file.name}`);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Junta os arquivos (fotos e/ou PDFs) num PDF e devolve em base64. */
export async function montarPdfBase64(arquivos: File[]): Promise<{ base64: string; bytes: number }> {
  // carregado só na hora — não pesa a tela pra quem só consulta
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();

  for (const f of arquivos) {
    const nome = f.name.toLowerCase();
    if (f.type === 'application/pdf' || nome.endsWith('.pdf')) {
      const origem = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const paginas = await pdf.copyPages(origem, origem.getPageIndices());
      paginas.forEach((p) => pdf.addPage(p));
    } else if (f.type.startsWith('image/')) {
      const jpg = await pdf.embedJpg(await reduzirImagem(f));
      const pagina = pdf.addPage([jpg.width, jpg.height]);
      pagina.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    } else {
      throw new Error(`Formato não aceito: ${f.name} (use foto ou PDF)`);
    }
  }

  const bytes = await pdf.save();
  let bin = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return { base64: btoa(bin), bytes: bytes.length };
}
