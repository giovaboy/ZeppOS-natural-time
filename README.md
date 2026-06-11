# Natural Time — ZeppOS watchface

Quadrante analogico a 360° basato su [natural-time](https://github.com/sylvain441/natural-time):
il "sole" compie un giro al giorno (mezzanotte in basso, mezzogiorno in alto),
colorato secondo il giorno della settimana naturale. Al centro: gradi naturali,
data naturale (`anno)luna)giorno`) e fuso NT.

Il motore (`utils/natural-time.js`) è un port senza dipendenze di
natural-time-js: la ricerca del solstizio di dicembre è sostituita da una
tabella precalcolata (2012–2055), validata byte-identical contro la libreria
originale.

## Struttura

- `app.js` — entry point applicazione (vuoto, come da template watchface)
- `watchface/index.js` — UI del quadrante
- `utils/natural-time.js` — motore di calcolo (puro JS, testabile con Node)
- `assets/<target>/icon.png` — icona per ogni target

## Longitudine

Il tempo naturale dipende dalla longitudine. All'avvio il quadrante usa:
1. l'ultima longitudine salvata (`localStorage`), da GPS o impostata a mano;
2. altrimenti il meridiano centrale del fuso orario del dispositivo
   (approssimazione di primo avvio: include l'ora legale, quindi in estate
   in Italia mostra NT+30 invece di NT+15).

**Impostazione** — la riga `NT±x` in basso ha tre zone di tocco invisibili:
- **sinistra / destra**: regola la zona NT di ∓1°/±1° (salvata in modo persistente);
- **centro**: reset al meridiano del fuso orario.

Niente GPS: `Geolocation.start()` dentro un watchface manda in crash il
firmware (riavvio del dispositivo, osservato su ZeppOS 3.x), quindi la
longitudine si imposta solo manualmente.

## Build

Richiede [Zeus CLI](https://docs.zepp.com/docs/guides/tools/cli/) (installato in `~/.local/node`):

```bash
zeus build      # produce dist/*.zab
```

## Test su dispositivo

```bash
zeus login      # una tantum, account Zepp
zeus preview    # QR code da scansionare con l'app Zepp (Profilo → dispositivo → scansione)
```

In alternativa `zeus dev` per il simulatore, o `zeus bridge` per log dal dispositivo reale.

## Test del motore

```bash
node --input-type=module -e "
import { computeNaturalDate, formatDate, formatTime } from './utils/natural-time.js';
const nd = computeNaturalDate(Date.now(), 9);
console.log(formatDate(nd), formatTime(nd));
"
```
