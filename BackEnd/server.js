require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const showsRoutes = require('./routes/shows');
const catalogRoutes = require('./routes/catalog');

// Limitatori per le rotte sensibili (express-rate-limit).
const { rateLimit } = require('express-rate-limit');

// Limita login, registrazione e reset password per singolo IP.
// Senza limitatore, un utente malevolo può provare centinaia di combinazioni
// al secondo (brute-force) o spammare richieste di email di reset.
// Finestra di 15 minuti: scelta di compromesso tra protezione e usabilità.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  limit: 20,                // massimo 20 richieste per IP nella finestra
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste. Riprova tra qualche minuto.' }
});
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,                 // molto più stretto: ogni richiesta genera una email
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste di reset. Riprova tra qualche minuto.' }
});

const app = express();

// Render (e molti altri host) fanno da proxy davanti a Express: l'IP reale
// del client arriva nell'header X-Forwarded-For. Senza questa riga
// express-rate-limit vedrebbe sempre l'IP del proxy e applicherebbe un unico
// contatore a tutti gli utenti.
app.set('trust proxy', 1);

// CORS: per sicurezza, accettiamo richieste solo dai siti indicati in
// ALLOWED_ORIGINS (es. il tuo indirizzo GitHub Pages), separati da virgola.
// In locale/development, se la variabile e' vuota, accettiamo tutto per comodita'.
// In produzione (NODE_ENV=production) la variabile e' obbligatoria: se manca,
// il CORS e' fail-closed (nessuna origine cross-site e' ammessa) e sul log
// compare un avviso esplicito cosi' sai di dover configurare ALLOWED_ORIGINS su Render.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && allowedOrigins.length === 0) {
  console.warn(
    '[CORS] ALLOWED_ORIGINS non configurata in produzione: le richieste cross-origin verranno bloccate. ' +
    'Imposta ALLOWED_ORIGINS su Render (es. https://tuo-utente.github.io).'
  );
}

app.use(cors({
  origin: function (origin, callback) {
    // Richieste senza header Origin (curl, Postman, navigazione diretta) sempre ammesse.
    if (!origin) return callback(null, true);
    // In locale/development con ALLOWED_ORIGINS vuota, apriamo a tutto per comodita'.
    // In produzione con ALLOWED_ORIGINS vuota, blocchiamo le origini cross-site (fail-closed).
    if (allowedOrigins.length === 0) {
      if (!isProduction) return callback(null, true);
      console.log('Richiesta CORS rifiutata (produzione senza ALLOWED_ORIGINS). Origine:', JSON.stringify(origin));
      const err = new Error('Origine non consentita da CORS: ' + origin);
      err.status = 403;
      return callback(err);
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.log('Richiesta CORS rifiutata. Origine ricevuta:', JSON.stringify(origin), '| Origini consentite:', allowedOrigins);
    const err = new Error('Origine non consentita da CORS: ' + origin);
    err.status = 403;
    callback(err);
  }
}));

// Aumentiamo il limite perché l'avatar (immagine in base64) può pesare qualche centinaio di KB
app.use(express.json({ limit: '5mb' }));

// Rotte sensibili dietro limitatore: login, registrazione e forgot/reset separati
// perché quest'ultime generano email e vanno limitate più strettamente.
app.use('/api/auth/forgot-password', resetLimiter);
app.use('/api/auth/reset-password', resetLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/shows', showsRoutes);
app.use('/api/catalog', catalogRoutes);

app.get('/', (req, res) => {
  res.send('Videoteca API attiva.');
});

// Gestore errori centrale: cattura ogni err re-passato da next(err), anche
// quelli delle promise async avvolte in me.js/shows.js e i rifiuti CORS.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.status === 403) {
    return res.status(403).json({ error: err.message || 'Origine non consentita.' });
  }
  console.error('Errore non gestito nel server:', err);
  res.status(err.status || 500).json({ error: err.message || 'Errore del server.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server avviato sulla porta ' + PORT);
});
