// Modal simples para configurar a exportação de vídeo (hoje só a duração da
// pausa em pontos com foto anexada) — reaproveita as classes .modal-overlay
// / .modal-box / .modal-actions já usadas pelo modal de anotação.

/**
 * @param {object} opts
 * @param {number} opts.initialPhotoHoldSeconds
 * @returns {Promise<{photoHoldSeconds:number}|null>} null se cancelado.
 */
export function openVideoSettingsModal({ initialPhotoHoldSeconds }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const box = document.createElement("div");
    box.className = "modal-box";

    const h = document.createElement("h3");
    h.textContent = "Configurações do vídeo";

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      'Quando um ponto do trajeto tiver foto anexada, o vídeo gerado mostra a foto em tela cheia antes de continuar a animação.';

    const row = document.createElement("label");
    row.className = "video-settings-row";
    row.textContent = "Duração de cada foto no vídeo (segundos): ";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "60";
    input.step = "1";
    input.value = String(initialPhotoHoldSeconds);
    row.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const saveBtn = mkBtn("Salvar", () => {
      const n = parseInt(input.value, 10);
      const photoHoldSeconds = Number.isFinite(n) && n >= 1 ? n : initialPhotoHoldSeconds;
      cleanup();
      resolve({ photoHoldSeconds });
    });
    const cancelBtn = mkBtn("Cancelar", () => {
      cleanup();
      resolve(null);
    });
    actions.append(saveBtn, cancelBtn);

    box.append(h, hint, row, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();
    input.select();

    function mkBtn(label, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    }

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
