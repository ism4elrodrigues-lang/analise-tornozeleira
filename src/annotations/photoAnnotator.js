// Editor simples de anotação em foto: carrega uma imagem local, permite
// desenhar à mão livre (caneta vermelha) ou inserir texto sobre ela, e
// "achata" tudo num único PNG ao salvar — não guarda camadas editáveis
// separadas, então reabrir para editar continua a partir do resultado já
// achatado.
const MAX_WIDTH = 640;

/**
 * @param {string|null} initialDataUrl foto já anotada anteriormente, se houver.
 * @returns {Promise<string|null|undefined>} dataURL nova, null (removida) ou
 *   undefined (cancelado, mantém o que já havia).
 */
export function openPhotoAnnotator(initialDataUrl) {
  return new Promise((resolve) => {
    let mode = "pen";
    let drawing = false;
    let hasImage = false;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box photo-annotator";

    const title = document.createElement("h3");
    title.textContent = "Anotar foto";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";

    const toolbar = document.createElement("div");
    toolbar.className = "photo-toolbar";
    const penBtn = mkBtn("✏️ Desenhar", () => setMode("pen"));
    const textBtn = mkBtn("🔤 Texto", () => setMode("text"));
    penBtn.classList.add("active");
    toolbar.append(penBtn, textBtn);

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "photo-canvas-wrap";
    const canvas = document.createElement("canvas");
    canvas.className = "photo-canvas";
    const ctx = canvas.getContext("2d");
    canvasWrap.appendChild(canvas);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Escolha uma imagem, depois desenhe ou clique para inserir texto.";

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const saveBtn = mkBtn("Salvar", () => finish(hasImage ? canvas.toDataURL("image/png") : null));
    const cancelBtn = mkBtn("Cancelar", () => finish(undefined));
    const removeBtn = mkBtn("Remover foto", () => finish(null));
    actions.append(saveBtn, cancelBtn, removeBtn);

    box.append(title, fileInput, toolbar, canvasWrap, hint, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function mkBtn(label, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    }

    function setMode(m) {
      mode = m;
      penBtn.classList.toggle("active", m === "pen");
      textBtn.classList.toggle("active", m === "text");
    }

    function loadImage(src) {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_WIDTH / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        hasImage = true;
      };
      img.src = src;
    }

    fileInput.addEventListener("change", () => {
      const f = fileInput.files[0];
      if (f) loadImage(URL.createObjectURL(f));
    });

    canvas.addEventListener("pointerdown", (e) => {
      if (!hasImage) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (mode === "text") {
        const text = prompt("Texto da anotação:");
        if (text) {
          ctx.fillStyle = "#d9534f";
          ctx.font = "bold 18px system-ui, sans-serif";
          ctx.fillText(text, x, y);
        }
        return;
      }
      drawing = true;
      ctx.strokeStyle = "#d9534f";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      ctx.stroke();
    });
    window.addEventListener("pointerup", stopDrawing);

    function stopDrawing() {
      drawing = false;
    }

    function finish(result) {
      window.removeEventListener("pointerup", stopDrawing);
      overlay.remove();
      resolve(result);
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(undefined);
    });

    if (initialDataUrl) loadImage(initialDataUrl);
  });
}
