/** Save data the browser already has as a file (no extra request, no egress). */

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled; revoking synchronously can cancel the save in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function saveText(text: string, fileName: string, mime = "text/plain"): void {
  saveBlob(new Blob([text], { type: `${mime};charset=utf-8` }), fileName);
}
