// Utilitário compartilhado para "fotografar" o mapa (tiles do provider
// configurado em mapView.js) num <canvas> próprio — usado tanto pelo
// exportador de vídeo quanto pelo de relatório, já que nenhum dos dois pode
// simplesmente capturar o DOM do Leaflet.
import { TILE_URL, TILE_SUBDOMAINS } from "./mapView.js";

export function makeProjector(leafletMap, zoom, pixelBounds) {
  return (lat, lon) => {
    const p = leafletMap.project({ lat, lng: lon }, zoom);
    return { x: p.x - pixelBounds.min.x, y: p.y - pixelBounds.min.y };
  };
}

export async function drawTileMosaic(ctx, zoom, pixelBounds) {
  const tileSize = 256;
  const minTX = Math.floor(pixelBounds.min.x / tileSize);
  const maxTX = Math.floor((pixelBounds.max.x - 1) / tileSize);
  const minTY = Math.floor(pixelBounds.min.y / tileSize);
  const maxTY = Math.floor((pixelBounds.max.y - 1) / tileSize);

  const loads = [];
  for (let tx = minTX; tx <= maxTX; tx++) {
    for (let ty = minTY; ty <= maxTY; ty++) {
      const destX = tx * tileSize - pixelBounds.min.x;
      const destY = ty * tileSize - pixelBounds.min.y;
      const url = tileUrl(tx, ty, zoom);
      loads.push(
        loadImage(url)
          .then((img) => ctx.drawImage(img, destX, destY, tileSize, tileSize))
          .catch(() => {})
      );
    }
  }
  await Promise.all(loads);
}

function tileUrl(x, y, z) {
  const s = TILE_SUBDOMAINS[Math.abs(x + y) % TILE_SUBDOMAINS.length];
  return TILE_URL.replace("{s}", s).replace("{z}", z).replace("{x}", x).replace("{y}", y).replace("{r}", "");
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
