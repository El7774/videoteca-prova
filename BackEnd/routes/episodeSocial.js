const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function serverError(res, err, label) {
  console.error(label, err);
  res.status(500).json({ error: 'Errore del server. Riprova più tardi.' });
}

// Assicura che le tabelle esistano (idempotente, eseguita al primo import)
async function ensureTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS episode_comments (
        id SERIAL PRIMARY KEY,
        tmdb_id INTEGER NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_episode_comments_lookup ON episode_comments (tmdb_id, media_type, season, episode);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS episode_likes (
        id SERIAL PRIMARY KEY,
        tmdb_id INTEGER NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tmdb_id, media_type, season, episode, user_id)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_episode_likes_lookup ON episode_likes (tmdb_id, media_type, season, episode);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_episode_likes_user ON episode_likes (user_id);`);
  } catch (e) {
    console.error('Errore creazione tabelle episode_social:', e);
  }
}
ensureTables();

// Validazione comune
function parseEpisodeParams(q) {
  const tmdbId = parseInt(q.tmdbId, 10);
  const mediaType = q.mediaType === 'movie' ? 'movie' : q.mediaType === 'tv' ? 'tv' : null;
  const season = parseInt(q.season, 10);
  const episode = parseInt(q.episode, 10);
  if (!tmdbId || !mediaType || Number.isNaN(season) || Number.isNaN(episode)) return null;
  if (season < 0 || episode < 1) return null;
  return { tmdbId, mediaType, season, episode };
}

// GET /api/episode-social/comments?tmdbId=&mediaType=&season=&episode=
router.get('/comments', async (req, res) => {
  const p = parseEpisodeParams(req.query);
  if (!p) return res.status(400).json({ error: 'Parametri episodio mancanti o non validi.' });
  try {
    const r = await pool.query(
      `SELECT id, username, body, created_at FROM episode_comments
       WHERE tmdb_id=$1 AND media_type=$2 AND season=$3 AND episode=$4
       ORDER BY created_at DESC LIMIT 100`,
      [p.tmdbId, p.mediaType, p.season, p.episode]
    );
    res.json(r.rows);
  } catch (err) {
    serverError(res, err, 'Errore lettura commenti:');
  }
});

// POST /api/episode-social/comments  { tmdbId, mediaType, season, episode, body }
router.post('/comments', async (req, res) => {
  const { tmdbId, mediaType, season, episode, body } = req.body || {};
  const tmdbIdNum = parseInt(tmdbId, 10);
  const seasonNum = parseInt(season, 10);
  const episodeNum = parseInt(episode, 10);
  const mt = mediaType === 'movie' ? 'movie' : mediaType === 'tv' ? 'tv' : null;
  const text = typeof body === 'string' ? body.trim() : '';
  if (!tmdbIdNum || !mt || Number.isNaN(seasonNum) || Number.isNaN(episodeNum) || !text) {
    return res.status(400).json({ error: 'Dati mancanti o non validi.' });
  }
  if (text.length > 500) return res.status(400).json({ error: 'Il commento non può superare 500 caratteri.' });
  if (text.length < 2) return res.status(400).json({ error: 'Scrivi almeno 2 caratteri.' });
  try {
    // Recupera username corrente per denormalizzazione (evita join)
    const u = await pool.query('SELECT username FROM users WHERE id=$1', [req.userId]);
    if (!u.rows[0]) return res.status(404).json({ error: 'Utente non trovato.' });
    const username = u.rows[0].username;
    const ins = await pool.query(
      `INSERT INTO episode_comments (tmdb_id, media_type, season, episode, user_id, username, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, username, body, created_at`,
      [tmdbIdNum, mt, seasonNum, episodeNum, req.userId, username, text]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    serverError(res, err, 'Errore creazione commento:');
  }
});

// POST /api/episode-social/like  { tmdbId, mediaType, season, episode }  -> toggle
router.post('/like', async (req, res) => {
  const { tmdbId, mediaType, season, episode } = req.body || {};
  const tmdbIdNum = parseInt(tmdbId, 10);
  const seasonNum = parseInt(season, 10);
  const episodeNum = parseInt(episode, 10);
  const mt = mediaType === 'movie' ? 'movie' : mediaType === 'tv' ? 'tv' : null;
  if (!tmdbIdNum || !mt || Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) {
    return res.status(400).json({ error: 'Dati episodio mancanti.' });
  }
  try {
    const existing = await pool.query(
      `SELECT id FROM episode_likes WHERE tmdb_id=$1 AND media_type=$2 AND season=$3 AND episode=$4 AND user_id=$5`,
      [tmdbIdNum, mt, seasonNum, episodeNum, req.userId]
    );
    let liked;
    if (existing.rows.length) {
      await pool.query(`DELETE FROM episode_likes WHERE id=$1`, [existing.rows[0].id]);
      liked = false;
    } else {
      await pool.query(
        `INSERT INTO episode_likes (tmdb_id, media_type, season, episode, user_id) VALUES ($1,$2,$3,$4,$5)`,
        [tmdbIdNum, mt, seasonNum, episodeNum, req.userId]
      );
      liked = true;
    }
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM episode_likes WHERE tmdb_id=$1 AND media_type=$2 AND season=$3 AND episode=$4`,
      [tmdbIdNum, mt, seasonNum, episodeNum]
    );
    res.json({ liked, likes: cnt.rows[0].c });
  } catch (err) {
    // Duplicate race
    if (err.code === '23505') {
      try {
        const cnt2 = await pool.query(
          `SELECT COUNT(*)::int AS c FROM episode_likes WHERE tmdb_id=$1 AND media_type=$2 AND season=$3 AND episode=$4`,
          [tmdbIdNum, mt, seasonNum, episodeNum]
        );
        return res.json({ liked: true, likes: cnt2.rows[0].c });
      } catch (e) { return serverError(res, e, 'Errore like race:'); }
    }
    serverError(res, err, 'Errore toggle like:');
  }
});

// GET /api/episode-social/like-status?tmdbId=&mediaType=&season=&episode=
router.get('/like-status', async (req, res) => {
  const p = parseEpisodeParams(req.query);
  if (!p) return res.status(400).json({ error: 'Parametri episodio mancanti.' });
  try {
    const [cnt, mine, cmt] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM episode_likes WHERE tmdb_id=$1 AND media_type=$2 AND season=$3 AND episode=$4`, [p.tmdbId, p.mediaType, p.season, p.episode]),
      pool.query(`SELECT 1 FROM episode_likes WHERE tmdb_id=$1 AND media_type=$2 AND season=$3 AND episode=$4 AND user_id=$5`, [p.tmdbId, p.mediaType, p.season, p.episode, req.userId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM episode_comments WHERE tmdb_id=$1 AND media_type=$2 AND season=$3 AND episode=$4`, [p.tmdbId, p.mediaType, p.season, p.episode])
    ]);
    res.json({ likes: cnt.rows[0].c, liked: mine.rows.length > 0, comments: cmt.rows[0].c });
  } catch (err) {
    serverError(res, err, 'Errore like-status:');
  }
});

// GET /api/episode-social/stats?tmdbId=&mediaType=
router.get('/stats', async (req, res) => {
  const tmdbId = parseInt(req.query.tmdbId, 10);
  const mediaType = req.query.mediaType === 'movie' ? 'movie' : req.query.mediaType === 'tv' ? 'tv' : null;
  if (!tmdbId || !mediaType) return res.status(400).json({ error: 'Parametri mancanti.' });
  try {
    const [likesByEp, commentsByEp] = await Promise.all([
      pool.query(
        `SELECT season, episode, COUNT(*)::int AS likes
         FROM episode_likes WHERE tmdb_id=$1 AND media_type=$2
         GROUP BY season, episode ORDER BY season, episode`,
        [tmdbId, mediaType]
      ),
      pool.query(
        `SELECT season, episode, COUNT(*)::int AS comments
         FROM episode_comments WHERE tmdb_id=$1 AND media_type=$2
         GROUP BY season, episode ORDER BY season, episode`,
        [tmdbId, mediaType]
      )
    ]);

    // Unisci per episodio
    const map = new Map();
    likesByEp.rows.forEach(r => {
      const k = r.season + ':' + r.episode;
      map.set(k, { season: r.season, episode: r.episode, likes: r.likes, comments: 0 });
    });
    commentsByEp.rows.forEach(r => {
      const k = r.season + ':' + r.episode;
      const cur = map.get(k) || { season: r.season, episode: r.episode, likes: 0, comments: 0 };
      cur.comments = r.comments;
      map.set(k, cur);
    });
    const perEpisode = Array.from(map.values()).sort((a,b)=> a.season-b.season || a.episode-b.episode);

    // Aggrega per stagione
    const perSeasonMap = new Map();
    perEpisode.forEach(e => {
      const cur = perSeasonMap.get(e.season) || { season: e.season, likes: 0, comments: 0, episodes: 0 };
      cur.likes += e.likes;
      cur.comments += e.comments;
      cur.episodes += 1;
      perSeasonMap.set(e.season, cur);
    });
    const perSeason = Array.from(perSeasonMap.values()).sort((a,b)=> a.season-b.season);

    const totalLikes = perEpisode.reduce((s,e)=>s+e.likes,0);
    const totalComments = perEpisode.reduce((s,e)=>s+e.comments,0);

    res.json({ tmdbId, mediaType, totalLikes, totalComments, perEpisode, perSeason });
  } catch (err) {
    serverError(res, err, 'Errore stats:');
  }
});

// DELETE commento proprio (opzionale)
router.delete('/comments/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID non valido.' });
  try {
    const r = await pool.query(`SELECT user_id FROM episode_comments WHERE id=$1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Commento non trovato.' });
    if (r.rows[0].user_id !== req.userId) return res.status(403).json({ error: 'Non puoi eliminare questo commento.' });
    await pool.query(`DELETE FROM episode_comments WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err, 'Errore delete commento:');
  }
});

module.exports = router;
