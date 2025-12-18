// src/lib/pdf-utils.js
// Utilities for PDF manipulation in the browser

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/**
 * Generate a PNG thumbnail from a PDF file
 * @param {File|Blob} pdfFile - The PDF file to generate thumbnail from
 * @param {number} width - Target width of the thumbnail (default 400)
 * @returns {Promise<Blob>} PNG blob of the first page
 */
export async function generatePdfThumbnail(pdfFile, width = 400) {
  try {
    // Convert file to ArrayBuffer
    const arrayBuffer = await pdfFile.arrayBuffer();

    // Load the PDF document
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.21/cmaps/',
      cMapPacked: true,
    }).promise;

    // Get the first page
    const page = await pdf.getPage(1);

    // Calculate scale to get desired width
    const viewport = page.getViewport({ scale: 1 });
    const scale = width / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const ctx = canvas.getContext('2d');

    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render the page
    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport,
    }).promise;

    // Convert to blob
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create thumbnail blob'));
        }
      }, 'image/png', 0.9);
    });
  } catch (error) {
    console.warn('[pdf-utils] Failed to generate thumbnail:', error.message);
    return null;
  }
}
