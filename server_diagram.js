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

// ---- CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Site');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- Helpers
function siteOf(req) {
  return (req.header('X-Site') || req.query.site || req.body.site || '').toString();
}
// small util to coerce numbers
const n = (v, d=null) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const bool = (v, d=false) => {
  if (typeof v === 'boolean') return v;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return d;
};

// ---- Health
app.get('/api/diagram/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Graph builder (LV + HV)
/**
 * Returns a combined graph (nodes, edges) across LV switchboards/devices and HV equipments/devices.
 * Filters:
 *   - mode: 'lv' | 'hv' | 'all'
 *   - building: like filter on building_code
 *   - root_switchboard: focus on this LV board id (optional)
 *   - root_hv: focus on this HV equipment id (optional)
 *   - depth: BFS depth from roots (default 3)
 *   - include_metrics: include status metrics (arcflash/fault/selectivity) (default true)
 */
app.get('/api/diagram/view', async (req, res) => {
  try {
    const site = siteOf(req);
    if (!site) return res.status(400).json({ error: 'Missing site' });

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

    function pushNode(node) {
      const id = node.id;
      if (!seenNode.has(id)) {
        seenNode.add(id);
        nodes.push(node);
      }
    }
    function pushEdge(edge) {
      const id = `${edge.source}::${edge.target}::${edge.type || 'default'}`;
      if (!seenEdge.has(id)) {
        seenEdge.add(id);
        edges.push({ animated: true, ...edge });
      }
    }

    // ---------- LV SECTION ----------
    if (mode === 'lv' || mode === 'all') {
      // Limit to chosen switchboard or by building/site
      let sbWhere = ['site = $1'];
      const sbVals = [site]; let i = 2;
      if (rootSwitchId) { sbWhere.push(`id = $${i++}`); sbVals.push(rootSwitchId); }
      if (buildingFilter) { sbWhere.push(`building_code ILIKE $${i++}`); sbVals.push(`%${buildingFilter}%`); }

      const sbRows = await pool.query(
        `SELECT id, name, code, building_code, floor, room, regime_neutral, is_principal
         FROM switchboards WHERE ${sbWhere.join(' AND ')}
         ORDER BY is_principal DESC, created_at ASC`,
        sbVals
      );

      // Fetch all LV devices for those boards
      const sbIds = sbRows.rows.map(r => r.id);
      if (sbIds.length) {
        const devRows = await pool.query(
          `SELECT d.*, s.name AS switchboard_name, s.code AS switchboard_code, s.building_code, s.floor, s.room
           FROM devices d
           JOIN switchboards s ON d.switchboard_id = s.id
           WHERE s.site = $1 AND d.switchboard_id = ANY($2::int[])
           ORDER BY d.created_at ASC`,
          [site, sbIds]
        );

        // Metrics (optionally)
        let faultMap = new Map(), arcMap = new Map(), selMap = new Map();
        if (includeMetrics) {
          const faults = await pool.query(
            `SELECT device_id, switchboard_id, status, fault_level_ka, phase_type
             FROM fault_checks WHERE site = $1 AND switchboard_id = ANY($2::int[])`,
            [site, sbIds]
          );
          faults.rows.forEach(r => faultMap.set(`${r.device_id}:${r.switchboard_id}`, r));
          const arcs = await pool.query(
            `SELECT device_id, switchboard_id, status, incident_energy, ppe_category
             FROM arcflash_checks WHERE site = $1 AND switchboard_id = ANY($2::int[])`,
            [site, sbIds]
          );
          arcs.rows.forEach(r => arcMap.set(`${r.device_id}:${r.switchboard_id}`, r));
          // selectivity is optional (service might not be running yet)
          try {
            const sels = await pool.query(
              `SELECT upstream_id, downstream_id, status FROM selectivity_checks WHERE site = $1`,
              [site]
            );
            sels.rows.forEach(r => selMap.set(`${r.upstream_id}->${r.downstream_id}`, r.status));
          } catch { /* table may not exist yet */ }
        }

        // Build adjacency
        const byId = new Map();
        devRows.rows.forEach(d => byId.set(d.id, d));
        const children = new Map(); // parent_id -> [childIds]
        const rootsPerSb = new Map(); // sbId -> [root device ids]

        for (const d of devRows.rows) {
          if (d.parent_id && byId.has(d.parent_id)) {
            if (!children.has(d.parent_id)) children.set(d.parent_id, []);
            children.get(d.parent_id).push(d.id);
          } else {
            if (!rootsPerSb.has(d.switchboard_id)) rootsPerSb.set(d.switchboard_id, []);
            rootsPerSb.get(d.switchboard_id).push(d.id);
          }
        }

        // Create switchboard nodes
        for (const sb of sbRows.rows) {
          pushNode({
            id: `sb:${sb.id}`,
            type: 'switchboard',
            data: {
              label: `${sb.name} (${sb.code})`,
              building: sb.building_code || '',
              floor: sb.floor || '',
              room: sb.room || '',
              regime: sb.regime_neutral || '',
              isPrincipal: !!sb.is_principal,
            },
            position: { x: 0, y: 0 },
          });
        }

        // BFS layout per switchboard
        const colWidth = 380;
        const rowHeight = 140;
        for (const sb of sbRows.rows) {
          const roots = rootsPerSb.get(sb.id) || [];
          let col = 1;
          // place roots
          roots.forEach((rid, idx) => {
            const d = byId.get(rid);
            const nodeId = `dev:${d.id}`;
            const positions = { x: colWidth * col, y: rowHeight * (idx + 1) };
            const metrics = includeMetrics ? {
              fault: faultMap.get(`${d.id}:${sb.id}`) || null,
              arc: arcMap.get(`${d.id}:${sb.id}`) || null,
            } : {};
            pushNode({
              id: nodeId,
              type: 'device',
              data: {
                label: d.name || d.reference || d.device_type,
                device_type: d.device_type,
                switchboard_id: sb.id,
                switchboard_name: sb.name,
                building: d.building_code || sb.building_code || '',
                metrics,
                isMain: !!d.is_main_incoming,
              },
              position: positions,
            });
            pushEdge({ source: `sb:${sb.id}`, target: nodeId, type: 'smoothstep' });
          });

          // BFS
          const queue = roots.map(id => ({ id, depth: 1, xcol: 2 }));
          const nextRowForCol = { 2: 1, 3: 1, 4: 1, 5: 1 };
          while (queue.length) {
            const { id, depth: dep, xcol } = queue.shift();
            if (dep >= depth) continue;
            const ch = children.get(id) || [];
            ch.forEach(cid => {
              const d = byId.get(cid);
              const nodeId = `dev:${d.id}`;
              const r = nextRowForCol[xcol] || 1;
              const pos = { x: colWidth * xcol, y: rowHeight * r };
              nextRowForCol[xcol] = r + 1;

              const metrics = includeMetrics ? {
                fault: faultMap.get(`${d.id}:${d.switchboard_id}`) || null,
                arc: arcMap.get(`${d.id}:${d.switchboard_id}`) || null,
              } : {};

              pushNode({
                id: nodeId,
                type: 'device',
                data: {
                  label: d.name || d.reference || d.device_type,
                  device_type: d.device_type,
                  switchboard_id: d.switchboard_id,
                  switchboard_name: d.switchboard_name,
                  building: d.building_code || '',
                  metrics,
                  isMain: !!d.is_main_incoming,
                },
                position: pos,
              });
              pushEdge({ source: `dev:${id}`, target: nodeId, type: 'step' });

              // downstream to other switchboard
              if (d.downstream_switchboard_id) {
                const dsw = sbRows.rows.find(sx => sx.id === d.downstream_switchboard_id);
                // If downstream board isn't in initial selection, fetch minimal info
                let targetBoard = dsw;
                if (!targetBoard) {
                  const r = await pool.query(
                    `SELECT id, name, code, building_code FROM switchboards WHERE id = $1 AND site=$2`,
                    [d.downstream_switchboard_id, site]
                  );
                  if (r.rows.length) targetBoard = r.rows[0];
                }
                if (targetBoard) {
                  pushNode({
                    id: `sb:${targetBoard.id}`,
                    type: 'switchboard',
                    data: {
                      label: `${targetBoard.name} (${targetBoard.code})`,
                      building: targetBoard.building_code || '',
                    },
                    position: { x: colWidth * (xcol + 1), y: rowHeight }, // hint position
                  });

                  const inter = (targetBoard.building_code || '') !== (d.building_code || sb.building_code || '');
                  pushEdge({
                    source: nodeId,
                    target: `sb:${targetBoard.id}`,
                    type: inter ? 'default' : 'smoothstep',
                    label: inter ? '↪ inter-building' : undefined,
                    style: inter ? { strokeDasharray: '6 4' } : undefined
                  });
                }
              }

              queue.push({ id: cid, depth: dep + 1, xcol: Math.min(xcol + 1, 5) });
            });
          }
        }
      }
    }

    // ---------- HV SECTION ----------
    if (mode === 'hv' || mode === 'all') {
      let hvWhere = ['site = $1'];
      const hvVals = [site]; let j = 2;
      if (rootHvId) { hvWhere.push(`id = $${j++}`); hvVals.push(rootHvId); }
      if (buildingFilter) { hvWhere.push(`building_code ILIKE $${j++}`); hvVals.push(`%${buildingFilter}%`); }

      const hvRows = await pool.query(
        `SELECT id, name, code, building_code, floor, room, is_principal
         FROM hv_equipments WHERE ${hvWhere.join(' AND ')}
         ORDER BY is_principal DESC, created_at ASC`,
        hvVals
      );

      const hvIds = hvRows.rows.map(r => r.id);
      if (hvIds.length) {
        const devRows = await pool.query(
          `SELECT d.*, h.name AS hv_name, h.code AS hv_code, h.building_code
           FROM hv_devices d
           JOIN hv_equipments h ON d.hv_equipment_id = h.id
           WHERE h.site = $1 AND d.hv_equipment_id = ANY($2::int[])
           ORDER BY d.created_at ASC`,
          [site, hvIds]
        );

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

        // equipment nodes
        for (const hv of hvRows.rows) {
          const nodeId = `hv:${hv.id}`;
          pushNode({
            id: nodeId,
            type: 'hv_equipment',
            data: {
              label: `${hv.name} (${hv.code})`,
              building: hv.building_code || '',
            },
            position: { x: 0, y: 0 },
          });
        }

        const colWidth = 380;
        const rowHeight = 140;
        for (const hv of hvRows.rows) {
          const roots = rootsPerHv.get(hv.id) || [];
          roots.forEach((rid, idx) => {
            const d = byId.get(rid);
            const nodeId = `hvdev:${d.id}`;
            pushNode({
              id: nodeId,
              type: 'hv_device',
              data: {
                label: d.name || d.reference || d.device_type,
                device_type: d.device_type,
                hv_equipment_id: d.hv_equipment_id,
              },
              position: { x: colWidth, y: rowHeight * (idx + 1) },
            });
            pushEdge({ source: `hv:${hv.id}`, target: nodeId, type: 'smoothstep' });
          });

          const queue = roots.map(id => ({ id, depth: 1, xcol: 2 }));
          const nextRowForCol = { 2: 1, 3: 1, 4: 1, 5: 1 };
          while (queue.length) {
            const { id, depth: dep, xcol } = queue.shift();
            if (dep >= depth) continue;
            const ch = children.get(id) || [];
            ch.forEach(cid => {
              const d = byId.get(cid);
              const nodeId = `hvdev:${d.id}`;
              const r = nextRowForCol[xcol] || 1;
              const pos = { x: colWidth * xcol, y: rowHeight * r };
              nextRowForCol[xcol] = r + 1;

              pushNode({
                id: nodeId,
                type: 'hv_device',
                data: {
                  label: d.name || d.reference || d.device_type,
                  device_type: d.device_type,
                  hv_equipment_id: d.hv_equipment_id,
                },
                position: pos,
              });
              pushEdge({ source: `hvdev:${id}`, target: nodeId, type: 'step' });

              // Cross-link to other HV equipment
              if (d.downstream_hv_equipment_id) {
                pushNode({ id: `hv:${d.downstream_hv_equipment_id}`, type: 'hv_equipment', data: { label: `HV #${d.downstream_hv_equipment_id}` }, position: { x: colWidth * (xcol + 1), y: rowHeight } });
                pushEdge({ source: nodeId, target: `hv:${d.downstream_hv_equipment_id}`, type: 'default', label: '↪ downstream HV' });
              }

              queue.push({ id: cid, depth: dep + 1, xcol: Math.min(xcol + 1, 5) });
            });
          }
        }
      }
    }

    res.json({ nodes, edges, legend: {
      status: {
        safe: 'Conforme',
        'at-risk': 'Non conforme',
        incomplete: 'Incomplet / données manquantes',
        unknown: 'Inconnu'
      },
      nodeTypes: {
        switchboard: 'Tableau (BT)',
        device: 'Appareil (BT)',
        hv_equipment: 'Équipement (HT)',
        hv_device: 'Appareil (HT)'
      }
    }});
  } catch (e) {
    console.error('[DIAGRAM VIEW] error:', e.message, e.stack);
    res.status(500).json({ error: 'View failed', details: e.message });
  }
});

const port = process.env.DIAGRAM_PORT || 3010;
app.listen(port, () => console.log(`Diagram server listening on :${port}`));
