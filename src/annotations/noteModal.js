import { openPhotoAnnotator } from "./photoAnnotator.js";

/**
 * @returns {Promise<{text:string, photoDataUrl:string|null}|null>} null se cancelado.
 */
export function openNoteModal({ title, initialText = "", initialPhoto = null, allowDelete = false }) {
  return new Promise((resolve) => {
    let photoDataUrl = initialPhoto;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const box = document.createElement("div");
    box.className = "modal-box note-modal";

    const h = document.createElement("h3");
    h.textContent = title;

    const textarea = document.createElement("textarea");
    textarea.value = initialText;
    textarea.rows = 4;
    textarea.placeholder = "Anotação (texto livre, opcional se anexar foto)...";

    const photoRow = document.createElement("div");
    photoRow.className = "note-photo-row";
    const photoBtn = mkBtn("", async () => {
      const result = await openPhotoAnnotator(photoDataUrl);
      if (result !== undefined) {
        photoDataUrl = result;
        refreshPhotoUi();
      }
    });
    const photoPreview = document.createElement("img");
    photoPreview.className = "note-photo-preview";
    photoRow.append(photoBtn, photoPreview);

    function refreshPhotoUi() {
      photoBtn.textContent = photoDataUrl ? "Editar foto" : "Anexar foto";
      photoPreview.style.display = photoDataUrl ? "block" : "none";
      if (photoDataUrl) photoPreview.src = photoDataUrl;
    }
    refreshPhotoUi();

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const saveBtn = mkBtn("Salvar", () => {
      cleanup();
      resolve({ text: textarea.value, photoDataUrl });
    });
    const cancelBtn = mkBtn("Cancelar", () => {
      cleanup();
      resolve(null);
    });
    actions.append(saveBtn, cancelBtn);
    if (allowDelete) {
      const delBtn = mkBtn("Remover anotação", () => {
        cleanup();
        resolve({ text: "", photoDataUrl: null });
      });
      actions.appendChild(delBtn);
    }

    function mkBtn(label, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      if (label) b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    }

    box.append(h, textarea, photoRow, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    textarea.focus();

    function cleanup() {
      overlay.remove();
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });
  });
}
