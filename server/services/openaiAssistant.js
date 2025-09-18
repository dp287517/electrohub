import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function suggestForNonConformity(eq){
  const msg = `ATEX assistant. Provide concise bullets for palliative, corrective, preventive actions.
Reference: ${eq.reference}
Brand: ${eq.brand}
Designation: ${eq.designation}
ATEX Ref: ${eq.atex_reference || 'n/a'}
Building: ${eq.building} Room: ${eq.room || 'n/a'} Site: ${eq.site}
Zones: gas=${eq.zone_gas ?? 'n/a'} dust=${eq.zone_dust ?? 'n/a'}
Categories: G=${eq.category_g || 'n/a'} D=${eq.category_d || 'n/a'}
Marking: ${eq.marking || 'n/a'}
Last inspection: ${eq.last_inspection_date || 'n/a'}
Next due: ${eq.next_due_date || 'n/a'}
Compliant: ${eq.compliant ? 'yes' : 'no'}
Reasons: ${eq.reasons || ''}`;

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: msg }],
    temperature: 0.2
  });
  return res.choices[0].message.content;
}
