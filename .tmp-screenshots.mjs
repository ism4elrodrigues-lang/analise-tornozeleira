import { chromium } from "playwright";

const EXT_PATH = "/home/user/analise-tornozeleira";
const SCRATCH = "/tmp/claude-0/-home-user-analise-tornozeleira/29500496-ab41-5662-8738-71f6eacc8ff9/scratchpad";
const USER_DATA_DIR = `${SCRATCH}/chrome-profile-shots`;
const OUT = `${SCRATCH}/screenshots`;

const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
  headless: true,
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, "--no-sandbox"],
  viewport: { width: 1400, height: 1000 },
});
await new Promise((r) => setTimeout(r, 1500));

const extPage = await context.newPage();
await extPage.goto("chrome://extensions/");
const extId = await extPage.evaluate(async () => {
  const mgr = document.querySelector("extensions-manager");
  const itemList = mgr.shadowRoot.querySelector("extensions-item-list");
  const item = itemList.shadowRoot.querySelector("extensions-item");
  return item.getAttribute("id");
});
await extPage.close();

const page = await context.newPage();
page.on("dialog", (d) => d.dismiss());

await page.goto(`chrome-extension://${extId}/dashboard/dashboard.html`);
await page.waitForTimeout(400);

// Popup da extensão
const popupPage = await context.newPage();
await popupPage.setViewportSize({ width: 320, height: 220 });
await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`);
await popupPage.waitForTimeout(200);
await popupPage.screenshot({ path: `${OUT}/01-popup.png` });
await popupPage.close();

// Carrega só o caso principal primeiro, pra o mapa ficar bem enquadrado nele
// (o segundo caso de teste tem um ponto de propósito bem longe, só pra
// validar a detecção de "encontro" — carregá-lo já no início deixaria o
// mapa todo desenquadrado nos prints).
await page.setInputFiles("#file-input", `${SCRATCH}/rastro.xlsx`);
await page.waitForTimeout(1800);

// adiciona uma nota num evento da tabela
await page.locator("#records-tbody tr").first().locator(".note-btn").click();
await page.waitForSelector(".note-modal textarea");
await page.fill(".note-modal textarea", "Confirmado por vizinho que avistou o monitorado neste horário.");
await page.click(".note-modal .modal-actions button:has-text('Salvar')");
await page.waitForTimeout(300);

// nota numa violação
const violCount = await page.locator("#zone-violations-list li").count();
if (violCount > 0) {
  await page.locator("#zone-violations-list li").first().locator(".note-btn").click();
  await page.waitForSelector(".note-modal textarea");
  await page.fill(".note-modal textarea", "Verificar se havia autorização judicial pontual nesse dia.");
  await page.click(".note-modal .modal-actions button:has-text('Salvar')");
  await page.waitForTimeout(300);
}

// screenshot do modal de nota aberto (com foto anexada) para mostrar o editor
await page.locator("#records-tbody tr").nth(1).locator(".note-btn").click();
await page.waitForSelector(".note-modal textarea");
await page.fill(".note-modal textarea", "Local com câmera de segurança próxima — solicitar imagens.");
await page.screenshot({ path: `${OUT}/07-modal-nota.png` });
await page.click(".note-photo-row button"); // Anexar foto
await page.waitForSelector(".photo-annotator");
await page.setInputFiles(".photo-annotator input[type=file]", `${SCRATCH}/tiny.png`);
await page.waitForTimeout(300);
const canvasBox = await page.locator(".photo-canvas").boundingBox();
await page.mouse.move(canvasBox.x + 10, canvasBox.y + 10);
await page.mouse.down();
await page.mouse.move(canvasBox.x + 70, canvasBox.y + 50, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/08-editor-foto.png` });
await page.click(".photo-annotator .modal-actions button:has-text('Salvar')");
await page.waitForTimeout(200);
await page.click(".note-modal .modal-actions button:has-text('Salvar')");
await page.waitForTimeout(300);

// adiciona um ponto de interesse
await page.click("#add-poi-btn");
await page.click("#map", { position: { x: 150, y: 120 } });
await page.waitForSelector(".note-modal textarea");
await page.fill(".note-modal textarea", "Endereço da vítima, para referência.");
await page.click(".note-modal .modal-actions button:has-text('Salvar')");
await page.waitForTimeout(400);

// gera narrativa
await page.click("#generate-narrative-btn");
await page.waitForTimeout(200);

// --- screenshots (caso único, mapa bem enquadrado) ---
await page.screenshot({ path: `${OUT}/02-pagina-completa.png`, fullPage: true });

await page.locator(".topbar").screenshot({ path: `${OUT}/03-topbar.png` }).catch(() => {});
await page.locator("#cases-section").screenshot({ path: `${OUT}/04-casos.png` });
await page.locator("#case-header").screenshot({ path: `${OUT}/05-cabecalho-caso.png` });
await page.locator(".map-section").screenshot({ path: `${OUT}/06-mapa.png` });
await page.locator(".playback-bar").screenshot({ path: `${OUT}/09-playback.png` });
await page.locator(".timeline-section").screenshot({ path: `${OUT}/10-timeline.png` });
await page.locator("#narrative-section").screenshot({ path: `${OUT}/12-narrativa.png` });
await page.locator(".lower-grid .anomalies-panel").screenshot({ path: `${OUT}/13-violacoes-locais.png` });
await page.locator("#poi-section").screenshot({ path: `${OUT}/14-poi.png` });
await page.locator("#annotations-section").screenshot({ path: `${OUT}/15-anotacoes.png` });
await page.locator(".records-panel").screenshot({ path: `${OUT}/16-tabela-eventos.png` });

// --- agora carrega o segundo caso, só pra mostrar o menu multi-caso e o painel de encontros ---
await page.setInputFiles("#file-input", `${SCRATCH}/companion.csv`);
await page.waitForTimeout(1200);
await page.locator("#cases-section").screenshot({ path: `${OUT}/17-casos-multi.png` });
await page.locator("#connections-section").screenshot({ path: `${OUT}/11-encontros.png` });
await page.locator(".map-section").screenshot({ path: `${OUT}/18-mapa-multi-caso.png` });

console.log("Screenshots salvos em", OUT);
await context.close();
