export function downloadEditorDraft(path, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `${path.split("/").pop() || "file"}.draft.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
