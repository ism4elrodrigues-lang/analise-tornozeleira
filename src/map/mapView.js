// Depende do global `L` (Leaflet), carregado via <script> a partir de lib/leaflet/leaflet.js.
//
// Usa tiles da CARTO (não o tile server padrão do OSM) porque precisamos que a
// imagem do mapa possa ser lida de volta via <canvas> (crossOrigin) para o
// exportador de vídeo/relatório — a CARTO envia cabeçalho CORS liberado nos
// tiles, o OSM tile server padrão não garante isso.
import { formatDateTime, formatCoord } from "../util/format.js";

export const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const TILE_SUBDOMAINS = "abcd";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export class MapView {
  constructor(containerId) {
    this.map = L.map(containerId, { zoomControl: true, preferCanvas: true });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      subdomains: TILE_SUBDOMAINS,
      maxZoom: 20,
      crossOrigin: true,
    }).addTo(this.map);
    this.map.setView([-15.78, -47.93], 4);

    this.pathLayer = L.polyline([], { color: "#1e3a5f", weight: 3, opacity: 0.7 }).addTo(this.map);
    this.markersLayer = L.layerGroup().addTo(this.map);
    this.anomalyLayer = L.layerGroup().addTo(this.map);
    this.cursorMarker = null;
  }

  setRecords(records, onSelect) {
    this.markersLayer.clearLayers();
    const latlngs = [];
    for (const r of records) {
      latlngs.push([r.lat, r.lon]);
      const marker = L.circleMarker([r.lat, r.lon], {
        radius: 5,
        color: "#1e3a5f",
        fillColor: "#4cafd9",
        fillOpacity: 0.9,
        weight: 1,
      });
      marker.bindPopup(popupHtml(r));
      if (onSelect) marker.on("click", () => onSelect(r));
      marker.addTo(this.markersLayer);
    }
    this.pathLayer.setLatLngs(latlngs);
    if (latlngs.length > 0) {
      this.map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 15 });
    }
  }

  setAnomalies(anomalies) {
    this.anomalyLayer.clearLayers();
    for (const a of anomalies) {
      L.polyline(
        [
          [a.from.lat, a.from.lon],
          [a.to.lat, a.to.lon],
        ],
        { color: "#d9534f", weight: 4, opacity: 0.85, dashArray: "6 6" }
      )
        .bindTooltip(
          `Deslocamento implausível: ${a.distanceKm.toFixed(1)} km em ${a.hours.toFixed(2)} h ` +
            `(${a.speedKmh.toFixed(0)} km/h)`
        )
        .addTo(this.anomalyLayer);
    }
  }

  setCursor(latlng) {
    if (!latlng) {
      if (this.cursorMarker) {
        this.map.removeLayer(this.cursorMarker);
        this.cursorMarker = null;
      }
      return;
    }
    if (!this.cursorMarker) {
      this.cursorMarker = L.circleMarker(latlng, {
        radius: 8,
        color: "#d9534f",
        fillColor: "#d9534f",
        fillOpacity: 1,
        weight: 2,
      }).addTo(this.map);
    } else {
      this.cursorMarker.setLatLng(latlng);
    }
  }

  fitToLatLngs(latlngs) {
    if (latlngs.length > 0) this.map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 15 });
  }

  getContainer() {
    return this.map.getContainer();
  }

  getLeafletMap() {
    return this.map;
  }

  invalidateSize() {
    this.map.invalidateSize();
  }
}

function popupHtml(r) {
  return `
    <div class="map-popup">
      <strong>${formatDateTime(r.createdAt)}</strong><br/>
      Ação: ${escapeHtml(r.action || "-")}<br/>
      IP: ${escapeHtml(r.ip || "-")}<br/>
      Coordenadas: ${formatCoord(r.lat)}, ${formatCoord(r.lon)}
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
