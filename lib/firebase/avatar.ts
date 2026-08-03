"use client";

import { updateAccessEntry } from "./data";

// Sem Cloud Storage (este projeto está no plano Spark, e o Storage passou a
// exigir o plano pago Blaze só pra criar o bucket) — a foto vira um recorte
// quadrado pequeno, comprimido em JPEG e guardada como data URI direto no
// campo `photoURL` do Firestore. 160px é de sobra pro avatar de ~28px da
// barra lateral, e o tamanho final fica bem abaixo do limite de 1MiB por
// documento do Firestore.
const MAX_DIM = 160;
const QUALITIES = [0.72, 0.5, 0.35, 0.2];
const MAX_DATA_URL_CHARS = 250_000; // ~250KB, folga grande sobre o limite do doc

function readFileAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não consegui ler essa imagem.")); };
    img.src = url;
  });
}

/** Recorta o centro em quadrado e redesenha em MAX_DIM×MAX_DIM antes de comprimir. */
function toSquareDataUrl(img: HTMLImageElement, quality: number): string {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = MAX_DIM;
  canvas.height = MAX_DIM;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador não suporta processar imagem (canvas indisponível).");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, MAX_DIM, MAX_DIM);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Comprime a foto escolhida e grava como data URI no registro de acesso do
 * usuário — tenta qualidades decrescentes até caber num tamanho seguro.
 */
export async function uploadProfilePhoto(email: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem.");
  }

  const img = await readFileAsImage(file);
  let dataUrl = "";
  for (const q of QUALITIES) {
    dataUrl = toSquareDataUrl(img, q);
    if (dataUrl.length <= MAX_DATA_URL_CHARS) break;
  }
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error("Não consegui comprimir essa imagem o suficiente. Tente uma foto mais simples.");
  }

  await updateAccessEntry(email, { photoURL: dataUrl });
  return dataUrl;
}
