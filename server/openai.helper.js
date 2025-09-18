import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function atexAssistMessage(eq) {
  const { reference, designation, building, zone_gas, zone_dust, category_g, category_d, marking, last_inspection_date, compliant, comments } = eq;
  const msg = `You are an ATEX compliance assistant. Equipment:
Reference: ${reference}
Designation: ${designation}
Building: ${building}
Gas zone: ${zone_gas ?? 'n/a'}
Dust zone: ${zone_dust ?? 'n/a'}
Category G: ${category_g || 'n/a'}
Category D: ${category_d || 'n/a'}
Marking: ${marking || 'n/a'}
Last inspection: ${last_inspection_date || 'n/a'}
Compliant: ${compliant ? 'yes' : 'no'}
Notes: ${comments || ''}

If non-compliant, provide concise bullet points for palliative, corrective and preventive actions (max 150 words total). If compliant, reply with: "Equipment is compliant. No action needed."`;

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: msg }],
    temperature: 0.2
  });
  return res.choices[0].message.content;
}
