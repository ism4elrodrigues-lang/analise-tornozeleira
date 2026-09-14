// Depende do global `L` (Leaflet), carregado via <script> a partir de lib/leaflet/leaflet.js.
//
// Tile provider: a Esri vem primeiro porque o serviço é feito justamente para
// ser embutido em apps de terceiros (é o que mais funciona sem chave dentro
// de uma extensão/app, na nossa experiência); o OSM padrão vem como
// alternativa — o tile server comunitário deles é voltado a uso em site
// normal e pode rejeitar tráfego vindo de contexto de extensão. Se um não
// carregar (rede bloqueada, política do provider mudou — já aconteceu com a
// CARTO, que era usada antes e passou a exigir cadastro), cai automaticamente
// pro próximo. Ambos são sem chave e enviam cabeçalho CORS liberado,
// necessário para poder ler o mapa de volta via <canvas> no exportador de
// vídeo/relatório.
//
// Suporta múltiplos casos simultâneos no mesmo mapa (cada um com sua própria
// camada/cor), para comparar rastros e localizar possíveis conexões entre
// monitorados.
import { formatDateTime, formatCoord } from "../util/format.js";

export const TILE_PROVIDERS = [
  {
    name: "esri",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    subdomains: "a",
    maxZoom: 19,
    attribution: "Tiles &copy; Esri",
  },
  {
    name: "osm",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
];

const TILE_ERROR_THRESHOLD = 6;
const TILE_TIMEOUT_MS = 6000;

export class MapView {
  constructor(containerId) {
    this.map = L.map(containerId, { zoomControl: true, preferCanvas: true });
    this.map.setView([-15.78, -47.93], 4);

    this.tileLayer = null;
    this.activeProviderIndex = -1;
    this._tileLoadCount = 0;
    this._tileErrorCount = 0;
    this._tileGeneration = 0;
    this._fallbackTimer = null;
    this._errorBanner = null;
    this._addTileLayer(0);

    this.caseLayers = new Map(); // caseId -> { group, pathLayer, markersLayer, anomalyLayer, zoneLayer, placesLayer }
    this.cursorMarker = null;
    this.poiLayer = L.layerGroup().addTo(this.map);
  }

  _addTileLayer(index) {
    clearTimeout(this._fallbackTimer);
    const provider = TILE_PROVIDERS[index];
    if (!provider) {
      this._showMapError();
      return;
    }
    this.activeProviderIndex = index;
    this._tileLoadCount = 0;
    this._tileErrorCount = 0;
    // Trocar de layer não cancela requisições de tile já em voo da anterior —
    // sem essa "geração", erros/loads tardios dela continuariam incrementando
    // os contadores acima e reiniciando o fallback em loop.
    const generation = ++this._tileGeneration;
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    this._hideMapError();

    this.tileLayer = L.tileLayer(provider.url, {
      attribution: provider.attribution,
      subdomains: provider.subdomains || "a",
      maxZoom: provider.maxZoom,
      crossOrigin: true,
    });
    this.tileLayer.on("tileload", () => {
      if (generation !== this._tileGeneration) return;
      this._tileLoadCount++;
    });
    this.tileLayer.on("tileerror", () => {
      if (generation !== this._tileGeneration) return;
      this._tileErrorCount++;
      if (this._tileErrorCount >= TILE_ERROR_THRESHOLD && this._tileLoadCount === 0) {
        this._addTileLayer(index + 1);
      }
    });
    this.tileLayer.addTo(this.map);

    this._fallbackTimer = setTimeout(() => {
      if (generation === this._tileGeneration && this._tileLoadCount === 0) this._addTileLayer(index + 1);
    }, TILE_TIMEOUT_MS);
  }

  getActiveTileProvider() {
    return TILE_PROVIDERS[this.activeProviderIndex] || TILE_PROVIDERS[0];
  }

  _showMapError() {
    if (this._errorBanner) return;
    const el = document.createElement("div");
    el.className = "map-error-banner";
    el.textContent =
      "Não foi possível carregar o mapa base (sem conexão com os provedores de tiles). Pontos, trajetos e ícones abaixo continuam funcionando normalmente.";
    this.getContainer().appendChild(el);
    this._errorBanner = el;
  }

  _hideMapError() {
    if (this._errorBanner) {
      this._errorBanner.remove();
      this._errorBanner = null;
    }
  }

  _ensureCase(caseId) {
    let entry = this.caseLayers.get(caseId);
    if (!entry) {
      const group = L.layerGroup();
      entry = {
        group,
        pathLayer: L.polyline([]).addTo(group),
        markersLayer: L.layerGroup().addTo(group),
        anomalyLayer: L.layerGroup().addTo(group),
        zoneLayer: L.layerGroup().addTo(group),
        placesLayer: L.layerGroup().addTo(group),
        modeSegmentsLayer: L.layerGroup().addTo(group),
      };
      this.caseLayers.set(caseId, entry);
    }
    return entry;
  }

  /** (Re)desenha o trajeto, marcadores e zona de exclusão de um caso. */
  setCase(caseId, { records, color, zone, visible, label, onSelect, onAnnotate, transportSegments, colorByMode }) {
    const entry = this._ensureCase(caseId);
    // guardados para o rastro (setCaseTrailWindow) poder redesenhar só os
    // pontos sem precisar que quem chama repasse cor/rótulo/callbacks de novo.
    entry.color = color;
    entry.label = label;
    entry.onSelect = onSelect;
    entry.onAnnotate = onAnnotate;

    entry.pathLayer.setStyle({ color, weight: 3, opacity: 0.7 });
    this._drawCasePoints(entry, records);

    entry.modeSegmentsLayer.clearLayers();
    if (colorByMode && transportSegments && transportSegments.length > 0) {
      // esconde a linha sólida na cor do caso e desenha um trecho colorido
      // por modo de deslocamento estimado (a pé/bicicleta/carro-moto) por cima.
      entry.pathLayer.setLatLngs([]);
      for (const seg of transportSegments) {
        L.polyline(
          [
            [seg.from.lat, seg.from.lon],
            [seg.to.lat, seg.to.lon],
          ],
          { color: seg.mode.color, weight: 4, opacity: 0.85 }
        )
          .bindTooltip(`${seg.mode.label} — ${seg.speedKmh.toFixed(1)} km/h (estimado)`)
          .addTo(entry.modeSegmentsLayer);
      }
    }

    entry.zoneLayer.clearLayers();
    if (zone && zone.lat != null && zone.lon != null && zone.radiusM) {
      L.circle([zone.lat, zone.lon], {
        radius: zone.radiusM,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.08,
        dashArray: "4 4",
      })
        .bindTooltip(
          `Zona de exclusão${label ? ` (${label})` : ""} — raio ${zone.radiusM.toFixed(0)} m` +
            (zone.address ? ` — ${zone.address}` : "")
        )
        .addTo(entry.zoneLayer);
      L.circleMarker([zone.lat, zone.lon], {
        radius: 4,
        color,
        fillColor: color,
        fillOpacity: 1,
        weight: 1,
      }).addTo(entry.zoneLayer);
    }

    this.setCaseVisible(caseId, visible !== false);
  }

  _drawCasePoints(entry, records) {
    entry.markersLayer.clearLayers();
    const latlngs = [];
    for (const r of records) {
      latlngs.push([r.lat, r.lon]);
      const violation = !!r.isViolation;
      const marker = L.circleMarker([r.lat, r.lon], {
        radius: violation ? 6 : 5,
        color: violation ? "#a83431" : entry.color,
        fillColor: violation ? "#d9534f" : entry.color,
        fillOpacity: 0.9,
        weight: 1,
      });
      marker.bindPopup(popupHtml(r, entry.label));
      if (entry.onSelect) marker.on("click", () => entry.onSelect(r));
      if (entry.onAnnotate) {
        marker.on("dblclick", (e) => {
          L.DomEvent.stopPropagation(e);
          entry.onAnnotate(r);
        });
      }
      marker.addTo(entry.markersLayer);
    }
    entry.pathLayer.setLatLngs(latlngs);
  }

  /** Redesenha só os pontos/trajeto de um caso já conhecido (modo "rastro", inclusive durante o playback). */
  setCaseTrailWindow(caseId, records) {
    const entry = this.caseLayers.get(caseId);
    if (!entry) return;
    // Independente da coloração por modo de deslocamento estar ativa na
    // exibição estática: o rastro dinâmico do playback sempre usa a cor
    // sólida do caso, para não deixar segmentos do trajeto completo
    // (mode-coloridos) sobrepostos à janela do rastro.
    entry.modeSegmentsLayer.clearLayers();
    this._drawCasePoints(entry, records);
  }

  setCaseAnomalies(caseId, anomalies) {
    const entry = this._ensureCase(caseId);
    entry.anomalyLayer.clearLayers();
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
        .addTo(entry.anomalyLayer);
    }
  }

  /** Desenha os locais frequentes (padrão de vida) detectados para um caso. */
  setCasePlaces(caseId, places, onSelect, onAnnotate) {
    const entry = this._ensureCase(caseId);
    entry.placesLayer.clearLayers();
    for (const p of places) {
      const marker = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          html: `<span class="place-marker-icon">${p.icon || "⭐"}</span>`,
          className: "place-marker",
          iconSize: [20, 20],
          iconAnchor: [10, 18],
        }),
      }).bindTooltip(`${p.label}${p.address ? ` — ${p.address}` : ""}`);
      if (onSelect) marker.on("click", () => onSelect(p));
      if (onAnnotate) {
        marker.on("dblclick", (e) => {
          L.DomEvent.stopPropagation(e);
          onAnnotate(p);
        });
      }
      marker.addTo(entry.placesLayer);
    }
  }

  /** Pontos de interesse marcados manualmente (globais, não ligados a um caso). */
  setPois(pois, onSelect, onAnnotate) {
    this.poiLayer.clearLayers();
    for (const p of pois) {
      const marker = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          html: `<span class="poi-marker-icon">${p.icon || "📍"}</span>`,
          className: "poi-marker",
          iconSize: [22, 22],
          iconAnchor: [11, 20],
        }),
      }).bindTooltip(p.label || "Ponto de interesse");
      if (onSelect) marker.on("click", () => onSelect(p));
      if (onAnnotate) {
        marker.on("dblclick", (e) => {
          L.DomEvent.stopPropagation(e);
          onAnnotate(p);
        });
      }
      marker.addTo(this.poiLayer);
    }
  }

  /** Ativa/desativa um modo em que o próximo clique no mapa chama `handler(latlng)` uma vez. */
  setClickToPlaceMode(active, handler) {
    if (this._placeClickHandler) {
      this.map.off("click", this._placeClickHandler);
      this._placeClickHandler = null;
    }
    this.getContainer().style.cursor = active ? "crosshair" : "";
    if (active && handler) {
      this._placeClickHandler = (e) => handler(e.latlng);
      this.map.on("click", this._placeClickHandler);
    }
  }

  setCaseVisible(caseId, visible) {
    const entry = this.caseLayers.get(caseId);
    if (!entry) return;
    const onMap = this.map.hasLayer(entry.group);
    if (visible && !onMap) entry.group.addTo(this.map);
    else if (!visible && onMap) this.map.removeLayer(entry.group);
  }

  removeCase(caseId) {
    const entry = this.caseLayers.get(caseId);
    if (!entry) return;
    this.map.removeLayer(entry.group);
    this.caseLayers.delete(caseId);
  }

  /** Ajusta o zoom/centro para enquadrar todos os casos atualmente visíveis. */
  fitToVisible() {
    const bounds = L.latLngBounds([]);
    let has = false;
    for (const entry of this.caseLayers.values()) {
      if (!this.map.hasLayer(entry.group)) continue;
      for (const marker of entry.markersLayer.getLayers()) {
        bounds.extend(marker.getLatLng());
        has = true;
      }
      for (const layer of entry.zoneLayer.getLayers()) {
        if (typeof layer.getBounds === "function") {
          bounds.extend(layer.getBounds());
          has = true;
        }
      }
    }
    if (has) this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
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

  panTo(latlng) {
    this.map.panTo(latlng, { animate: true });
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

function popupHtml(r, label) {
  const lines = [];
  if (label) lines.push(`<em>${escapeHtml(label)}</em>`);
  lines.push(`<strong>${formatDateTime(r.createdAt)}</strong>`);
  if (r.status) {
    const color = r.isViolation ? "#d9534f" : "#1e3a5f";
    lines.push(`<span style="color:${color}; font-weight:600;">${escapeHtml(r.status)}</span>`);
  } else if (r.action) {
    lines.push(`Ação: ${escapeHtml(r.action)}`);
  }
  if (r.address) lines.push(escapeHtml(r.address));
  if (r.distanceToZoneM != null) lines.push(`Distância à zona: ${r.distanceToZoneM.toFixed(0)} m`);
  if (r.ip) lines.push(`IP: ${escapeHtml(r.ip)}`);
  lines.push(`Coordenadas: ${formatCoord(r.lat)}, ${formatCoord(r.lon)}`);
  return `<div class="map-popup">${lines.join("<br/>")}</div>`;
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
