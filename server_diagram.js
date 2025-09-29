// server_diagram.js
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function siteOf(req) { return (req.header('X-Site') || req.query.site || req.body.site || '').toString(); }
const n = (v, d=null) => Number.isFinite(Number(v)) ? Number(v) : d;
const bool = (v, d=false) => (v===true || v==='true' || v==='1') ? true : (v===false || v==='false' || v==='0') ? false : d;

app.get('/api/diagram/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Debug endpoint to quickly see available sites and counts
app.get('/api/diagram/debug', async (req, res) => {
  try {
    const sites = new Set();
    const r1 = await pool.query(`SELECT site, COUNT(*)::int AS boards FROM switchboards GROUP BY site ORDER BY site`);
    const r2 = await pool.query(`SELECT site, COUNT(*)::int AS hv FROM hv_equipments GROUP BY site ORDER BY site`);
    r1.rows.forEach(r => sites.add(r.site));
    r2.rows.forEach(r => sites.add(r.site));
    const list = [...sites];
    const detail = {};
    for (const s of list) {
      const sb = r1.rows.find(x => x.site === s)?.boards || 0;
      const hv = r2.rows.find(x => x.site === s)?.hv || 0;
      const dev = (await pool.query(`SELECT COUNT(*)::int AS c FROM devices WHERE site=$1`, [s])).rows[0].c;
      detail[s] = { switchboards: sb, hv_equipments: hv, devices: dev };
    }
    res.json({ sites: list, detail });
  } catch (e) {
    console.error('[DIAGRAM DEBUG]', e);
    res.status(500).json({ error: 'debug failed', details: e.message });
  }
});

app.get('/api/diagram/view', async (req, res) => {
  try {
    let site = siteOf(req);
    if (!site) {
      try {
        const s1 = await pool.query(`SELECT site FROM switchboards WHERE site IS NOT NULL LIMIT 1`);
        if (s1.rows.length) site = s1.rows[0].site;
        else {
          const s2 = await pool.query(`SELECT site FROM hv_equipments WHERE site IS NOT NULL LIMIT 1`);
          if (s2.rows.length) site = s2.rows[0].site;
        }
      } catch {}
    }
    if (!site) return res.json({ nodes: [], edges: [], warning: 'No site configured / no data found', debug: { site: null } });

    const mode = String(req.query.mode || 'all').toLowerCase();
    const buildingFilter = (req.query.building || '').toString();
    const depth = Math.max(n(req.query.depth, 3) || 3, 1);
    const includeMetrics = bool(req.query.include_metrics, true);
    const rootSwitchId = n(req.query.root_switchboard);
    const rootHvId = n(req.query.root_hv);

    const nodes = [];
    const edges = [];
    const seenNode = new Set();
    const seenEdge = new Set();
    const pushNode = (node) => { if (!seenNode.has(node.id)) { seenNode.add(node.id); nodes.push(node); } };
    const pushEdge = (edge) => { const id = `${edge.source}::${edge.target}::${edge.type || 'default'}`; if (!seenEdge.has(id)) { seenEdge.add(id); edges.push({ animated: true, ...edge }); } };

    let debug = { site, mode, filters: { building: buildingFilter, rootSwitchId, rootHvId }, counts: {} };

    // LV
    if (mode === 'lv' || mode === 'all') {
      let sbWhere = ['site = $1'];
      const sbVals = [site]; let i = 2;
      if (rootSwitchId) { sbWhere.push(`id = $${i++}`); sbVals.push(rootSwitchId); }
      if (buildingFilter) { sbWhere.push(`building_code ILIKE $${i++}`); sbVals.push(`%${buildingFilter}%`); }
      const sbRows = await pool.query(`SELECT id, name, code, building_code, floor, room, regime_neutral, is_principal FROM switchboards WHERE ${sbWhere.join(' AND ')} ORDER BY is_principal DESC, created_at ASC`, sbVals);
      debug.counts.lv_switchboards = sbRows.rowCount;
      const sbIds = sbRows.rows.map(r => r.id);
      if (sbIds.length) {
        const devRows = await pool.query(`SELECT d.*, s.name AS switchboard_name, s.code AS switchboard_code, s.building_code, s.floor, s.room FROM devices d JOIN switchboards s ON d.switchboard_id = s.id WHERE s.site = $1 AND d.switchboard_id = ANY($2::int[]) ORDER BY d.created_at ASC`, [site, sbIds]);
        debug.counts.lv_devices = devRows.rowCount;

        const byId = new Map();
        devRows.rows.forEach(d => byId.set(d.id, d));
        const children = new Map();
        const rootsPerSb = new Map();
        for (const d of devRows.rows) {
          if (d.parent_id && byId.has(d.parent_id)) {
            if (!children.has(d.parent_id)) children.set(d.parent_id, []);
            children.get(d.parent_id).push(d.id);
          } else {
            if (!rootsPerSb.has(d.switchboard_id)) rootsPerSb.set(d.switchboard_id, []);
            rootsPerSb.get(d.switchboard_id).push(d.id);
          }
        }

        for (const sb of sbRows.rows) {
          pushNode({ id: `sb:${sb.id}`, type: 'switchboard', data: { label: `${sb.name} (${sb.code})`, building: sb.building_code || '', floor: sb.floor || '', room: sb.room || '', regime: sb.regime_neutral || '', isPrincipal: !!sb.is_principal }, position: { x: 0, y: 0 } });
        }

        const colWidth = 380, rowHeight = 140;
        for (const sb of sbRows.rows) {
          const roots = rootsPerSb.get(sb.id) || [];
          for (let idx=0; idx<roots.length; idx++) {
            const rid = roots[idx];
            const d = byId.get(rid);
            const nodeId = `dev:${d.id}`;
            pushNode({ id: nodeId, type: 'device', data: { label: d.name || d.reference || d.device_type, device_type: d.device_type, switchboard_id: sb.id, switchboard_name: sb.name, building: d.building_code || sb.building_code || '', isMain: !!d.is_main_incoming }, position: { x: colWidth * 1, y: rowHeight * (idx + 1) } });
            pushEdge({ source: `sb:${sb.id}`, target: nodeId, type: 'smoothstep' });
          }

          const queue = roots.map(id => ({ id, depth: 1, xcol: 2 }));
          const nextRowForCol = { 2: 1, 3: 1, 4: 1, 5: 1 };
          while (queue.length) {
            const { id, depth: dep, xcol } = queue.shift();
            if (dep >= depth) continue;
            const ch = children.get(id) || [];
            for (const cid of ch) {
              const d = byId.get(cid);
              const nodeId = `dev:${d.id}`;
              const r = nextRowForCol[xcol] || 1;
              const pos = { x: colWidth * xcol, y: rowHeight * r };
              nextRowForCol[xcol] = r + 1;
              pushNode({ id: nodeId, type: 'device', data: { label: d.name || d.reference || d.device_type, device_type: d.device_type, switchboard_id: d.switchboard_id, switchboard_name: d.switchboard_name, building: d.building_code || '', isMain: !!d.is_main_incoming }, position: pos });
              pushEdge({ source: `dev:${id}`, target: nodeId, type: 'step' });
              queue.push({ id: cid, depth: dep + 1, xcol: Math.min(xcol + 1, 5) });
            }
          }
        }
      }
    }

    // HV
    if (mode === 'hv' || mode === 'all') {
      let hvWhere = ['site = $1'];
      const hvVals = [site]; let j = 2;
      if (rootHvId) { hvWhere.push(`id = $${j++}`); hvVals.push(rootHvId); }
      if (buildingFilter) { hvWhere.push(`building_code ILIKE $${j++}`); hvVals.push(`%${buildingFilter}%`); }
      const hvRows = await pool.query(`SELECT id, name, code, building_code, floor, room, is_principal FROM hv_equipments WHERE ${hvWhere.join(' AND ')} ORDER BY is_principal DESC, created_at ASC`, hvVals);
      debug.counts.hv_equipments = hvRows.rowCount;
      const hvIds = hvRows.rows.map(r => r.id);
      if (hvIds.length) {
        const devRows = await pool.query(`SELECT d.*, h.name AS hv_name, h.code AS hv_code, h.building_code FROM hv_devices d JOIN hv_equipments h ON d.hv_equipment_id = h.id WHERE h.site = $1 AND d.hv_equipment_id = ANY($2::int[]) ORDER BY d.created_at ASC`, [site, hvIds]);
        debug.counts.hv_devices = devRows.rowCount;

        const byId = new Map();
        devRows.rows.forEach(d => byId.set(d.id, d));
        const children = new Map();
        const rootsPerHv = new Map();
        for (const d of devRows.rows) {
          if (d.parent_id && byId.has(d.parent_id)) {
            if (!children.has(d.parent_id)) children.set(d.parent_id, []);
            children.get(d.parent_id).push(d.id);
          } else {
            if (!rootsPerHv.has(d.hv_equipment_id)) rootsPerHv.set(d.hv_equipment_id, []);
            rootsPerHv.get(d.hv_equipment_id).push(d.id);
          }
        }

        for (const hv of hvRows.rows) {
          pushNode({ id: `hv:${hv.id}`, type: 'hv_equipment', data: { label: `${hv.name} (${hv.code})`, building: hv.building_code || '' }, position: { x: 0, y: 0 } });
        }

        const colWidth = 380, rowHeight = 140;
        for (const hv of hvRows.rows) {
          const roots = rootsPerHv.get(hv.id) || [];
          for (let idx=0; idx<roots.length; idx++) {
            const rid = roots[idx];
            const d = byId.get(rid);
            const nodeId = `hvdev:${d.id}`;
            pushNode({ id: nodeId, type: 'hv_device', data: { label: d.name || d.reference || d.device_type, device_type: d.device_type, hv_equipment_id: d.hv_equipment_id }, position: { x: colWidth, y: rowHeight * (idx + 1) } });
            pushEdge({ source: `hv:${hv.id}`, target: nodeId, type: 'smoothstep' });
          }

          const queue = roots.map(id => ({ id, depth: 1, xcol: 2 }));
          const nextRowForCol = { 2: 1, 3: 1, 4: 1, 5: 1 };
          while (queue.length) {
            const { id, depth: dep, xcol } = queue.shift();
            if (dep >= depth) continue;
            const ch = children.get(id) || [];
            for (const cid of ch) {
              const d = byId.get(cid);
              const nodeId = `hvdev:${d.id}`;
              const r = nextRowForCol[xcol] || 1;
              const pos = { x: colWidth * xcol, y: rowHeight * r };
              nextRowForCol[xcol] = r + 1;
              pushNode({ id: nodeId, type: 'hv_device', data: { label: d.name || d.reference || d.device_type, device_type: d.device_type, hv_equipment_id: d.hv_equipment_id }, position: pos });
              pushEdge({ source: `hvdev:${id}`, target: nodeId, type: 'step' });
              queue.push({ id: cid, depth: dep + 1, xcol: Math.min(xcol + 1, 5) });
            }
          }
        }
      }
    }

    res.json({ nodes, edges, legend: {
      status: { safe: 'Compliant', 'at-risk': 'Non-compliant', incomplete: 'Incomplete / missing data', unknown: 'Unknown' },
      nodeTypes: { switchboard: 'Switchboard (LV)', device: 'Device (LV)', hv_equipment: 'Equipment (HV)', hv_device: 'Device (HV)' }
    }, debug });
  } catch (e) {
    console.error('[DIAGRAM VIEW] error:', e);
    res.status(500).json({ error: 'View failed', details: e.message });
  }
});

const port = process.env.DIAGRAM_PORT || 3010;
app.listen(port, () => console.log(`Diagram server listening on :${port}`));
