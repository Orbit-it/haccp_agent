// Générateur de commandes ESC/POS, standard supporté par la quasi-totalité
// des imprimantes à ticket thermiques (dont les Vretti), qu'elles soient
// connectées en réseau, USB ou Bluetooth (SPP). Le transport est découplé :
// ce module ne fait que produire un Buffer de commandes brutes.

const ESC = 0x1B;
const GS = 0x1D;

const ALIGN = { left: 0, center: 1, right: 2 };

function init() {
  return Buffer.from([ESC, 0x40]); // ESC @
}

function align(mode = 'left') {
  return Buffer.from([ESC, 0x61, ALIGN[mode] ?? 0]); // ESC a n
}

function bold(on) {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]); // ESC E n
}

function doubleSize(on) {
  return Buffer.from([GS, 0x21, on ? 0x11 : 0x00]); // GS ! n (largeur+hauteur x2)
}

function textLine(text = '') {
  return Buffer.concat([Buffer.from(String(text), 'utf8'), Buffer.from([0x0A])]);
}

function feed(lines = 1) {
  return Buffer.from([ESC, 0x64, lines]); // ESC d n
}

function cut() {
  return Buffer.from([GS, 0x56, 0x00]); // GS V 0 : coupe totale
}

// payload attendu :
// {
//   title?: string,
//   lines: [{ text, bold?, align?, big? } | string],
//   feedBefore?: number,
//   feedAfterCut?: number
// }
function buildTicket(payload = {}) {
  const chunks = [init()];

  if (payload.title) {
    chunks.push(align('center'), bold(true), doubleSize(true), textLine(payload.title), doubleSize(false), bold(false), align('left'));
  }

  for (const raw of payload.lines || []) {
    const line = typeof raw === 'string' ? { text: raw } : raw;
    if (line.align) chunks.push(align(line.align));
    if (line.bold) chunks.push(bold(true));
    if (line.big) chunks.push(doubleSize(true));

    chunks.push(textLine(line.text ?? ''));

    if (line.big) chunks.push(doubleSize(false));
    if (line.bold) chunks.push(bold(false));
    if (line.align) chunks.push(align('left'));
  }

  chunks.push(feed(payload.feedAfterCut ?? 3), cut());

  return Buffer.concat(chunks);
}

module.exports = { init, align, bold, doubleSize, textLine, feed, cut, buildTicket };
