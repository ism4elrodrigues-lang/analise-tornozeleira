# Análise de Tornozeleira Eletrônica

Extensão Chrome (Manifest V3) para analisar logs de acesso/geolocalização de
monitoramento eletrônico (CSV ou PDF) e gerar mapa, linha do tempo e um
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

1. No painel (aberto em uma nova aba), clique em "Carregar arquivo (CSV ou PDF)".
2. O arquivo é reconhecido automaticamente pela extensão do nome (`.csv`/`.pdf`).
3. Use os campos "De" / "Até" para restringir o período analisado.
4. O mapa mostra os pontos com geolocalização e o trajeto entre eles; a linha
   do tempo mostra todos os eventos (com ou sem geolocalização).
5. Use os controles de reprodução para animar o deslocamento no mapa
   (o ritmo de cada trecho é proporcional ao tempo real decorrido, numa escala
   log para não travar em lacunas de vários dias nem passar rápido demais em
   lacunas de segundos).
6. "Gerar vídeo do deslocamento" grava a animação atual como `.webm`.
7. "Exportar relatório (PDF/imagem)" gera um resumo com mapa, contagens e a
   lista de anomalias, para anexar a despacho/relatório.

## Formato de entrada esperado

CSV (ou PDF com texto selecionável, exportado da mesma tabela) com as colunas:

```
account_number, cpf, dt_hr_criacao_utc-3, context_device_model,
sistema_operacional, versao_so, context_latitude, context_longitude,
logical-port-ip, dt_hr_envio_utc-3, acao_evento
```

O parser de PDF localiza o cabeçalho da tabela pelas mesmas colunas e
reconstrói as linhas pela posição horizontal do texto — funciona bem para
PDFs gerados a partir de uma tabela real (texto selecionável), mas **não**
funciona com PDFs escaneados (imagem). Nesse caso, prefira o CSV.

## Detecção de anomalias

Um trecho entre dois pontos consecutivos é sinalizado quando a velocidade
implícita (distância / tempo) ultrapassa 250 km/h — um indício de possível
falha ou burla do dispositivo, não uma conclusão definitiva.

## Estrutura do projeto

```
manifest.json          Manifest V3
popup/                 Popup da extensão (só abre o painel numa nova aba)
dashboard/              Painel principal (mapa, linha do tempo, playback)
src/parsers/            Leitura de CSV e PDF -> registros normalizados
src/map/                Mapa (Leaflet) e captura de tiles para vídeo/relatório
src/timeline/           Linha do tempo (canvas)
src/playback/           Controlador de reprodução/animação
src/anomalies/          Detecção de deslocamento implausível
src/report/             Exportação de vídeo e relatório (PDF/imagem)
src/ipgeo/              Geolocalização por IP (opt-in)
lib/                    Bibliotecas de terceiros vendorizadas (Leaflet, PapaParse, pdf.js, jsPDF)
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
```
