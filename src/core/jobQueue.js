const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// File d'impression locale : persistée sur disque pour survivre à un
// redémarrage de l'agent (ex: coupure de courant en plein service), avec
// nouvelle tentative automatique en cas d'échec (imprimante hors tension,
// bourrage papier temporaire, etc.).
class JobQueue extends EventEmitter {
  constructor({ dataDir, logger, processFn, maxAttempts = 5, retryDelayMs = 5000 }) {
    super();
    this.logger = logger;
    this.processFn = processFn;
    this.maxAttempts = maxAttempts;
    this.retryDelayMs = retryDelayMs;
    this.queueFile = path.join(dataDir, 'queue.json');
    this.queue = [];
    this.running = false;

    fs.mkdirSync(dataDir, { recursive: true });
    this._load();
  }

  _load() {
    if (fs.existsSync(this.queueFile)) {
      try {
        this.queue = JSON.parse(fs.readFileSync(this.queueFile, 'utf8'));
        if (this.queue.length) {
          this.logger.info(`${this.queue.length} job(s) rechargé(s) depuis le disque`);
        }
      } catch (error) {
        this.logger.warn('File de jobs illisible, réinitialisation:', error.message);
        this.queue = [];
      }
    }
  }

  _persist() {
    fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
  }

  enqueue(job) {
    this.queue.push({ ...job, attempts: 0, enqueuedAt: Date.now() });
    this._persist();
    this._tick();
  }

  size() {
    return this.queue.length;
  }

  async _tick() {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const job = this.queue[0];
      try {
        const result = await this.processFn(job);
        this.queue.shift();
        this._persist();
        this.emit('success', job, result);
      } catch (error) {
        job.attempts += 1;
        job.lastError = error.message;
        this.logger.warn(`Échec impression job #${job.id} (tentative ${job.attempts}/${this.maxAttempts}): ${error.message}`);

        if (job.attempts >= this.maxAttempts) {
          this.queue.shift();
          this._persist();
          this.emit('failed', job, error);
        } else {
          this._persist();
          // On retente plus tard, sans bloquer le reste de la file :
          // on déplace le job en fin de liste après un court délai.
          this.queue.shift();
          this.queue.push(job);
          this._persist();
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
        }
      }
    }

    this.running = false;
  }
}

module.exports = { JobQueue };
