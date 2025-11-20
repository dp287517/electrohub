// -----------------------------------------------------------------------------
// tsd_library.js
// Central library of controls derived from: G2.1 Maintenance, Inspection and
// Testing of Electrical Equipment TSD (v2.0, Effective 2023-10-12).
// This file is generated to support Electrohub (server_controls.js / Controls.jsx).
//
// Usage:
//  - RESULT_OPTIONS: standard statuses for checklist items.
//  - Each category maps to a DB table (db_table). If that equipment type does
//    not yet exist in DB, display `fallback_note_if_missing` to the user.
//  - frequency: { interval: <number>, unit: 'months'|'years'|'weeks' }.
//  - observations: free-text fields to capture readings/notes.
// -----------------------------------------------------------------------------
export const tsdLibrary = {
  "meta": {
    "source": "G2.1 Maintenance, Inspection and Testing of Electrical Equipment TSD v2.0 (Effective: 2023-10-12)",
    "result_options": [
      "Conforme",
      "Non conforme",
      "Non applicable"
    ],
    "missing_equipment_note": "Equipment pending integration into Electrohub system."
  },
  "categories": [
    {
      "key": "lv_switchgear",
      "label": "Low voltage switchgear (<1000 V ac)",
      "db_table": "switchboards",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection",
          "description": "Visual inspection with the switchgear energized and in normal operating condition.",
          "frequency": {
            "interval": 3,
            "unit": "months"
          },
          "checklist": [
            "Switchgear environment is clean, cool and dry",
            "No abnormal noises, smells, vibration or heat",
            "Arcing not detected (sound/voltage flicker)",
            "No blistered/blackened paint; insulation looks normal (no signs of overheating)",
            "Room temperature indicates no general overheating",
            "No combustibles/unwanted material on or near switchgear",
            "No damaged insulators",
            "No pooled water, leaks, rodents, or environmental contaminants",
            "IP2X protection maintained incl. inside cubicles opened without tools",
            "All labels permanent, legible and accurate to drawing"
          ],
          "observations": [
            "Relay indications (flags)",
            "Voltage readings",
            "Current readings",
            "Damaged components (displays, meters, LEDs)"
          ],
          "notes": "For checklist items, record status using: Conforme / Non conforme / Non applicable."
        },
        {
          "type": "Thermography",
          "description": "Perform thermographic surveys of low voltage switchgear.",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Solid insulation",
            "Bolted connections",
            "Switchgear contacts",
            "Panel exterior",
            "Accessible internal components"
          ]
        },
        {
          "type": "Low-Voltage Air Circuit Breakers (ACB) \u2013 Annual",
          "description": "Functional and mechanical checks, lubrication per manufacturer.",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Smooth operation; mechanism not binding",
            "Correct alignment; no mechanical damage",
            "No overheating; arc chutes OK; contacts OK",
            "Insulation resistance of main contacts checked",
            "Prove operation from protection devices",
            "Charging mechanism and auxiliary features functional (interlocks, trip-free, anti-pumping, trip indicators)",
            "Open/Close operation (manual & control system)",
            "Lubricated per manufacturer"
          ]
        },
        {
          "type": "MCCB >400A \u2013 Annual",
          "description": "Operation and settings.",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Smooth operation; mechanism not binding",
            "Protection settings correct vs latest electrical study"
          ]
        },
        {
          "type": "Motor Contactors \u2013 Annual",
          "description": "For contactors >50 hp (37 kW).",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Mechanically exercised",
            "Smooth operation; correct alignment; no mechanical damage",
            "No overheating; arc barriers and contacts in good condition",
            "Controls functionally OK",
            "Lubricated per manufacturer"
          ]
        },
        {
          "type": "Automatic Transfer Switch \u2013 Annual",
          "description": "Functional and mechanical checks, thermography, lubrication.",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Simulate loss/return of normal power; verify transfer and interlocks",
            "Thermography in both positions (no hot spots)",
            "Smooth mechanical operation; mechanism not binding",
            "Lubricated per manufacturer"
          ]
        },
        {
          "type": "Fused Switches \u2013 3\u20135 years",
          "description": "Mechanical checks, lubrication, fuse rating and overheating check.",
          "frequency": {
            "interval": 4,
            "unit": "years"
          },
          "checklist": [
            "Physical condition of fuse housing/base",
            "Smooth operation; mechanism not binding",
            "Lubricated per manufacturer",
            "Fuses of correct rating/characteristics (replace all 3 phases if one is blown)",
            "No evidence of overheating"
          ]
        },
        {
          "type": "Low-Voltage ACB \u2013 Electrical Tests 3\u20135 years",
          "description": "Trip/close coil voltages, insulation resistance, primary injection, time travel.",
          "frequency": {
            "interval": 4,
            "unit": "years"
          },
          "checklist": [
            "Trip/Close coils operate within manufacturer voltage (typically ~50% rated)",
            "Insulation resistance >100 M\u03a9 at 1000Vdc (open & closed; phase-to-phase & phase-to-earth)",
            "Primary current injection tests protective functions (pick-up/operate within tolerance)",
            "Time travel curve recorded and compared to manufacturer and previous results"
          ]
        },
        {
          "type": "MCCB \u2013 Insulation Resistance 3\u20135 years",
          "description": "IR >100 M\u03a9 at 1000Vdc.",
          "frequency": {
            "interval": 4,
            "unit": "years"
          },
          "checklist": [
            "Insulation resistance >100 M\u03a9 at 1000Vdc (open & closed; phase-to-phase & phase-to-earth)"
          ]
        },
        {
          "type": "Motor Contactors \u2013 Insulation Resistance 3\u20135 years",
          "description": "IR >100 M\u03a9 at 1000Vdc.",
          "frequency": {
            "interval": 4,
            "unit": "years"
          },
          "checklist": [
            "Insulation resistance >100 M\u03a9 at 1000Vdc (open & closed; phase-to-phase & phase-to-earth)"
          ]
        },
        {
          "type": "Automatic Transfer Switch \u2013 Insulation Resistance 3\u20135 years",
          "description": "IR >100 M\u03a9 at 1000Vdc.",
          "frequency": {
            "interval": 4,
            "unit": "years"
          },
          "checklist": [
            "Insulation resistance >100 M\u03a9 at 1000Vdc (open & closed; phase-to-phase & phase-to-earth)"
          ]
        },
        {
          "type": "Busbars and Cables \u2013 3\u20135 years",
          "description": "Low resistance and insulation resistance checks.",
          "frequency": {
            "interval": 4,
            "unit": "years"
          },
          "checklist": [
            "Low Resistance of bolted connections \u2013 compare similar joints; no >50% difference; below manufacturer/max baseline",
            "Insulation resistance >100 M\u03a9 at 1000Vdc (phase-to-earth)"
          ]
        },
        {
          "type": "Protection Relays \u2013 3\u20135 years",
          "description": "Secondary injection testing; settings per latest coordination study.",
          "frequency": {
            "interval": 4,
            "unit": "years"
          },
          "checklist": [
            "All protective functions operate correctly via secondary injection",
            "Relay settings match current protection coordination study"
          ]
        }
      ]
    },
    {
      "key": "lv_switchgear_devices",
      "label": "Low voltage switchgear (<1000 V ac)",
      "db_table": "devices",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Low-Voltage Air Circuit Breakers (ACB) – Annual",
          "description": "Functional and mechanical checks, lubrication per manufacturer.",
          "frequency": { "interval": 12, "unit": "months" },
          "checklist": [
            "Smooth operation; mechanism not binding",
            "Correct alignment; no mechanical damage",
            "No overheating; arc chutes OK; contacts OK",
            "Insulation resistance of main contacts checked",
            "Operation proven from protection devices",
            "Charging mechanism and auxiliary features functional (interlocks, trip-free, anti-pumping, trip indicators)",
            "Open/Close operation (manual & via control system)",
            "Lubricated as per manufacturer instructions"
          ]
        },
        {
          "type": "MCCB >400A – Annual",
          "description": "Operation and settings.",
          "frequency": { "interval": 12, "unit": "months" },
          "checklist": [
            "Smooth operation; mechanism not binding",
            "Protection settings correct vs latest electrical study"
          ]
        },
        {
          "type": "Motor Contactors – Annual",
          "frequency": { "interval": 12, "unit": "months" },
          "checklist": [
            "Correct contact movement; no sticking",
            "No sign of overheating or contact wear",
            "Coils and auxiliary contacts in good condition"
          ]
        },
        {
          "type": "Automatic Transfer Switch – Annual",
          "frequency": { "interval": 12, "unit": "months" },
          "checklist": [
            "Smooth operation, no binding",
            "Correct transfer sequence and timing",
            "No evidence of overheating",
            "Auxiliary contacts and interlocks functional"
          ]
        },
        {
          "type": "Fused Switches – 3–5 years",
          "frequency": { "interval": 48, "unit": "months" },
          "checklist": [
            "Physical condition of fuse housing/base",
            "Smooth operation; mechanism not binding",
            "Lubricated per manufacturer",
            "Fuses of correct rating/characteristics (remplacer les 3 phases si une est HS)",
            "No evidence of overheating"
          ]
        },
        {
          "type": "Low-Voltage ACB – Electrical Tests 3–5 years",
          "description": "Trip/close coil voltages, insulation resistance, primary injection, time-travel.",
          "frequency": { "interval": 48, "unit": "months" },
          "checklist": [
            "Trip/Close coils operate within manufacturer voltage limits (~50% rated, sauf spécification contraire)",
            "Insulation resistance >100 MΩ at 1000 Vdc (open/closed, phase–phase, phase–earth)",
            "Primary current injection: pick-up et déclenchement dans les tolérances fabricant",
            "Time–travel curve enregistrée et comparée au fabricant et aux mesures précédentes"
          ]
        },
        {
          "type": "MCCB – Insulation Resistance 3–5 years",
          "description": "IR >100 MΩ at 1000 Vdc.",
          "frequency": { "interval": 48, "unit": "months" },
          "checklist": [
            "Insulation resistance >100 MΩ at 1000 Vdc (open/closed, phase–phase, phase–earth)"
          ]
        },
        {
          "type": "Motor Contactors – Insulation Resistance 3–5 years",
          "frequency": { "interval": 48, "unit": "months" },
          "checklist": [
            "Insulation resistance of coils and main contacts within acceptable values",
            "No tracking or contamination visible on insulation"
          ]
        },
        {
          "type": "Automatic Transfer Switch – Insulation Resistance 3–5 years",
          "frequency": { "interval": 48, "unit": "months" },
          "checklist": [
            "Insulation resistance of main paths and control circuits above minimum recommended values"
          ]
        },
        {
          "type": "Residual Current Devices (RCDs)",
          "frequency": {
            "interval": 6,
            "unit": "months"
          },
          "checklist": [
            "Operation via test button (every 6 months)",
            "Annual test using approved RCD tester"
          ]
        },
        {
          "type": "Protection Relays – 3–5 years",
          "frequency": { "interval": 48, "unit": "months" },
          "checklist": [
            "Relay functions tested per scheme (overcurrent, earth fault, etc.)",
            "Settings verified vs latest protection study",
            "Trip signals correctly wired to breakers / contactors"
          ]
        }
      ]
    },
    {
      "key": "hv_switchgear",
      "label": "High voltage switchgear (>1000 V ac)",
      "db_table": "hv_devices",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection",
          "description": "Visual inspection with the switchgear energized.",
          "frequency": {
            "interval": 3,
            "unit": "months"
          },
          "checklist": [
            "Environment clean, cool, dry; no abnormal noises/smells/vibration/heat",
            "Arcing not detected (sound/voltage flicker)",
            "No blistered/blackened paint; insulation condition OK",
            "Room temperature indicates no general overheating",
            "No combustibles near switchgear",
            "No damaged insulators",
            "No pooled water/leaks/rodents/environmental contaminants"
          ],
          "observations": [
            "Relay indications (flags)",
            "Voltage readings (where possible)",
            "Current readings (where possible)"
          ]
        },
        {
          "type": "Thermography",
          "description": "Non-intrusive thermographic survey; if heat detected, isolate and earth before intrusive access.",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Busbar chamber covers",
            "Cable boxes",
            "Voltage transformers"
          ]
        },
        {
          "type": "Partial Discharge",
          "description": "Routine pass/fail PD tests (e.g., UltraTEV\u00ae).",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Perform handheld PD test",
            "Record results",
            "Investigate any failed PD test"
          ]
        },
        {
          "type": "Circuit Breakers \u2013 Annual functional checks",
          "description": "General condition and operation.",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Covers/frame/poles/racking device OK",
            "Max number of operation cycles within limit",
            "Key locking and pad locking operate",
            "Racking interlock (red opening pushbutton) OK",
            "Manual/electrical racking OK (motorized where applicable)",
            "Manual and electrical Open/Close operate"
          ]
        },
        {
          "type": "Circuit Breakers \u2013 3\u20138 years maintenance",
          "description": "IR, vacuum integrity, oil quality, over-potential, contact resistance, time-travel.",
          "frequency": {
            "interval": 6,
            "unit": "years"
          },
          "checklist": [
            "Insulation resistance > 2 G\u03a9 at 5000Vdc (open & closed)",
            "Vacuum bottle over-potential per manufacturer (vacuum integrity)",
            "Liquid Screening (bulk oil): dielectric strength >26kV; moisture <25ppm; PCB <50ppm (post fault, replace oil)",
            "Dielectric over-potential per manufacturer (avoid damaging connected equipment)",
            "Contact resistance \u2013 no pole deviates >50% vs lowest; within manufacturer limits",
            "Time-travel curve recorded; compare to manufacturer/previous results"
          ]
        },
        {
          "type": "Insulators and Busbars \u2013 3\u20138 years",
          "description": "Low resistance and insulation resistance.",
          "frequency": {
            "interval": 6,
            "unit": "years"
          },
          "checklist": [
            "Low Resistance across bolted connections; no >50% difference; below manufacturer max",
            "Insulation resistance >2 G\u03a9 at 5000Vdc (phase-to-earth)"
          ]
        },
        {
          "type": "Voltage Transformers \u2013 3\u20138 years",
          "description": "Visual inspection (energized & isolated), fuses, insulation.",
          "frequency": {
            "interval": 6,
            "unit": "years"
          },
          "checklist": [
            "Good visual condition; labelled; locked in service (energized)",
            "Shutters in good condition (isolated)",
            "Withdrawable mechanism free; primary contacts/spring/earth OK",
            "Primary & secondary fuses correct and in good condition",
            "Insulation resistance >5 G\u03a9 (dc, 1 minute)"
          ]
        },
        {
          "type": "Protection Relays \u2013 3\u20138 years",
          "description": "Secondary current injection test; settings vs coordination study.",
          "frequency": {
            "interval": 6,
            "unit": "years"
          },
          "checklist": [
            "All protective functions verified via secondary injection",
            "Settings match protection coordination study"
          ]
        }
      ]
    },
    {
      "key": "pfc_hv",
      "label": "Power Factor Correction (>1000 V ac)",
      "db_table": "hv_devices",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection \u2013 3 months",
          "frequency": {
            "interval": 3,
            "unit": "months"
          },
          "checklist": [
            "Correct mode of operation (auto/manual)",
            "Controller parameter settings and alarms OK (PF setpoint ~0.95)",
            "Review PF trends and system performance"
          ]
        },
        {
          "type": "Annual Visual Inspection (after HV isolation)",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Capacitors/reactors/cabling: no overheating/damage",
            "Cleanliness/ventilation/heating/filtration \u2013 replace filters as needed"
          ]
        },
        {
          "type": "Annual Capacitor Condition Test (after HV isolation)",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Measure capacitance of each phase of each step \u2013 within manufacturer limits",
            "Isolate failing steps"
          ]
        },
        {
          "type": "Every 3 years \u2013 components & terminations",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Fuses & vacuum contactors: condition, ratings correct, free operation, no overheating; replace as needed",
            "Cable terminations \u2013 check all phase & earth connections",
            "Connection tightness \u2013 torque to manufacturer settings"
          ]
        }
      ]
    },
    {
      "key": "transformers_fluid",
      "label": "Fluid Immersed Transformers",
      "db_table": "hv_equipments",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual inspections (Non-Intrusive)",
          "frequency": {
            "interval": 6,
            "unit": "months"
          },
          "checklist": [
            "Silica gel breathers checked/replaced as needed",
            "No signs of abnormality (leaks, corrosion, contamination)",
            "Earthing connections integrity"
          ]
        },
        {
          "type": "Annual Oil Sample Test",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Breakdown voltage, moisture content, Oil Quality Index",
            "Trend results; increase sampling if abnormal",
            "FURAN analysis yearly only if high CO/CO2 ratio observed"
          ]
        },
        {
          "type": "Annual Dissolved Gas Analysis (DGA)",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Screening tests and DGA (main & tap changer tanks)",
            "Trend results; investigate/renew fluid if failed"
          ]
        },
        {
          "type": "Annual Paintwork",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "No rust/damage; touch up as needed"
          ]
        },
        {
          "type": "Annual Inspect Fluid Level",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Top up as needed",
            "Record leaks and arrange repair"
          ]
        },
        {
          "type": "Annual Temperature Indicators",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Devices undamaged & sealed; reasonable temperature vs load and ambient",
            "Alarm/trip settings correct",
            "Record peak & reset"
          ]
        },
        {
          "type": "Annual Pressure Relief Device",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "No damage/water ingress"
          ]
        },
        {
          "type": "Annual Buchholz (Gas/Oil Actuator Relay)",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Valves in correct position",
            "Chamber filled with liquid",
            "If gas present, sample and release pressure"
          ]
        },
        {
          "type": "Annual Liquid Level Indicator",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Condition OK",
            "Level reasonable vs last inspection",
            "Record levels"
          ]
        },
        {
          "type": "Annual Vacuum/Pressure Gauge",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Condition OK",
            "Vacuum/pressure maintained; record values"
          ]
        },
        {
          "type": "Annual HV & LV Cable Boxes",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Integrity of cable boxes & glands",
            "Routine pass/fail PD tests (e.g., UltraTEV\u00ae) \u2013 investigate failures"
          ]
        },
        {
          "type": "Annual HV & LV Terminal Bushings",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Clean; no tracking/cracks/contaminants"
          ]
        },
        {
          "type": "Annual Cooling Fans & Pumps",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Fans/guards condition",
            "Pump housing & gland",
            "Temperature monitor setpoints correct",
            "Operate fans and pumps"
          ]
        },
        {
          "type": "Annual On-load Tap Changers",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Record operation count",
            "Inspect control panel for overheating/moisture ingress"
          ]
        },
        {
          "type": "Connection & fittings \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Torque checks on bolted connections/fittings",
            "Inside cable boxes: no overheating/PD; replace gaskets when opened",
            "Clean/inspect bushings"
          ]
        },
        {
          "type": "Off-circuit Tapping Switch \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Operate across all taps freely"
          ]
        },
        {
          "type": "Earth Connection Integrity \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Earth continuity test recorded"
          ]
        },
        {
          "type": "Insulation Resistance \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Winding-to-winding & winding-to-ground IR",
            "HV: 5000V 1 min; LV: 1000V 1 min",
            "IR >100 M\u03a9 (LV) and >1000 M\u03a9 (HV) \u2013 record"
          ]
        },
        {
          "type": "Low Resistance Test \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Bolted connection low-resistance \u2013 no >50% diff; <1 \u03a9 and/or within manufacturer limit"
          ]
        },
        {
          "type": "Protective Devices \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Test liquid/winding temperature indicators; Buchholz etc."
          ]
        },
        {
          "type": "Capacitive Bushings \u2013 Power Factor",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Power factor & capacitance within \u00b110% of nameplate",
            "Hot collar watts-loss within manufacturer factory test",
            "Consider winding power factor test (typical 3% fluid-filled; silicone ~0.5%)"
          ]
        },
        {
          "type": "External paint \u2013 refurbish if required",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "PCB Analysis",
          "frequency": {
            "interval": 60,
            "unit": "months"
          },
          "checklist": [
            "PCB content <50 ppm or per local regulations (stricter applies)"
          ]
        }
      ]
    },
    {
      "key": "transformers_cast_resin",
      "label": "Cast Resin Transformers",
      "db_table": "hv_equipments",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Ventilation & Protection Devices",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "No damage/overheating on wiring to ventilation/protection devices",
            "Reasonable temperature vs load & ambient",
            "Functional check of protection (winding temp alarms/trips)",
            "Functional check of cooling fans (if any)"
          ]
        },
        {
          "type": "Paintwork",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "No rust/damage; touch up"
          ]
        },
        {
          "type": "Cleanliness",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "No foreign matter on windings",
            "Vacuum clean; blow inaccessible areas with compressed air/N2",
            "Vent grills unobstructed"
          ]
        },
        {
          "type": "Insulating Distances",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Correct distances between cables and live parts"
          ]
        },
        {
          "type": "Cables & Busbars",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Fixings and connections OK",
            "Glands secured & correctly made-off"
          ]
        },
        {
          "type": "Ingress Protection",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Compliance with original IP rating"
          ]
        },
        {
          "type": "Partial Discharge",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Handheld PD test (e.g., UltraTEV\u00ae); record results; investigate failures"
          ]
        },
        {
          "type": "HV & LV Cable Boxes",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Integrity of cable boxes; glands good",
            "Routine PD tests & record; investigate failures"
          ]
        },
        {
          "type": "Cooling Fans",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Fans/guards condition",
            "Temperature monitor setpoints correct"
          ]
        },
        {
          "type": "Connection & fittings \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Torque checks on bolted connections/fittings",
            "Inside cable boxes: no overheating/PD"
          ]
        },
        {
          "type": "Earth Connection Integrity \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Earth continuity test recorded"
          ]
        },
        {
          "type": "Insulation Resistance \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Winding-to-winding & winding-to-ground IR",
            "HV: 5000V 1 min; LV: 1000V 1 min",
            "IR >100 M\u03a9 (LV) and >1000 M\u03a9 (HV); record"
          ]
        },
        {
          "type": "Low Resistance Test \u2013 Intrusive",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Bolted connection low-resistance \u2013 no >50% diff; <1 \u03a9 and/or within manufacturer"
          ]
        },
        {
          "type": "Protective Devices",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Test alarms/trips for winding temperature; over-current devices"
          ]
        },
        {
          "type": "Polarisation Index",
          "frequency": {
            "interval": 84,
            "unit": "months"
          },
          "checklist": [
            "10-minute/1-minute IR ratio (PI) \u2265 1.0; record"
          ]
        },
        {
          "type": "Power Factor (>1000 kVA)",
          "frequency": {
            "interval": 84,
            "unit": "months"
          },
          "checklist": [
            "CH/CHL <= 2%; CL <= 5%; record"
          ]
        },
        {
          "type": "Power Factor Tip-Up (>1000 kVA)",
          "frequency": {
            "interval": 84,
            "unit": "months"
          },
          "checklist": [
            "PF remains reasonably constant; tip-up \u2264 0.5%"
          ]
        }
      ]
    },
    {
      "key": "motors_hv_or_large",
      "label": "AC Induction Motors >1000 V ac or >400 kW",
      "db_table": "hv_motors",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Routine Visual Inspection",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "checklist": [
            "No unusual noises, vibrations, or excessive heat",
            "Oil levels OK; no bearing lubrication leaks",
            "No cooling water leaks; air inlets not blocked",
            "No combustibles; good housekeeping",
            "Foundations OK; shaft alignment OK; earth connections OK",
            "Fan cowling/baffles OK; proper circuit identification; cables/glanding OK; fixing bolts OK",
            "No corrosion, chemical attack, physical damage"
          ]
        },
        {
          "type": "Vibration measurements",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "checklist": [
            "If no online vib analysis, measure shaft/bearing vibration (Acoustic Emission/Ultrasound acceptable)"
          ]
        },
        {
          "type": "Oil lubricated bearings \u2013 lube analysis",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Perform lubrication analysis (where economically viable)"
          ]
        },
        {
          "type": "Thermal Imaging",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Bearings, motor frame, terminal box, surge capacitors, cables, motor controller, VSD checked"
          ]
        },
        {
          "type": "Motor Terminal Box \u2013 visual during IR testing",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "No water ingress/corona discharge; earth connections OK"
          ]
        },
        {
          "type": "Stator Winding \u2013 Insulation Resistance",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Apply dc 1 min; IR \u2265 100 M\u03a9"
          ]
        },
        {
          "type": "Stator Winding \u2013 Polarisation Index",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "10/1 min IR ratio; PI \u2265 2 indicates clean/dry (much higher may indicate dryness/brittleness)"
          ]
        },
        {
          "type": "Stator Winding \u2013 DC conductivity",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Low-resistance ohmmeter; phase resistances within 1 \u03a9 of each other"
          ]
        },
        {
          "type": "Stator Winding \u2013 Power Factor",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "AC PF one phase at a time; epoxy mica \u22640.5%; asphaltic mica 3\u20135%",
            "1% PF increase trend is serious; investigate",
            "PF increase with \u2193capacitance \u21d2 thermal deterioration; PF increase with \u2191capacitance \u21d2 water absorption"
          ]
        },
        {
          "type": "Stator Winding \u2013 Power Factor Tip-Up",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "PF at ~20% and 100% phase-earth voltage; trend tip-up (increasing \u21d2 PD activity)"
          ]
        },
        {
          "type": "Stator Core \u2013 Visual",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "No hot spots"
          ]
        },
        {
          "type": "Stator Core \u2013 Air Gap",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Measure air gap"
          ]
        },
        {
          "type": "Stator Core \u2013 Loop Test",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Excite to 100% back-of-core flux; soak; ensure no thermal runaway; hot spots \u0394T 5\u201310\u00b0C indicate defects"
          ]
        },
        {
          "type": "Rotor Winding \u2013 Insulation Resistance",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Applies to wound rotor motors; IR \u2265 100 M\u03a9"
          ]
        },
        {
          "type": "Rotor \u2013 Polarisation Index",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Squirrel cage motors: PI per 10/1 min IR; \u22652 indicates clean/dry"
          ]
        },
        {
          "type": "Rotor \u2013 DC conductivity",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Wound rotor motors: phase resistances within 1 \u03a9"
          ]
        },
        {
          "type": "Slip rings/brushes \u2013 inspect",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Wear/damage"
          ]
        },
        {
          "type": "Squirrel cage \u2013 Growler Test",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "checklist": [
            "Detect broken bars via growler method"
          ]
        },
        {
          "type": "Retaining rings \u2013 corrosion check",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "If fitted, check for corrosion"
          ]
        },
        {
          "type": "Rings in-situ \u2013 NDE",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "Rings removed \u2013 NDE",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "Cracking inspection \u2013 visual",
          "frequency": {
            "interval": 36,
            "unit": "months"
          }
        },
        {
          "type": "Fan blades/vanes \u2013 NDE for cracks",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "Forging \u2013 NDE for cracks/inclusions",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "Bearings \u2013 Insulation Resistance",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Only insulated bearings: 500Vdc; \u226550 M\u03a9 disassembled; \u22655 M\u03a9 assembled"
          ]
        },
        {
          "type": "Sleeve bearings \u2013 white metal surfaces",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "Anti-friction bearings \u2013 cage/rolling elements",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "Shaft surfaces",
          "frequency": {
            "interval": 72,
            "unit": "months"
          }
        },
        {
          "type": "Heater check",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Motor heater functioning properly"
          ]
        }
      ]
    },
    {
      "key": "bus_duct_riser",
      "label": "Bus Duct / Bus Riser (>800A, <1000 Vac)",
      "db_table": "devices",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Safe access; protection against accidental contact with live parts",
            "No arcing/burnt smell; no blistered/blackened paint; insulation OK",
            "No damaged/missing insulators/supports/clamps; no distortion",
            "No foreign objects, pooled water, leaks, rodents, contaminants",
            "Heater settings/operation checked (measure current drawn)",
            "No signs of circulating/leakage current"
          ]
        },
        {
          "type": "Thermography",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Terminations",
            "Bolted connections",
            "Earth connections",
            "Tap-offs",
            "Investigate any hot areas (intrusive maintenance may be required)"
          ]
        },
        {
          "type": "Operational checks of inline components",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Inline breaker/isolators/fusible units smooth operation; correct protection settings/fuse selection"
          ]
        },
        {
          "type": "Low Resistance / Earthing / Torque \u2013 5 yrs",
          "frequency": {
            "interval": 60,
            "unit": "months"
          },
          "checklist": [
            "Low Resistance across bolted connections (no >50% difference; below max/baseline)",
            "Earthing resistance/integrity recorded & baseline checked",
            "Torque checks per manufacturer (unless torque-free design)",
            "Lubricate mechanisms per manufacturer"
          ]
        },
        {
          "type": "Inline/tap-off MCCB \u2013 IR",
          "frequency": {
            "interval": 60,
            "unit": "months"
          },
          "checklist": [
            "Insulation resistance >100 M\u03a9 at 1000Vdc (open & closed; P-P, P-E)"
          ]
        },
        {
          "type": "Fusible links \u2013 IR",
          "frequency": {
            "interval": 60,
            "unit": "months"
          },
          "checklist": [
            "Insulation resistance >100 M\u03a9 at 1000Vdc (open & closed; P-P, P-E)"
          ]
        }
      ]
    },
    {
      "key": "pfc_lv",
      "label": "Power Factor Correction (<1000 V ac)",
      "db_table": "pfc",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection",
          "frequency": {
            "interval": 3,
            "unit": "months"
          },
          "checklist": [
            "Capacitors/contactors/resistors/reactors/cables \u2013 no overheating/damage",
            "Cabinet moisture/cleanliness/ventilation/filtration OK; replace filters as needed",
            "Ambient temperature acceptable",
            "Measured PF/alarm \u2013 PF setpoint ~0.95",
            "Check PF trends & harmonic levels"
          ]
        },
        {
          "type": "Capacitor Condition Test",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Measure capacitance of each capacitor/stage",
            "If any capacitor degrades >10%, isolate & replace unless safety/monitoring systems per lifecycle policy"
          ]
        },
        {
          "type": "Thermography",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Capacitors/contactors/resistors/reactors/cabling \u2013 no overheating",
            "Bolted connections/terminations",
            "MCCBs/fuses",
            "Thyristors or SCR modules"
          ]
        },
        {
          "type": "Fuses/MCCBs/Contactors/Resistors/Reactors",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Discharge resistors operate per manufacturer",
            "No damage; correct ratings; free operation of MCCB/contactor",
            "Fuses not blown (replace with correct rating)",
            "No overheating; renew if needed"
          ]
        },
        {
          "type": "Thermal protection internal",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Cleanliness OK; settings per manufacturer; functional tests including fans"
          ]
        },
        {
          "type": "Controller settings & operations",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Capacitor stages operate; alarms & settings correct"
          ]
        },
        {
          "type": "Cable terminations",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "All phase/earth connections & terminations OK"
          ]
        },
        {
          "type": "Connection tightness",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Torque to manufacturer settings"
          ]
        },
        {
          "type": "Lifecycle Management \u2013 reference",
          "notes": "Apply decision flow for replacements per TSD life cycle chart"
        }
      ]
    },
    {
      "key": "distribution_boards",
      "label": "Distribution Boards (<1000 V ac)",
      "db_table": "switchboards",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection",
          "frequency": {
            "interval": 3,
            "unit": "months"
          },
          "checklist": [
            "Clean inside & outside",
            "No exterior damage/corrosion",
            "Access controlled panels",
            "Doors earthed",
            "Labels & circuit charts present & accurate"
          ]
        },
        {
          "type": "Identification & Circuit Charts",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Descriptions accurate; schedules updated as necessary",
            "Labels securely fixed on door exterior"
          ]
        },
        {
          "type": "Ingress Protection",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "IP rating suitable for environment (note changes e.g., wet)",
            "No missing gland plates/glands/plugs",
            "Minimum IP2X protection against accidental contact; covers require tool to remove"
          ]
        },
        {
          "type": "Fuse Carriers & MCBs",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "No damage; ratings correct where practicable",
            "Free operation of MCB mechanisms"
          ]
        },
        {
          "type": "Thermal Imaging",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Solid insulation; bolted connections; breakers & fuse holders; panel exterior; accessible internal components"
          ]
        },
        {
          "type": "Cable Insulation",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Condition OK; no overheating; identify/report causes"
          ]
        },
        {
          "type": "Cable Terminations",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "Check all phase/neutral/earth connections & terminations",
            "Tightness OK; terminations supported by glands/clamps (not by connections)"
          ]
        },
        {
          "type": "Conduit & Cable Glands",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "Tightness OK; gland earth continuity OK"
          ]
        },
        {
          "type": "Earth-Fault Loop Impedance",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "At origin (unless calculated); each distribution board; all fixed equipment; all sockets; 10% of lighting outlets (farthest point)",
            "Furthest point of every radial circuit",
            "Values within IEC 60364 recommendations",
            "Note: Earth loop test removes need for separate earth continuity tests"
          ]
        },
      ]
    },
    {
      "key": "motors_lv",
      "label": "AC Induction Motors <1000 V ac <400 kW",
      "db_table": "motors",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Foundations; shaft alignment; earth connections; fan cowling; air filters; baffles; labels; cables/glanding; fixing bolts",
            "No corrosion, chemical attack, physical damage",
            "No incorrect/over lubrication of bearings; no undue dust buildup"
          ]
        },
        {
          "type": "Winding Resistance",
          "frequency": {
            "interval": 60,
            "unit": "months"
          },
          "checklist": [
            "Measure winding resistance; balanced"
          ]
        },
        {
          "type": "Insulation Resistance",
          "frequency": {
            "interval": 60,
            "unit": "months"
          },
          "checklist": [
            "Winding-to-earth IR for each phase; \u2265100 M\u03a9 corrected to 40\u00b0C"
          ]
        },
        {
          "type": "Starters/Inverters/Cabling \u2013 Checks",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "Tightness of all connections",
            "No overheating in starter cubicle",
            "Motor fuse rating characteristic correct vs drawing",
            "Operation of motor protection devices",
            "Fixed/moving contacts condition \u2013 replace as necessary",
            "Control panel functions correctly; indicator lights OK"
          ]
        },
        {
          "type": "Earth Fault Loop Impedance",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "Phase-to-earth link at motor terminals; impedance less than specified by IEC 60364 / protective device"
          ]
        },
        {
          "type": "Motor Circuit Insulation",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "Phase-to-earth IR (motor+LV cabling); \u2265100 M\u03a9 corrected to 40\u00b0C",
            "If VSD installed, test supply and motor cables separately"
          ]
        }
      ]
    },
    {
      "key": "hazardous_areas",
      "label": "Hazardous Areas (IEC 60079)",
      "db_table": "ex_equipments",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Initial Inspection (100% \u2013 Detailed)",
          "frequency": {
            "interval": 0,
            "unit": "months"
          },
          "notes": "Initial for all new hazardous location equipment; use Tables 3-1/3-2/3-3 (Detailed)"
        },
        {
          "type": "Periodic \u2013 Portable (100% \u2013 Close)",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "notes": "\u22641 year for portable equipment"
        },
        {
          "type": "Periodic \u2013 Fixed (100% \u2013 Close if ignition-capable, else 100% \u2013 Visual)",
          "frequency": {
            "interval": 36,
            "unit": "months"
          }
        },
        {
          "type": "Sample \u2013 Detailed (10% of equipment)",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "notes": "Detailed inspection on 10% sample to adjust interval/grade"
        },
        {
          "type": "Checklist \u2013 Table 3-1 (Ex d/e/n, Ex t/td)",
          "checklist": [
            "A1 Equipment appropriate to EPL/Zone requirements",
            "A2 Equipment group correct",
            "A3 Equipment temperature class correct (gas)",
            "A4 Max surface temperature correct",
            "A5 Degree of protection (IP) appropriate",
            "A6 Equipment circuit identification correct",
            "A7 Equipment circuit identification available",
            "A8 Enclosure/glass/glass-to-metal sealing gaskets/compounds satisfactory",
            "A9 No damages or unauthorised modifications (physical)",
            "A10 No evidence of unauthorised modifications (visual)",
            "A11 Cable entry devices/blanking elements correct type, complete, tight (physical & visual)",
            "A12 Threaded covers correct, tight, secured (physical & visual)",
            "A13 Joint surfaces clean/undamaged; gaskets satisfactory and positioned correctly",
            "A14 Enclosure gaskets condition satisfactory",
            "A15 No evidence of water/dust ingress (per IP rating)",
            "A16 Dimensions of flanged joint gaps within limits (docs/standards/site docs)",
            "A17 Electrical connections tight",
            "A18 Unused terminals tightened",
            "A19 Enclosed break & hermetically sealed devices undamaged",
            "A20 Encapsulated components undamaged",
            "A21 Flameproof components undamaged",
            "A22 Restricted breathing enclosure satisfactory (type nR)",
            "A23 Test port functional (type nR)",
            "A24 Breathing operation satisfactory (type nR)",
            "A25 Breathing & draining devices satisfactory",
            "EQUIP-LIGHT-26 Fluorescent lamps not indicating EOL effects",
            "EQUIP-LIGHT-27 HID lamps not indicating EOL effects",
            "EQUIP-LIGHT-28 Lamp type/rating/pin configuration/position correct",
            "EQUIP-MOTORS-29 Fans clearance; cooling undamaged; foundations no indent/cracks",
            "EQUIP-MOTORS-30 Ventilation airflow not impeded",
            "EQUIP-MOTORS-31 Motor insulation resistance satisfactory",
            "B1 Cable type appropriate",
            "B2 No obvious cable damage",
            "B3 Sealing of trunking/ducts/pipes/conduits satisfactory",
            "B4 Stopping boxes/cable boxes correctly filled",
            "B5 Integrity of conduit system & mixed interface maintained",
            "B6 Earthing connections/bonding satisfactory (physical & visual)",
            "B7 Fault loop impedance (TN) or earthing resistance (IT) satisfactory",
            "B8 Automatic protective devices set correctly (no auto-reset)",
            "B9 Automatic protective devices operate within permitted limits",
            "B10 Specific conditions of use complied with",
            "B11 Cables not in use correctly terminated",
            "B12 Obstructions near flameproof flanged joints per IEC 60079-14",
            "B13 Variable voltage/frequency installation per documentation",
            "HEATING-14 Temperature sensors function per documents",
            "HEATING-15 Safety cut-off devices function per documents",
            "HEATING-16 Safety cut-off setting sealed",
            "HEATING-17 Reset possible with tool only",
            "HEATING-18 Auto-reset not possible",
            "HEATING-19 Reset under fault prevented",
            "HEATING-20 Safety cut-off independent from control system",
            "HEATING-21 Level switch installed/set if required",
            "HEATING-22 Flow switch installed/set if required",
            "MOTORS-23 Motor protection devices operate within permitted tE/tA limits",
            "ENV-1 Equipment protected vs corrosion/weather/vibration/adverse factors",
            "ENV-2 No undue accumulation of dust/dirt",
            "ENV-3 Electrical insulation clean/dry"
          ]
        },
        {
          "type": "Checklist \u2013 Table 3-2 (Ex i)",
          "checklist": [
            "A1 Documentation appropriate to EPL/zone",
            "A2 Installed equipment matches documentation (fixed)",
            "A3 Category & group correct",
            "A4 IP rating appropriate to Group III material present",
            "A5 Temperature class correct",
            "A6 Apparatus ambient temperature range correct",
            "A7 Apparatus service temperature range correct",
            "A8 Installation clearly labelled",
            "A9 Enclosure/glass/glass-to-metal gaskets/compounds satisfactory",
            "A10 Cable glands/blanking elements correct type, complete, tight (physical & visual)",
            "A11 No unauthorised modifications",
            "A12 No evidence of unauthorised modifications",
            "A13 Energy limiting devices (barriers/isolators/relays) are approved type, installed per certification, earthed where required",
            "A14 Enclosure gaskets condition satisfactory",
            "A15 Electrical connections tight",
            "A16 PCBs clean/undamaged",
            "A17 Maximum Um of associated apparatus not exceeded",
            "B1 Cables installed per documentation",
            "B2 Cable screens earthed per documentation",
            "B3 No obvious cable damage",
            "B4 Sealing of trunking/ducts/pipes/conduits satisfactory",
            "B5 Point-to-point connections correct (initial inspection)",
            "B6 Earth continuity satisfactory (non-galvanically isolated circuits)",
            "B7 Earthing maintains integrity of type of protection",
            "B8 Intrinsically safe circuit earthing satisfactory",
            "B9 Insulation resistance satisfactory",
            "B10 Separation maintained between IS and non-IS circuits in common boxes/cubicles",
            "B11 Short-circuit protection of power supply per documentation",
            "B12 Specific conditions of use complied with",
            "B13 Cables not in use correctly terminated",
            "C1 Equipment protected vs corrosion/weather/vibration/adverse factors",
            "C2 No undue external accumulation of dust/dirt"
          ]
        },
        {
          "type": "Checklist \u2013 Table 3-3 (Ex p/pD)",
          "checklist": [
            "A1 Equipment appropriate to EPL/zone",
            "A2 Equipment group correct",
            "A3 Temperature class/surface temperature correct",
            "A4 Circuit identification correct",
            "A5 Circuit identification available",
            "A6 Enclosure/glass/gaskets/compounds satisfactory",
            "A7 No unauthorised modifications",
            "A8 No evidence of unauthorised modifications",
            "A9 Lamp rating/type/position correct",
            "B1 Cable type appropriate",
            "B2 No obvious cable damage",
            "B3 Earthing/bonding connections satisfactory (physical & visual)",
            "B4 Fault loop impedance (TN) or earthing resistance (IT) satisfactory",
            "B5 Automatic protective devices operate within limits",
            "B6 Automatic protective devices set correctly",
            "B7 Protective gas inlet temperature below maximum",
            "B8 Ducts/pipes/enclosures in good condition",
            "B9 Protective gas substantially free from contaminants",
            "B10 Protective gas pressure/flow adequate",
            "B11 Pressure/flow indicators/alarms/interlocks function correctly",
            "B12 Spark/particle barriers of exhaust ducts satisfactory",
            "B13 Specific conditions of use complied with",
            "C1 Equipment protected vs corrosion/weather/vibration/adverse factors",
            "C2 No undue external accumulation of dust/dirt"
          ]
        }
      ]
    },
    {
      "key": "emergency_lighting",
      "label": "Emergency Lighting Systems",
      "db_table": "emergency_lighting",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Monthly Test",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "checklist": [
            "If automatic testing: record short-duration results",
            "Else: switch each luminaire/exit sign to emergency mode; ensure illumination",
            "For central battery systems: check system monitors"
          ]
        },
        {
          "type": "Annual Test",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "If automatic testing: record full rated duration results",
            "Else: test each luminaire/sign for full rated duration; restore normal supply; verify indicators & charging",
            "Record date/results; lux measurements per design; adequate lighting levels where required"
          ]
        }
      ]
    },
    {
      "key": "ups_small",
      "label": "Uninterruptible Power Supply (<=5000 VA)",
      "db_table": "ups",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Asset Data (CMMS) \u2013 Required",
          "notes": "Keep Manufacturer/Model/SN, kVA size, install year, battery type/code, battery install year"
        },
        {
          "type": "Ambient Conditions \u2013 Required",
          "notes": "UPS within design ambient conditions"
        },
        {
          "type": "Annual \u2013 Visual Inspection",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Unit functions within design; no outstanding alarms",
            "Clean; vents/filters OK (replace as needed)"
          ]
        },
        {
          "type": "Annual \u2013 UPS Battery Test",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "notes": "Perform per Battery Systems section (3.2.16)"
        },
        {
          "type": "Every 7th year \u2013 Asset Replacement",
          "frequency": {
            "interval": 84,
            "unit": "months"
          },
          "checklist": [
            "Plan/schedule UPS replacement"
          ]
        }
      ]
    },
    {
      "key": "ups_large",
      "label": "Uninterruptible Power Supply (>5000 VA)",
      "db_table": "ups",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Asset Data (CMMS) \u2013 Required",
          "notes": "Keep Manufacturer/Model/SN, kVA size, install year, battery type/code, battery install year"
        },
        {
          "type": "Environment \u2013 Required",
          "notes": "Clean; managed to ~21\u00b0C; RH \u226495%"
        },
        {
          "type": "Annual \u2013 Visual Inspection",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "All components clean; within design specification",
            "Fans/filters OK (replace/clean as necessary)"
          ]
        },
        {
          "type": "Annual \u2013 Environmental Checks",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Room temperature ~21\u00b0C, RH \u226495%",
            "UPS airflow OK; no dust contamination inside"
          ]
        },
        {
          "type": "Annual \u2013 Mechanical/Electrical Inspection",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Inspect power/control terminations and system components",
            "Identify components to replace next service visit"
          ]
        },
        {
          "type": "Annual \u2013 Functional/Operational Verification",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Review event/alarm logs",
            "Input/output/bypass V/I within spec",
            "Comms options operate properly",
            "On-battery operation; transfer to/from static bypass",
            "Parallel operation performance (if applicable)"
          ]
        },
        {
          "type": "Annual \u2013 Implement Updates",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Firmware upgrades implemented",
            "Circuit board revisions checked/updated",
            "Replace components per OEM intervals (AC/DC caps, cooling fans)"
          ]
        },
        {
          "type": "Annual \u2013 UPS Battery Test",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "notes": "Perform per Battery Systems section (3.2.16)"
        },
        {
          "type": "6th year \u2013 Mid-life overhaul",
          "frequency": {
            "interval": 72,
            "unit": "months"
          },
          "notes": "Follow manufacturer recommendations"
        },
        {
          "type": "12th year \u2013 UPS replacement",
          "frequency": {
            "interval": 144,
            "unit": "months"
          },
          "checklist": [
            "Plan/schedule replacement"
          ]
        }
      ]
    },
    {
      "key": "batteries",
      "label": "Battery Systems",
      "db_table": "ups_devices",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Charger \u2013 Monthly",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "checklist": [
            "Cleanliness OK; indicators/meters OK; alarm logs checked; cooling fan OK"
          ]
        },
        {
          "type": "Charger \u2013 Quarterly",
          "frequency": {
            "interval": 3,
            "unit": "months"
          },
          "checklist": [
            "Power capacitors \u2013 no degradation/leaks/bloating/discoloration"
          ]
        },
        {
          "type": "Flooded Lead-Acid \u2013 Monthly",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "checklist": [
            "Record charger V/I; electrolyte levels; no corrosion/leaks"
          ]
        },
        {
          "type": "Flooded Lead-Acid \u2013 Discharge Test",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Load discharge test per manufacturer (1\u20133 yrs)",
            "Increase to annual if capacity deteriorates",
            "Replace when capacity approaches 80% rated",
            "Typical life 4\u20138 yrs at 20\u201325\u00b0C"
          ]
        },
        {
          "type": "Flooded Ni-Cad \u2013 Monthly",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "checklist": [
            "Record charger V/I; electrolyte levels; no corrosion/leaks"
          ]
        },
        {
          "type": "Flooded Ni-Cad \u2013 Discharge Test",
          "frequency": {
            "interval": 24,
            "unit": "months"
          },
          "checklist": [
            "Load discharge test per manufacturer (1\u20133 yrs)",
            "Increase to annual if capacity deteriorates",
            "Replace when capacity approaches 80% rated",
            "Typical life 20\u201325 yrs at 20\u201325\u00b0C"
          ]
        },
        {
          "type": "Sealed Lead Acid (VRLA) \u2013 Monthly",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "checklist": [
            "Record charger V/I; ambient temperature; no corrosion/leaks/overheating/distorted cases"
          ]
        },
        {
          "type": "Sealed Lead Acid (VRLA) \u2013 Annual",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Load discharge test per manufacturer",
            "Increase to 6-monthly if capacity deteriorates",
            "Replace when capacity approaches 80% rated",
            "Typical life 3\u20137 yrs at 20\u201325\u00b0C"
          ]
        }
      ]
    },
    {
      "key": "vsd",
      "label": "Variable Speed Drives",
      "db_table": "vsd_equipments",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Visual Inspection",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Clean internal/external; vents/fans; no damage/corrosion",
            "Controller alarms reviewed; ambient OK; no overheating",
            "Correct permanent labelling"
          ]
        },
        {
          "type": "Ingress Protection",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "IP rating suitable; no missing gland plates/glands/plugs",
            "Minimum IPXXB \u2013 no accessible live parts without tools"
          ]
        },
        {
          "type": "Ventilation",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Filters cleaned/replaced",
            "Fans operate correctly"
          ]
        },
        {
          "type": "Thermal Imaging",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Panel exterior; accessible internal components/cables"
          ]
        },
        {
          "type": "Power Capacitors",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Capacitance within limits; replace if degraded >10%",
            "Replace plastic can capacitors older than 10 years",
            "If drive idle >1 year: restore capacitors per manufacturer"
          ]
        },
        {
          "type": "Cable Terminations",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "All phase/earth connections & terminations OK; tightness OK; supported by glands/clamps"
          ]
        },
        {
          "type": "Replace Fans",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "notes": "Replace per manufacturer recommendations"
        }
      ]
    },
    {
      "key": "fire_detection_alarm",
      "label": "Fire Detection and Fire Alarm Systems",
      "db_table": "fire_detection",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Weekly User Test",
          "frequency": {
            "interval": 1,
            "unit": "weeks"
          },
          "checklist": [
            "Operate a manual call point during working hours; verify processing to sounders & ARC",
            "Alternate call point each week; record in logbook",
            "Keep test duration \u22641 minute to distinguish from real fire",
            "If staged alarms (Alert/Evacuate), operate sequentially",
            "If shift workers exist, do additional monthly test for those shifts"
          ]
        },
        {
          "type": "Periodic Inspection & Test (6\u201312 months)",
          "frequency": {
            "interval": 9,
            "unit": "months"
          },
          "checklist": [
            "Examine logbook; ensure recorded faults addressed",
            "Visual check if building/occupancy changes affect compliance",
            "Check false alarm records & 12-month rate; record actions",
            "Verify fire functions by operating \u22651 detector/MCP per circuit; record which devices",
            "Check operation of alarm devices; controls/indicators OK",
            "Verify transmission to ARC (all signal types)",
            "Test ancillary functions; simulate faults for indicators (where practicable)",
            "Test printers, consumables; service radio systems per manufacturer",
            "Report defects; update logbook; issue servicing certificate"
          ]
        },
        {
          "type": "Annual Inspection & Test",
          "frequency": {
            "interval": 12,
            "unit": "months"
          },
          "checklist": [
            "Test switch mechanism of every MCP",
            "Examine all detectors for damage/paint/etc.; functionally test each",
            "Heat detectors: test with safe heat source (no flame); special arrangements for fusible links",
            "Point smoke detectors: test with suitable material per manufacturer (smoke enters chamber)",
            "Beam detectors: introduce attenuation (filter/smoke)",
            "Aspirating systems: confirm smoke enters detector chamber",
            "CO detectors: confirm CO entry & alarm (observe safety)",
            "Flame detectors: test with suitable radiation; follow manufacturer guidance",
            "Analogue-value systems: confirm values within manufacturer range",
            "Multi-sensor detectors: verify products of combustion reach sensors; fire signal produced",
            "Verify visual alarm devices unobstructed & clean lenses",
            "Visually confirm cable fixings secure/undamaged",
            "Check standby power capacity remains suitable",
            "Test interlocks (e.g., doors, AHUs)",
            "Report defects; record inspection; servicing certificate"
          ]
        },
        {
          "type": "Batteries \u2013 Monthly/Annual",
          "frequency": {
            "interval": 1,
            "unit": "months"
          },
          "notes": "Perform battery tests/maintenance per section 3.2.16 monthly and annually"
        }
      ]
    },
    {
      "key": "earthing_systems",
      "label": "Earthing Systems",
      "db_table": "earthing",
      "fallback_note_if_missing": "Equipment pending integration into Electrohub system.",
      "controls": [
        {
          "type": "Earth Electrode Resistance \u2013 Inspection & Test",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Inspect terminations for security and protective finish",
            "Disconnect electrode from earthing system pre-test",
            "Measure earth electrode resistance \u2013 never above 200 \u03a9; readings should be <100 \u03a9"
          ]
        },
        {
          "type": "Earthing Conductor Resistance (Continuity)",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "Inspect all protective/bonding connections are sound & secure",
            "Measure conductor resistances with low resistance ohmmeter"
          ]
        },
        {
          "type": "Earth System Resistance Value Check",
          "frequency": {
            "interval": 48,
            "unit": "months"
          },
          "checklist": [
            "At each distribution stage check overall earthing system resistance with clamp-on tester (e.g., DET10C/20C)",
            "Max resistances: HV=1 \u03a9; Electrical Power=5 \u03a9; Lightning=10 \u03a9; ESD=10 \u03a9"
          ]
        },
        {
          "type": "Lightning Protection Systems \u2013 Visual & Test",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Visual: air terminations, down conductors, earth pits, joints, connections, test points \u2013 no corrosion",
            "Test: continuity with low resistance milli-ohmmeter; measure system resistance; test earth electrodes"
          ]
        },
        {
          "type": "Electrostatic Discharge (Static Earthing) \u2013 Visual & Test",
          "frequency": {
            "interval": 36,
            "unit": "months"
          },
          "checklist": [
            "Visual: conductor tapes, earth pits, joints, connections, test points/earth links, plant item connections",
            "Test: continuity from plant to earth link with low resistance ohmmeter; measure system resistance; test electrodes"
          ]
        }
      ]
    }
  ]
};
