const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware); // tutte le rotte qui sotto richiedono un login valido

// Express 4 non cattura automaticamente gli errori nelle funzioni async: senza
// try/catch, un problema del database lascerebbe la richiesta appesa fino al
// timeout e genererebbe un "unhandled promise rejection" nei log. Ogni handler
// avvolge il codice in try/catch e risponde sempre con un JSON di errore,
// come già avveniva in routes/auth.js.
function serverError(res, err, label) {
  console.error(label, err);
  res.status(500).json({ error: 'Errore del server. Riprova più tardi.' });
}

// ---- Info account ----
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT username, avatar, settings FROM users WHERE id = $1',
      [req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, err, 'Errore recupero account:');
  }
});

// ---- Cambia username ----
router.patch('/username', async (req, res) => {
  const { newUsername, password } = req.body || {};
  if (!newUsername || !password) {
    return res.status(400).json({ error: 'Compila tutti i campi.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Account non trovato.' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Password non corretta.' });
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND id != $2',
      [newUsername, req.userId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username già in uso.' });
    }

    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, req.userId]);
    res.json({ username: newUsername });
  } catch (err) {
    serverError(res, err, 'Errore cambio username:');
  }
});

// ---- Cambia password ----
router.patch('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Compila tutti i campi.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Account non trovato.' });
    }
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Password attuale non corretta.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err, 'Errore cambio password:');
  }
});

// ---- Avatar (immagine come stringa base64) ----
router.put('/avatar', async (req, res) => {
  try {
    const { avatar } = req.body || {};
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar || null, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err, 'Errore salvataggio avatar:');
  }
});

// ---- Impostazioni (tema, vista, stato preferiti compressi...) ----
router.put('/settings', async (req, res) => {
  try {
    const settings = req.body || {};
    await pool.query('UPDATE users SET settings = $1 WHERE id = $2', [JSON.stringify(settings), req.userId]);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err, 'Errore salvataggio impostazioni:');
  }
});

// ---- Elimina account ----
router.delete('/', async (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Password obbligatoria per confermare.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Account non trovato.' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Password non corretta.' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err, 'Errore eliminazione account:');
  }
});

module.exports = router;
