// server_atex.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';

// OpenAI via fetch (Node 18+)
import crypto from 'crypto';

dotenv.config();
const { Pool } = pg;

// --- Neon connection (même variable que ton serveur global) ---
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// --- App ---
const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// --- CORS: autorise le front (Vite en dev, Render en prod) ---
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// --- Utils ---
function addMonths(dateStr, months = 36) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Vérification simplifiée de conformité:
// - Si zone_gas existe (0,1,2) on attend un marquage "G" dans atex_ref.
// - Si zone_dust existe (20,21,22) on attend un marquage "D" dans atex_ref.
// (Règle simple pour démarrer; affinera plus tard.)
function assessCompliance(atex_ref = '', zone_gas = null, zone_dust = null) {
  const ref = (atex_ref || '').toUpperCase();
  const needsG = zone_gas === 0 || zone_gas === 1 || zone_gas === 2;
  const needsD = zone_dust === 20 || zone_dust === 21 || zone_dust === 22;

  const hasG = ref.includes(' G') || ref.includes('G ');
  const hasD = ref.includes(' D') || ref.includes('D ');

  const problems = [];
  if (needsG && !hasG) problems.push('Marquage gaz (G) manquant pour une zone gaz.');
  if (needsD && !hasD) problems.push('Marquage poussières (D) manquant pour une zone poussières.');

  let status = 'Conforme';
  if (problems.length) status = 'Non conforme';
  return { status, problems };
}

// --- Health ---
app.get('/api/atex/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// --- LIST avec filtres, tri, pagination ---
app.get('/api/atex/equipments', async (req, res) => {
  try {
    const {
      q, building, room, component_type, manufacturer, status,
      zone_gas, zone_dust,
      sort = 'updated_at', dir = 'desc',
      page = '1', pageSize = '50'
    } = req.query;

    const clauses = [];
    const values = [];
    let idx = 1;

    function addClause(sql, v) { clauses.push(sql); values.push(v); idx += 1; }

    if (q) {
      addClause(
        `(building ILIKE $${idx} OR room ILIKE $${idx} OR component_type ILIKE $${idx} OR manufacturer ILIKE $${idx} OR manufacturer_ref ILIKE $${idx} OR atex_ref ILIKE $${idx})`,
        `%${q}%`
      );
    }
    if (building) addClause(`building ILIKE $${idx}`, `%${building}%`);
    if (room) addClause(`room ILIKE $${idx}`, `%${room}%`);
    if (component_type) addClause(`component_type ILIKE $${idx}`, `%${component_type}%`);
    if (manufacturer) addClause(`manufacturer ILIKE $${idx}`, `%${manufacturer}%`);
    if (status) addClause(`status = $${idx}`, status);
    if (zone_gas) addClause(`zone_gas = $${idx}`, Number(zone_gas));
    if (zone_dust) addClause(`zone_dust = $${idx}`, Number(zone_dust));

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sortSafe = ['building','room','component_type','manufacturer','manufacturer_ref',
      'atex_ref','zone_gas','zone_dust','status','last_control','next_control','updated_at','created_at'
    ].includes(sort) ? sort : 'updated_at';
    const dirSafe = (String(dir).toLowerCase() === 'asc') ? 'ASC' : 'DESC';

    const limit = Math.min(parseInt(pageSize,10)||50, 200);
    const offset = ((parseInt(page,10)||1) - 1) * limit;

    const sql = `
      SELECT * FROM atex_equipments
      ${where}
      ORDER BY ${sortSafe} ${dirSafe}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const { rows } = await pool.query(sql, values);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'List failed' });
  }
});

// --- CREATE ---
app.post('/api/atex/equipments', async (req, res) => {
  try {
    const {
      site, building, room, component_type, manufacturer, manufacturer_ref,
      atex_ref, zone_gas, zone_dust, last_control, next_control,
      comments, attachments, frequency_months
    } = req.body;

    // Conformité auto (simple)
    const { status } = assessCompliance(atex_ref, zone_gas, zone_dust);
    const nextCtrl = next_control || addMonths(last_control, frequency_months ? Number(frequency_months) : 36);

    const { rows } = await pool.query(
      `INSERT INTO atex_equipments
       (site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
        zone_gas, zone_dust, status, last_control, next_control, comments, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
       zone_gas ?? null, zone_dust ?? null, status, last_control || null, nextCtrl || null,
       comments || null, attachments || []]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Create failed' });
  }
});

// --- UPDATE ---
app.put('/api/atex/equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const patch = { ...req.body };

    // Si atex_ref / zones changent, recalcule statut
    if ('atex_ref' in patch || 'zone_gas' in patch || 'zone_dust' in patch) {
      const current = await pool.query('SELECT atex_ref, zone_gas, zone_dust FROM atex_equipments WHERE id=$1', [id]);
      const merged = {
        atex_ref: patch.atex_ref ?? current.rows[0]?.atex_ref,
        zone_gas: patch.zone_gas ?? current.rows[0]?.zone_gas,
        zone_dust: patch.zone_dust ?? current.rows[0]?.zone_dust,
      };
      patch.status = assessCompliance(merged.atex_ref, merged.zone_gas, merged.zone_dust).status;
    }

    // Si last_control sans next_control => recalcule next_control
    if (patch.last_control && !patch.next_control) {
      const freq = Number(patch.frequency_months || 36);
      patch.next_control = addMonths(patch.last_control, freq);
      delete patch.frequency_months;
    }

    const keys = Object.keys(patch);
    if (!keys.length) return res.status(400).json({ error: 'No fields to update' });

    const set = keys.map((k,i)=> `${k}=$${i+1}`).join(', ');
    const values = keys.map(k => patch[k]);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE atex_equipments SET ${set} WHERE id=$${keys.length+1} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Update failed' });
  }
});

// --- DELETE ---
app.delete('/api/atex/equipments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_equipments WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// --- Chat IA: diagnostic non-conformité / mesures ---
// Retourne un texte d’analyse basé sur l’équipement + marquage.
app.post('/api/atex/ai/:id', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OPENAI_API_KEY manquant' });
    }
    const id = req.params.id;
    const { rows } = await pool.query('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    const eq = rows[0];
    const prompt = `
Tu es expert ATEX. Analyse la conformité de cet équipement puis liste:
1) Pourquoi non conforme (si applicable), 2) Mesures préventives, 3) Mesures palliatives, 4) Mesures correctives.
Donne des conseils concrets et pragmatiques. Reste concis.

Équipement:
- Bâtiment: ${eq.building}
- Local: ${eq.room}
- Type de composant: ${eq.component_type}
- Fabricant: ${eq.manufacturer}
- Réf fabricant: ${eq.manufacturer_ref}
- Marquage ATEX: ${eq.atex_ref}
- Zone gaz: ${eq.zone_gas ?? '—'}
- Zone poussières: ${eq.zone_dust ?? '—'}
- Statut: ${eq.status}
- Dernier contrôle: ${eq.last_control ?? '—'}
- Prochain contrôle: ${eq.next_control ?? '—'}
    `.trim();

    const body = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Tu es un expert en conformité ATEX.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ error: 'OpenAI error', details: t.slice(0,800) });
    }
    const json = await r.json();
    const text = json.choices?.[0]?.message?.content?.trim() || 'Pas de réponse.';
    res.json({ analysis: text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'AI failed' });
  }
});

// --- Start ---
const port = process.env.ATEX_PORT || 3001;
app.listen(port, () => console.log(`ATEX service listening on :${port}`));
