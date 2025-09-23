import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';
import multer from 'multer';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// CORS
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Utils
function addMonths(dateStr, months = 36) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

// Enhanced Conformité: Parse category from marking and check against zone
function getCategoryFromMarking(ref, type) { // type: 'G' or 'D'
  const upper = (ref || '').toUpperCase();
  const match = upper.match(new RegExp(`II\\s*([1-3])${type}`, 'i'));
  return match ? parseInt(match[1]) : null;
}

function getRequiredCategory(zone, type) { // type: gas or dust
  const z = Number(zone);
  if (type === 'gas') {
    if (z === 0) return 1;
    if (z === 1) return [1, 2];
    if (z === 2) return [1, 2, 3];
  } else if (type === 'dust') {
    if (z === 20) return 1;
    if (z === 21) return [1, 2];
    if (z === 22) return [1, 2, 3];
  }
  return null;
}

function assessCompliance(atex_ref = '', zone_gas = null, zone_dust = null) {
  const ref = (atex_ref || '').toUpperCase();
  const needsGas = [0,1,2].includes(Number(zone_gas));
  const needsDust = [20,21,22].includes(Number(zone_dust));

  // Parse categories
  const catGas = getCategoryFromMarking(ref, 'G');
  const catDust = getCategoryFromMarking(ref, 'D');

  const problems = [];

  // Gas check
  if (needsGas) {
    if (catGas === null) {
      problems.push('No gas category (G) in ATEX marking for gas zone.');
    } else {
      const reqGas = getRequiredCategory(zone_gas, 'gas');
      if (!reqGas.includes(catGas)) {
        problems.push(`Gas category ${catGas}G not suitable for zone ${zone_gas} (requires ${reqGas.join(' or ')}).`);
      }
    }
  }

  // Dust check
  if (needsDust) {
    if (catDust === null) {
      problems.push('No dust category (D) in ATEX marking for dust zone.');
    } else {
      const reqDust = getRequiredCategory(zone_dust, 'dust');
      if (!reqDust.includes(catDust)) {
        problems.push(`Dust category ${catDust}D not suitable for zone ${zone_dust} (requires ${reqDust.join(' or ')}).`);
      }
    }
  }

  return { status: problems.length ? 'Non conforme' : 'Conforme', problems };
}

app.get('/api/atex/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// SUGGESTS
app.get('/api/atex/suggests', async (req, res) => {
  try {
    const fields = ['building','room','component_type','manufacturer','manufacturer_ref','atex_ref'];
    const out = {};
    for (const f of fields) {
      const r = await pool.query(
        `SELECT DISTINCT ${f} FROM atex_equipments WHERE ${f} IS NOT NULL AND ${f}<>'' ORDER BY ${f} ASC LIMIT 200`
      );
      out[f] = r.rows.map(x => x[f]);
    }
    res.json(out);
  } catch (e) {
    console.error('[SUGGESTS] error:', e?.message);
    res.status(500).json({ error: 'Suggests failed' });
  }
});

// Helpers
function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }
function addLikeIn(where, values, i, field, arr) {
  if (!arr.length) return i;
  const slots = arr.map((_,k)=> `$${i + k}`);
  where.push(`${field} IN (${slots.join(',')})`);
  values.push(...arr);
  return i + arr.length;
}

// LIST
async function runListQuery({ whereSql, values, sortSafe, dirSafe, limit, offset }) {
  return pool.query(
    `SELECT * FROM atex_equipments ${whereSql} ORDER BY ${sortSafe} ${dirSafe} LIMIT ${limit} OFFSET ${offset}`,
    values
  );
}

app.get('/api/atex/equipments', async (req, res) => {
  try {
    const { q, sort='id', dir='desc', page='1', pageSize='100' } = req.query;

    const buildings = asArray(req.query.building).filter(Boolean);
    const rooms     = asArray(req.query.room).filter(Boolean);
    const types     = asArray(req.query.component_type).filter(Boolean);
    const mans      = asArray(req.query.manufacturer).filter(Boolean);
    const statuses  = asArray(req.query.status).filter(Boolean);
    const gases     = asArray(req.query.zone_gas).filter(Boolean).map(Number);
    const dusts     = asArray(req.query.zone_dust).filter(Boolean).map(Number);

    const where = [];
    const values = [];
    let i = 1;

    if (q) {
      where.push(`(building ILIKE $${i} OR room ILIKE $${i} OR component_type ILIKE $${i} OR manufacturer ILIKE $${i} OR manufacturer_ref ILIKE $${i} OR atex_ref ILIKE $${i})`);
      values.push(`%${q}%`); i++;
    }
    if (buildings.length) { i = addLikeIn(where, values, i, 'building', buildings); }
    if (rooms.length)     { i = addLikeIn(where, values, i, 'room', rooms); }
    if (types.length)     { i = addLikeIn(where, values, i, 'component_type', types); }
    if (mans.length)      { i = addLikeIn(where, values, i, 'manufacturer', mans); }
    if (statuses.length)  { i = addLikeIn(where, values, i, 'status', statuses); }
    if (gases.length)     { where.push(`zone_gas = ANY($${i}::int[])`); values.push(gases); i++; }
    if (dusts.length)     { where.push(`zone_dust = ANY($${i}::int[])`); values.push(dusts); i++; }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const whitelist = ['id','building','room','component_type','manufacturer','manufacturer_ref','atex_ref','zone_gas','zone_dust','status','last_control','next_control','created_at','updated_at'];
    const sortSafe = whitelist.includes(sort) ? sort : 'id';
    const dirSafe = (String(dir).toLowerCase()==='asc') ? 'ASC' : 'DESC';
    const limit = Math.min(parseInt(pageSize,10)||100, 300);
    const offset = ((parseInt(page,10)||1)-1) * limit;

    try {
      const { rows } = await runListQuery({ whereSql, values, sortSafe, dirSafe, limit, offset });
      return res.json(rows);
    } catch (e) {
      // Fallback si colonne de tri inexistante (ex: updated_at pas migrée)
      const isUnknownColumn = /column .* does not exist/i.test(e?.message || '');
      if (isUnknownColumn && sortSafe !== 'id') {
        console.warn(`[LIST] Unknown sort column "${sortSafe}", falling back to "id"`);
        const { rows } = await runListQuery({ whereSql, values, sortSafe: 'id', dirSafe, limit, offset });
        return res.json(rows);
      }
      throw e;
    }
  } catch (e) {
    console.error('[LIST] error:', e?.message);
    res.status(500).json({ error: 'List failed' });
  }
});

// CREATE
app.post('/api/atex/equipments', async (req, res) => {
  try {
    const {
      site, building, room, component_type, manufacturer, manufacturer_ref,
      atex_ref, zone_gas, zone_dust, last_control, next_control,
      comments, frequency_months
    } = req.body;

    const { status } = assessCompliance(atex_ref, zone_gas, zone_dust);
    const nextCtrl = next_control || addMonths(last_control, frequency_months ? Number(frequency_months) : 36);

    const { rows } = await pool.query(
      `INSERT INTO atex_equipments
       (site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
        zone_gas, zone_dust, status, last_control, next_control, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [site, building, room, component_type, manufacturer, manufacturer_ref, atex_ref,
       zone_gas ?? null, zone_dust ?? null, status, last_control || null, nextCtrl || null,
       comments || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[CREATE] error:', e?.message);
    res.status(500).json({ error: 'Create failed' });
  }
});

// UPDATE
app.put('/api/atex/equipments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const patch = { ...req.body };

    if ('atex_ref' in patch || 'zone_gas' in patch || 'zone_dust' in patch) {
      const cur = await pool.query('SELECT atex_ref, zone_gas, zone_dust FROM atex_equipments WHERE id=$1', [id]);
      const merged = {
        atex_ref: patch.atex_ref ?? cur.rows[0]?.atex_ref,
        zone_gas: patch.zone_gas ?? cur.rows[0]?.zone_gas,
        zone_dust: patch.zone_dust ?? cur.rows[0]?.zone_dust,
      };
      patch.status = assessCompliance(merged.atex_ref, merged.zone_gas, merged.zone_dust).status;
    }

    if (patch.last_control && !patch.next_control) {
      const freq = Number(patch.frequency_months || 36);
      patch.next_control = addMonths(patch.last_control, freq);
      delete patch.frequency_months;
    }

    const keys = Object.keys(patch);
    if (!keys.length) return res.status(400).json({ error: 'No fields to update' });

    const set = keys.map((k,i)=> `${k}=$${i+1}`).join(', ');
    const vals = keys.map(k => patch[k]); vals.push(id);

    const { rows } = await pool.query(`UPDATE atex_equipments SET ${set} WHERE id=$${keys.length+1} RETURNING *`, vals);
    res.json(rows[0]);
  } catch (e) {
    console.error('[UPDATE] error:', e?.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE
app.delete('/api/atex/equipments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_equipments WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE] error:', e?.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ------- Pièces jointes (table atex_attachments) -------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.get('/api/atex/equipments/:id/attachments', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, filename, mimetype, size, created_at FROM atex_attachments WHERE equipment_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('[ATTACH LIST] error:', e?.message);
    res.status(500).json({ error: 'Attachments list failed' });
  }
});

app.post('/api/atex/equipments/:id/attachments', upload.array('files', 12), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });
    const results = [];
    for (const f of req.files) {
      const q = await pool.query(
        'INSERT INTO atex_attachments (equipment_id, filename, mimetype, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mimetype, size, created_at',
        [id, f.originalname, f.mimetype, f.size, f.buffer]
      );
      results.push(q.rows[0]);
    }
    res.status(201).json(results);
  } catch (e) {
    console.error('[ATTACH UPLOAD] error:', e?.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/atex/attachments/:attId/download', async (req, res) => {
  try {
    const r = await pool.query('SELECT filename, mimetype, size, data FROM atex_attachments WHERE id=$1', [req.params.attId]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', row.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
    res.send(Buffer.from(row.data, 'binary'));
  } catch (e) {
    console.error('[ATTACH DL] error:', e?.message);
    res.status(500).json({ error: 'Download failed' });
  }
});

app.delete('/api/atex/attachments/:attId', async (req, res) => {
  try {
    await pool.query('DELETE FROM atex_attachments WHERE id=$1', [req.params.attId]);
    res.json({ success: true });
  } catch (e) {
    console.error('[ATTACH DEL] error:', e?.message);
    res.status(500).json({ error: 'Delete attachment failed' });
  }
});

// ------- Analyse Photo pour auto-remplissage -------
app.post('/api/atex/photo-analysis', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY missing' });

    const base64 = req.file.buffer.toString('base64');

    const prompt = `
Analyze this equipment photo or label. Extract the following information if visible:
- Manufacturer name (e.g., Schneider, Siemens)
- Manufacturer reference or model number (e.g., 218143RT, NSX100F)
- ATEX marking (e.g., II 2G Ex ib IIC T4 Gb, or similar full ATEX certification string)

Be precise and only extract text that matches these fields. If not found or unclear, use null.

Return ONLY a JSON object with keys: manufacturer, manufacturer_ref, atex_ref.
`.trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert in reading equipment labels and ATEX markings. Respond with JSON only.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 200
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[PHOTO ANALYSIS] OpenAI error:', errText);
      return res.status(500).json({ error: 'OpenAI analysis failed', details: errText });
    }

    const json = await resp.json();
    const analysis = json.choices?.[0]?.message?.content?.trim();

    let parsed;
    try {
      parsed = JSON.parse(analysis);
    } catch {
      return res.status(500).json({ error: 'Invalid JSON from analysis' });
    }

    res.json({
      manufacturer: parsed.manufacturer || null,
      manufacturer_ref: parsed.manufacturer_ref || null,
      atex_ref: parsed.atex_ref || null
    });
  } catch (e) {
    console.error('[PHOTO ANALYSIS] error:', e?.message);
    res.status(500).json({ error: 'Photo analysis failed' });
  }
});

// ------- Chat IA -------
app.post('/api/atex/ai/:id', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY manquant' });
    const id = req.params.id;
    const r = await pool.query('SELECT * FROM atex_equipments WHERE id=$1', [id]);
    const eq = r.rows[0]; if (!eq) return res.status(404).json({ error: 'Not found' });

    const prompt = `
You are an ATEX compliance expert. Analyze the equipment's compliance with ATEX standards. Provide a structured response in English:

1) Reasons for non-compliance (if applicable, be specific about marking vs. zone mismatch, protection levels, etc.)

2) Preventive measures

3) Palliative measures

4) Corrective actions

Be concise and accurate. Recall: Gas zones - 0 (most hazardous), 1, 2 (least); Equipment category 1 for all, 2 for 1-2, 3 for 2 only. Similar for dust.

Equipment:
- Building: ${eq.building}
- Room: ${eq.room}
- Type: ${eq.component_type}
- Manufacturer: ${eq.manufacturer}
- Manufacturer Ref: ${eq.manufacturer_ref}
- ATEX Marking: ${eq.atex_ref}
- Gas Zone: ${eq.zone_gas ?? '—'}
- Dust Zone: ${eq.zone_dust ?? '—'}
- Current Status: ${eq.status}
- Last Control: ${eq.last_control ?? '—'}
- Next Control: ${eq.next_control ?? '—'}
`.trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role:'system', content:'You are an ATEX compliance expert. Respond in English only.' },
          { role:'user', content: prompt }
        ]
      })
    });
    if (!resp.ok) return res.status(500).json({ error: 'OpenAI error', details: await resp.text() });
    const json = await resp.json();
    res.json({ analysis: json.choices?.[0]?.message?.content?.trim() || '—' });
  } catch (e) {
    console.error('[AI] error:', e?.message);
    res.status(500).json({ error: 'AI failed' });
  }
});

// ------- ASSESMENT & ANALYTICS -------
app.get('/api/atex/analytics', async (req, res) => {
  try {
    const now = new Date();
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    // Stats de base
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'Conforme' THEN 1 END) as compliant,
        COUNT(CASE WHEN status = 'Non conforme' THEN 1 END) as non_compliant,
        COUNT(CASE WHEN status = 'À vérifier' THEN 1 END) as to_review,
        COUNT(CASE WHEN next_control < $1 THEN 1 END) as overdue,
        COUNT(CASE WHEN next_control >= $1 AND next_control <= $2 THEN 1 END) as due_90_days,
        COUNT(CASE WHEN next_control > $2 THEN 1 END) as future
      FROM atex_equipments
    `, [now.toISOString().slice(0,10), ninetyDaysFromNow.toISOString().slice(0,10)]);

    // Répartition par zone
    const zones = await pool.query(`
      SELECT 
        COALESCE(zone_gas, 0) as gas_zone,
        COALESCE(zone_dust, 0) as dust_zone,
        COUNT(*) as count
      FROM atex_equipments 
      GROUP BY zone_gas, zone_dust 
      ORDER BY gas_zone, dust_zone
    `);

    // Répartition par type d'équipement
    const byType = await pool.query(`
      SELECT component_type, COUNT(*) as count
      FROM atex_equipments 
      GROUP BY component_type 
      ORDER BY count DESC 
      LIMIT 10
    `);

    // Répartition par bâtiment
    const byBuilding = await pool.query(`
      SELECT building, COUNT(*) as count
      FROM atex_equipments 
      WHERE building IS NOT NULL AND building <> ''
      GROUP BY building 
      ORDER BY count DESC 
      LIMIT 10
    `);

    // Équipements à risque (overdue + due dans 90 jours)
    const riskEquipment = await pool.query(`
      SELECT id, component_type, building, room, zone_gas, zone_dust, status, next_control,
             $1::date - next_control::date as days_overdue
      FROM atex_equipments 
      WHERE next_control < $2 OR (next_control >= $1 AND next_control <= $3)
      ORDER BY next_control ASC
      LIMIT 20
    `, [now.toISOString().slice(0,10), now.toISOString().slice(0,10), ninetyDaysFromNow.toISOString().slice(0,10)]);

    // Compliance par zone (détail)
    const complianceByZone = await pool.query(`
      SELECT 
        COALESCE(zone_gas, 0) as zone,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'Conforme' THEN 1 END) as compliant,
        COUNT(CASE WHEN status = 'Non conforme' THEN 1 END) as non_compliant,
        COUNT(CASE WHEN status = 'À vérifier' THEN 1 END) as to_review
      FROM atex_equipments 
      WHERE zone_gas IS NOT NULL 
      GROUP BY zone_gas 
      ORDER BY zone_gas
    `);

    res.json({
      stats: stats.rows[0],
      zones: zones.rows,
      byType: byType.rows,
      byBuilding: byBuilding.rows,
      riskEquipment: riskEquipment.rows,
      complianceByZone: complianceByZone.rows,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] error:', e?.message);
    res.status(500).json({ error: 'Analytics failed' });
  }
});

// ------- EXPORT EXCEL -------
app.get('/api/atex/export', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        COALESCE(site, '') as site,
        COALESCE(building, '') as building,
        COALESCE(room, '') as room,
        COALESCE(component_type, '') as component_type,
        COALESCE(manufacturer, '') as manufacturer,
        COALESCE(manufacturer_ref, '') as manufacturer_ref,
        COALESCE(atex_ref, '') as atex_ref,
        zone_gas,
        zone_dust,
        COALESCE(status, '') as status,
        CASE WHEN last_control IS NOT NULL THEN last_control::text ELSE '' END as last_control,
        CASE WHEN next_control IS NOT NULL THEN next_control::text ELSE '' END as next_control,
        COALESCE(comments, '') as comments,
        CASE WHEN created_at IS NOT NULL THEN created_at::text ELSE '' END as created_at,
        CASE WHEN updated_at IS NOT NULL THEN updated_at::text ELSE '' END as updated_at
      FROM atex_equipments 
      ORDER BY building, room, component_type
    `);

    // Format pour Excel
    const exportData = rows.map(row => ({
      site: row.site,
      building: row.building,
      room: row.room,
      component_type: row.component_type,
      manufacturer: row.manufacturer,
      manufacturer_ref: row.manufacturer_ref,
      atex_ref: row.atex_ref,
      zone_gas: row.zone_gas || '',
      zone_dust: row.zone_dust || '',
      status: row.status,
      last_control: row.last_control ? row.last_control.slice(0,10) : '',
      next_control: row.next_control ? row.next_control.slice(0,10) : '',
      comments: row.comments,
      created_at: row.created_at ? row.created_at.slice(0,19) : '',
      updated_at: row.updated_at ? row.updated_at.slice(0,19) : ''
    }));

    res.json({ data: exportData, columns: Object.keys(exportData[0] || {}) });
  } catch (e) {
    console.error('[EXPORT] error:', e?.message);
    res.status(500).json({ error: 'Export failed: ' + e.message });
  }
});

const port = process.env.ATEX_PORT || 3001;
app.listen(port, () => console.log(`ATEX service listening on :${port}`));
