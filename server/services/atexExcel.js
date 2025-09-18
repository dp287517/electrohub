import ExcelJS from 'exceljs';

export async function buildTemplateBuffer(){
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ATEX Import');
  const headers = ['reference','brand','designation','atex_reference','marking','building','room','zone_gas','zone_dust','category_g','category_d','last_inspection_date','comments'];
  ws.addRow(headers);
  headers.forEach((h,i)=> ws.getColumn(i+1).width = Math.max(12, h.length+2));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function parseImportBuffer(buffer){
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Feuille Excel introuvable');
  const rows = [];
  const header = ws.getRow(1).values.slice(1).map(v=>String(v||'').trim().toLowerCase());
  const required = ['reference','brand','designation','building'];
  for (const r of required) if (!header.includes(r)) throw new Error('Colonnes manquantes: ' + required.join(', '));

  for (let i=2;i<=ws.rowCount;i++){
    const vals = ws.getRow(i).values.slice(1);
    if (vals.every(v => (v===null || v===undefined || String(v).trim()===''))) continue;
    const obj = {};
    header.forEach((key, idx)=> obj[key] = vals[idx]===undefined? null: (typeof vals[idx]==='string'? vals[idx].trim(): vals[idx]));
    if (obj.zone_gas!==null && obj.zone_gas!=='') obj.zone_gas = Number(obj.zone_gas);
    else obj.zone_gas = null;
    if (obj.zone_dust!==null && obj.zone_dust!=='') obj.zone_dust = Number(obj.zone_dust);
    else obj.zone_dust = null;
    obj.category_g = obj.category_g || null;
    obj.category_d = obj.category_d || null;
    obj.last_inspection_date = obj.last_inspection_date ? String(obj.last_inspection_date).slice(0,10) : null;
    rows.push(obj);
  }
  return rows;
}
