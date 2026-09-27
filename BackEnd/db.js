// Gestisce la connessione al database PostgreSQL.
// La stringa di connessione arriva da una variabile d'ambiente (DATABASE_URL),
// così non la scriviamo mai direttamente nel codice.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Verifichiamo il certificato del server (protezione dagli attacchi
  // man-in-the-middle). Neon emette certificati firmati da una CA pubblica
  // già fidata dal trust store di Node, quindi la verifica funziona senza
  // configurazioni extra. Solo se il tuo ambiente non include le CA pubbliche
  // (es. build Docker minimalista) fallisce la connessione: in quel raro caso
  // imposta DATABASE_SSL_INSECURE=true per ripristinare il comportamento
  // permissivo (disattiva solo la verifica del certificato, la connessione resta
  // comunque cifrata).
  ssl:
    process.env.DATABASE_SSL_INSECURE === 'true'
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true }
});

module.exports = pool;
