// Schema único usado tanto pelo parser de CSV quanto pelo de PDF, para que
// ambos convirjam para o mesmo formato de registro normalizado.

export const FIELDS = [
  {
    key: "accountNumber",
    label: "Conta",
    aliases: ["account_number", "conta", "numero_conta", "numeroconta"],
    type: "string",
  },
  { key: "cpf", label: "CPF", aliases: ["cpf"], type: "string" },
  {
    key: "createdAt",
    label: "Data/Hora Criação",
    aliases: [
      "dt_hr_criacao_utc-3",
      "dt_hr_criacao_utc3",
      "dt_hr_criacao",
      "data_hora_criacao",
    ],
    type: "datetime",
  },
  {
    key: "deviceModel",
    label: "Dispositivo",
    aliases: ["context_device_model", "device_model", "modelo_dispositivo", "dispositivo"],
    type: "string",
  },
  {
    key: "os",
    label: "Sistema Operacional",
    aliases: ["sistema_operacional", "os"],
    type: "string",
  },
  {
    key: "osVersion",
    label: "Versão SO",
    aliases: ["versao_so", "os_version", "versaoso"],
    type: "string",
  },
  {
    key: "lat",
    label: "Latitude",
    aliases: ["context_latitude", "latitude"],
    type: "float",
  },
  {
    key: "lon",
    label: "Longitude",
    aliases: ["context_longitude", "longitude"],
    type: "float",
  },
  {
    key: "ipPort",
    label: "IP:Porta",
    aliases: ["logical-port-ip", "logical_port_ip", "ip_porta", "ippota"],
    type: "string",
  },
  {
    key: "sentAt",
    label: "Data/Hora Envio",
    aliases: [
      "dt_hr_envio_utc-3",
      "dt_hr_envio_utc3",
      "dt_hr_envio",
      "data_hora_envio",
    ],
    type: "datetime",
  },
  {
    key: "action",
    label: "Ação",
    aliases: ["acao_evento", "acao", "action", "evento"],
    type: "string",
  },
];

export function normalizeHeaderKey(str) {
  return str
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

const ALIAS_INDEX = new Map();
for (const field of FIELDS) {
  for (const alias of field.aliases) {
    ALIAS_INDEX.set(normalizeHeaderKey(alias), field);
  }
}

export function matchField(token) {
  const norm = normalizeHeaderKey(token);
  if (!norm) return null;
  return ALIAS_INDEX.get(norm) || null;
}
