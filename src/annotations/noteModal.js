import { openPhotoAnnotator } from "./photoAnnotator.js";

const ICON_CHOICES = [
  { icon: "📍", label: "Ponto genérico" },
  { icon: "⭐", label: "Local frequente" },
  { icon: "🏠", label: "Residência" },
  { icon: "🏢", label: "Trabalho / prédio" },
  { icon: "🏥", label: "Hospital" },
  { icon: "⛽", label: "Posto de combustível" },
  { icon: "🚪", label: "Entrada forçada / arrombamento" },
  { icon: "💀", label: "Local de morte" },
  { icon: "🩸", label: "Cena de crime" },
  { icon: "🔫", label: "Arma" },
  { icon: "💰", label: "Valores / dinheiro" },
  { icon: "📱", label: "Celular / dispositivo" },
  { icon: "📷", label: "Câmera / foto" },
  { icon: "👤", label: "Pessoa" },
  { icon: "🕵️", label: "Suspeito / investigado" },
  { icon: "👮", label: "Policial" },
  { icon: "🚗", label: "Veículo" },
  { icon: "🚙", label: "Veículo suspeito" },
  { icon: "🚓", label: "Viatura policial" },
  { icon: "🏍️", label: "Moto" },
  { icon: "🚩", label: "Marco / alerta" },
  { icon: "❗", label: "Importante" },
  { icon: "⚠️", label: "Atenção" },
  { icon: "🔎", label: "Investigar" },
];

/**
 * @param {boolean} [showIconPicker] mostra um seletor de ícone (emoji) — usado
 *   para pontos de interesse e locais frequentes, que aparecem como ícone no mapa.
 * @returns {Promise<{text:string, photoDataUrl:string|null, icon?:string}|null>} null se cancelado.
 */
export function openNoteModal({
  title,
  initialText = "",
  initialPhoto = null,
  initialIcon = null,
  showIconPicker = false,
  allowDelete = false,
}) {
  return new Promise((resolve) => {
    let photoDataUrl = initialPhoto;
    let selectedIcon = initialIcon || ICON_CHOICES[0].icon;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const box = document.createElement("div");
    box.className = "modal-box note-modal";

    const h = document.createElement("h3");
    h.textContent = title;

    let iconRow = null;
    if (showIconPicker) {
      iconRow = document.createElement("div");
      iconRow.className = "icon-picker";
      const iconButtons = ICON_CHOICES.map(({ icon, label }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = icon;
        b.title = label;
        b.className = "icon-choice" + (icon === selectedIcon ? " selected" : "");
        b.addEventListener("click", () => {
          selectedIcon = icon;
          for (const other of iconButtons) other.classList.toggle("selected", other === b);
        });
        return b;
      });
      iconRow.append(...iconButtons);
    }

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
      const result = { text: textarea.value, photoDataUrl };
      if (showIconPicker) result.icon = selectedIcon;
      resolve(result);
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

    if (iconRow) box.append(h, iconRow, textarea, photoRow, actions);
    else box.append(h, textarea, photoRow, actions);
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
