const { createDriver, knownTypes } = require('../drivers');

// Registre en mémoire des imprimantes connues de cet agent, alimenté par le
// message "printers_sync" envoyé par le backend à la connexion (et mis à
// jour au fil des jobs reçus, en filet de sécurité).
class PrinterRegistry {
  constructor(logger) {
    this.logger = logger;
    this.printers = new Map(); // id -> { id, name, driver_type, connection_config }
  }

  sync(printers = []) {
    this.printers.clear();
    for (const printer of printers) {
      this.printers.set(printer.id, printer);
    }
    this.logger.info(`${this.printers.size} imprimante(s) synchronisée(s) depuis le backend`);
  }

  upsert(printer) {
    if (printer && printer.id) this.printers.set(printer.id, printer);
  }

  get(id) {
    return this.printers.get(id);
  }

  list() {
    return [...this.printers.values()];
  }

  getDriverFor(printer) {
    if (!knownTypes().includes(printer.driver_type)) {
      throw new Error(`Type de pilote non supporté par cet agent: "${printer.driver_type}"`);
    }
    return createDriver(printer.driver_type, printer.connection_config || {});
  }
}

module.exports = { PrinterRegistry };
