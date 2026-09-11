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

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome.
2. Ative o "Modo do desenvolvedor" (canto superior direito).
3. Clique em "Carregar sem compactação" e selecione a pasta deste repositório.
4. Clique no ícone da extensão e depois em "Abrir painel de análise".

## Uso

1. No painel (aberto em uma nova aba), clique em "Carregar arquivo (CSV, XLSX ou PDF)".
2. O formato é reconhecido automaticamente pela extensão do nome do arquivo.
3. Se o arquivo XLSX trouxer dados do monitorado (nome, CPF, zona de exclusão,
   processo), um cabeçalho do caso aparece no topo do painel e o mapa desenha
   o círculo da zona de exclusão.
4. Use os campos "De" / "Até" para restringir o período analisado.
5. O mapa mostra os pontos com geolocalização e o trajeto entre eles (em
   vermelho quando marcados como violação); a linha do tempo mostra todos os
   eventos do período.
6. Use os controles de reprodução para animar o deslocamento no mapa. O
   orçamento total de tempo do playback é fixo (entre ~20s e ~90s,
   dependendo da quantidade de pontos) e distribuído entre os trechos numa
   escala log do intervalo real — não trava com rastros de centenas de
   pontos por minuto nem passa rápido demais em logs esparsos de dias.
7. "Gerar vídeo do deslocamento" grava a animação atual como `.webm`,
   desenhando também o círculo da zona de exclusão quando houver.
8. "Exportar relatório (PDF/imagem)" gera um resumo com o cabeçalho do caso,
   mapa, contagens e a lista de violações/anomalias, para anexar a
   despacho/relatório.

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
src/anomalies/          Detecção de velocidade implausível e de violação de zona
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
