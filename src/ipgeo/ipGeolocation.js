// Busca opcional (opt-in, disparada manualmente por linha) de geolocalização
// aproximada a partir do IP, para preencher eventos sem lat/lon. Diferente do
// resto da extensão, isso envia o IP a um serviço externo (ipapi.co) — por
// isso nunca é chamado automaticamente.
const cache = new Map();

export async function lookupIp(ip) {
  if (!ip) throw new Error("IP vazio.");
  if (cache.has(ip)) return cache.get(ip);

  const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
  if (!res.ok) throw new Error(`Falha na consulta de IP (HTTP ${res.status}).`);
  const data = await res.json();
  if (data.error) throw new Error(data.reason || "Erro na consulta de geolocalização por IP.");
  if (typeof data.latitude !== "number" || typeof data.longitude !== "number") {
    throw new Error("Serviço não retornou coordenadas para este IP.");
  }

  const result = {
    lat: data.latitude,
    lon: data.longitude,
    city: data.city || null,
    region: data.region || null,
    country: data.country_name || null,
  };
  cache.set(ip, result);
  return result;
}
