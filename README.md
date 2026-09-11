# Análise de Tornozeleira Eletrônica

Extensão Chrome (Manifest V3) para analisar logs de acesso/geolocalização de
monitoramento eletrônico (XLSX, CSV ou PDF) e gerar mapa, linha do tempo e um
playback do deslocamento.

## Privacidade

Todo o processamento acontece **localmente, no navegador**. Nenhum dado do
arquivo carregado é enviado a servidores. A única exceção é o botão opcional
**"Buscar geolocalização por IP"**, disponível por linha para eventos sem
coordenadas — ao clicar, apenas aquele IP é enviado ao serviço externo
[ipapi.co](https://ipapi.co) para obter uma localização aproximada. Nada
acontece automaticamente.

Anotações, fotos e pontos de interesse também ficam só na memória da aba —
não são salvos em disco nem persistem se a aba for fechada. Se quiser manter
o que anotou, exporte o relatório (PDF/imagem) antes de fechar.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome.
2. Ative o "Modo do desenvolvedor" (canto superior direito).
3. Clique em "Carregar sem compactação" e selecione a pasta deste repositório.
4. Clique no ícone da extensão e depois em "Abrir painel de análise".

## Uso

1. No painel (aberto em uma nova aba), clique em "Adicionar caso (CSV, XLSX ou PDF)".
2. O formato é reconhecido automaticamente pela extensão do nome do arquivo.
3. **Cada arquivo carregado vira um novo caso** na lista "Casos carregados" —
   os anteriores continuam abertos, cada um com sua própria cor no mapa e na
   linha do tempo. Na lista dá para: mostrar/ocultar um caso, marcar qual é o
   "ativo" (o usado no cabeçalho do caso, na reprodução e na exportação) e
   remover um caso.
4. Se um caso (XLSX) trouxer dados do monitorado (nome, CPF, zona de
   exclusão, processo), um cabeçalho aparece no topo quando ele está ativo, e
   o mapa desenha o círculo da zona de exclusão dele (mesmo se não for o
   ativo, contanto que esteja visível).
5. Use os campos "De" / "Até" para restringir o período analisado — o filtro
   vale para todos os casos carregados.
6. O mapa mostra os pontos com geolocalização de cada caso visível, na cor
   dele (vermelho nos pontos/trechos marcados como violação); a linha do
   tempo mostra uma raia por caso visível, cada uma na sua cor.
7. Com 2+ casos visíveis, o painel **"Possíveis encontros entre casos"**
   sinaliza quando pontos de dois casos estiveram próximos no tempo e no
   espaço (até 200m e 10min de diferença, por padrão) — um indício de
   possível conexão entre os monitorados, a ser confirmado por outros meios.
8. Use os controles de reprodução para animar o deslocamento do caso ativo
   no mapa. O orçamento total de tempo do playback é fixo (entre ~20s e
   ~90s, dependendo da quantidade de pontos) e distribuído entre os trechos
   numa escala log do intervalo real — não trava com rastros de centenas de
   pontos por minuto nem passa rápido demais em logs esparsos de dias.
9. "Gerar vídeo do deslocamento" grava a animação do caso ativo como
   `.webm`, desenhando também o círculo da zona de exclusão quando houver.
10. "Exportar relatório (PDF/imagem)" gera um resumo do caso ativo com
    cabeçalho, mapa, contagens, lista de violações/anomalias, narrativa
    automática e anotações (texto e fotos), para anexar a despacho/relatório.
11. Em eventos, violações e possíveis encontros há um botão **"+ nota"** para
    anexar uma anotação de texto e/ou foto (com uma anotação simples em cima —
    caneta ou texto) — útil para registrar confirmações, dúvidas ou evidência
    visual. Um painel **"Anotações"** no fim da página reúne todas, com
    editar/remover.
12. **"Pontos de interesse"**: marque manualmente um local (endereço da
    vítima, do crime etc.) clicando em "+ Adicionar ponto de interesse" e
    depois no mapa — fica visível independente do caso ativo, para comparar
    com o rastro.
13. **"Narrativa automática"**: monta um rascunho cronológico em texto a
    partir das violações, anomalias, encontros e anotações do caso ativo —
    "Gerar narrativa" e "Copiar" para colar num relatório/despacho.
14. **"Locais frequentes (padrão de vida)"**: agrupa por proximidade os
    pontos do caso ativo visitados repetidamente, com uma heurística simples
    de horário (predomínio noturno → possível residência; predomínio diurno
    em dia útil → possível trabalho) — é um indício, não uma identificação
    confirmada, por isso também aceita anotação.

## Formatos de entrada suportados

### XLSX de sistemas de rastreamento de tornozeleira (ex.: SAC24)

Planilha com (idealmente) duas abas, localizadas pelo conteúdo, não pelo nome:

- uma aba de **ficha do monitorado**, em pares rótulo/valor, com campos como
  `Nome Completo:`, `CPF:`, `ID Monitorado:`, `Equipamento:`,
  `Endereço Regulamentado:`, `Raio de Restrição:`, `Latitude de Referência:`,
  `Longitude de Referência:`, `Processo Judicial:` — o que for reconhecido
  vira o cabeçalho do caso e a zona de exclusão no mapa; o que faltar
  simplesmente não aparece, sem quebrar a análise do rastro;
- uma aba de **log de rastreamento**, com uma linha por posição de GPS:
  `Data`, `Hora`, `Latitude`, `Longitude`, `Altitude (m)`, `Logradouro`,
  `Alarme/Status` (`Regular`/`Violação`), `Sinal/Dispositivo`.

Os episódios de violação da zona de exclusão são recalculados a partir do
status `Violação` de cada linha (agrupando trechos consecutivos, tolerando
falhas de sinal de até 3 minutos), não copiados de um resumo em texto que a
planilha porventura já traga — então cobrem violações que uma síntese manual
poderia ter arredondado ou deixado de fora.

### CSV / PDF de logs de acesso/geolocalização genéricos

CSV (ou PDF com texto selecionável, exportado da mesma tabela) com as colunas:

```
account_number, cpf, dt_hr_criacao_utc-3, context_device_model,
sistema_operacional, versao_so, context_latitude, context_longitude,
logical-port-ip, dt_hr_envio_utc-3, acao_evento
```

O parser de PDF localiza o cabeçalho da tabela pelas mesmas colunas e
reconstrói as linhas pela posição horizontal do texto — funciona bem para
PDFs gerados a partir de uma tabela real (texto selecionável), mas **não**
funciona com PDFs escaneados (imagem). Nesse caso, prefira o CSV/XLSX.

Nesse formato (sem zona de exclusão), o painel usa como sinal de anomalia a
velocidade implícita entre dois pontos consecutivos — veja abaixo.

## Detecção de anomalias

- **Com zona de exclusão** (XLSX com coordenadas de referência): anomalia =
  episódio com status `Violação`, agrupado com início/fim/duração/distância
  mínima até a referência.
- **Sem zona de exclusão** (CSV/PDF genérico): um trecho entre dois pontos
  consecutivos é sinalizado quando a velocidade implícita (distância/tempo)
  ultrapassa 250 km/h — indício de possível falha ou burla do dispositivo,
  não uma conclusão definitiva.

## Possíveis conexões entre casos

Com dois ou mais casos visíveis simultaneamente, a extensão procura pares de
pontos (um de cada caso) que estiveram a até 200m de distância e 10min um do
outro, agrupando ocorrências próximas no tempo num único episódio. É apenas
um indício estatístico de coincidência de tempo/local — não é prova de
encontro nem leva em conta contexto (ex.: local público de grande circulação).

## Mapa

Os tiles vêm do tile server padrão do OpenStreetMap (`tile.openstreetmap.org`),
que não exige cadastro nem API key. Se esse provider mudar de política (como a
CARTO fez, que era usada antes e passou a exigir API key nos tiles gratuitos),
troque `TILE_URL`/`TILE_SUBDOMAINS`/`TILE_ATTRIBUTION` em `src/map/mapView.js`
— precisa ser um provider que também libere CORS nos tiles, para que o
exportador de vídeo/relatório consiga ler o mapa de volta via `<canvas>`.

## Fuso horário

Datas/horas dos três formatos são tratadas como horário de Brasília (UTC-3,
sem horário de verão desde 2019) — tanto na exibição quanto nos filtros de
período — independente do fuso configurado no sistema de quem usa a extensão.

## Estrutura do projeto

```
manifest.json          Manifest V3
popup/                 Popup da extensão (só abre o painel numa nova aba)
dashboard/              Painel principal (mapa, linha do tempo, playback)
src/parsers/            Leitura de CSV, XLSX e PDF -> registros normalizados
src/map/                Mapa (Leaflet), zona de exclusão e captura de tiles para vídeo/relatório
src/timeline/           Linha do tempo (canvas)
src/playback/           Controlador de reprodução/animação
src/anomalies/          Detecção de velocidade implausível, violação de zona e conexões entre casos
src/annotations/        Anotações (texto/foto) em memória + modal de nota + editor de foto
src/patterns/           Detecção de locais frequentes (padrão de vida)
src/narrative/          Narrativa automática em texto a partir do que foi calculado
src/report/             Exportação de vídeo e relatório (PDF/imagem)
src/ipgeo/              Geolocalização por IP (opt-in)
lib/                    Bibliotecas de terceiros vendorizadas (Leaflet, PapaParse, pdf.js, SheetJS, jsPDF)
scripts/generate-icons.js  Gera os ícones da extensão (dev-time)
```

## Desenvolvimento

As bibliotecas em `lib/` são copiadas do `node_modules` (não usamos CDN, por
exigência do Manifest V3 / CSP). Para atualizar:

```
npm install
cp node_modules/leaflet/dist/leaflet.{js,css} lib/leaflet/
cp node_modules/papaparse/papaparse.min.js lib/papaparse/
cp node_modules/pdfjs-dist/legacy/build/pdf.min.mjs node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs lib/pdfjs/
cp node_modules/jspdf/dist/jspdf.umd.min.js lib/jspdf/
cp node_modules/xlsx/dist/xlsx.full.min.js lib/xlsx/
```
