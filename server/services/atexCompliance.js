const rank = { '1G':3, '2G':2, '3G':1, '1D':3, '2D':2, '3D':1 };
const minCatG = { 0:'1G', 1:'2G', 2:'3G' };
const minCatD = { 20:'1D', 21:'2D', 22:'3D' };

export function computeCompliance(payload){
  const { zone_gas=null, zone_dust=null, category_g=null, category_d=null, last_inspection_date=null } = payload;
  let ok = true;
  const reasons = [];
  if (zone_gas !== null && zone_gas !== undefined){
    if (!category_g) { ok = false; reasons.push('Catégorie G manquante'); }
    else if (rank[category_g] < rank[minCatG[zone_gas]]) { ok = false; reasons.push(`Catégorie G insuffisante pour Zone ${zone_gas}`); }
  }
  if (zone_dust !== null && zone_dust !== undefined){
    if (!category_d) { ok = false; reasons.push('Catégorie D manquante'); }
    else if (rank[category_d] < rank[minCatD[zone_dust]]) { ok = false; reasons.push(`Catégorie D insuffisante pour Zone ${zone_dust}`); }
  }
  let next_due_date = null;
  if (last_inspection_date){
    const d = new Date(last_inspection_date);
    const nd = new Date(d); nd.setFullYear(d.getFullYear()+3);
    next_due_date = nd.toISOString().slice(0,10);
    const today = new Date().toISOString().slice(0,10);
    if (next_due_date < today){ ok = false; reasons.push('Échéance de contrôle dépassée'); }
  }
  return { compliant: ok, reasons, next_due_date };
}
