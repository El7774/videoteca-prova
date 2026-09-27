const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// Express 4 non cattura automaticamente gli errori nelle funzioni async: senza
// try/catch, un problema del database lascerebbe la richiesta appesa fino al
// timeout. Gli errori vengono gestiti esplicitamente come già avveniva in
// routes/auth.js.
function serverError(res, err, label) {
  console.error(label, err);
  res.status(500).json({ error: 'Errore del server. Riprova più tardi.' });
}

// Restituisce l'intera collezione dell'utente loggato
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT shows FROM users WHERE id = $1', [req.userId]);
    res.json(result.rows[0] ? result.rows[0].shows : []);
  } catch (err) {
    serverError(res, err, 'Errore lettura collezione:');
  }
});

// Sovrascrive l'intera collezione con quella ricevuta.
// Rispecchia esattamente come il frontend già lavora: mantiene l'intero
// array "shows" in memoria e lo salva per intero a ogni modifica.
router.put('/', async (req, res) => {
  const shows = req.body;
  if (!Array.isArray(shows)) {
    return res.status(400).json({ error: 'Formato non valido: attesa una lista di titoli.' });
  }

  try {
    await pool.query('UPDATE users SET shows = $1 WHERE id = $2', [JSON.stringify(shows), req.userId]);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err, 'Errore salvataggio collezione:');
  }
});

module.exports = router;
