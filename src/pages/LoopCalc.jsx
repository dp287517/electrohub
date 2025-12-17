// src/pages/LoopCalc.jsx
// Intrinsic Safety Loop Calculation per IEC 60079-25
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

// ─────────────────────────────────────────────────────────────
// API Helpers
// ─────────────────────────────────────────────────────────────
async function apiGet(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDelete(path) {
  const res = await fetch(path, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPatch(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Constants - IEC 60079-25 Intrinsic Safety
// ─────────────────────────────────────────────────────────────
const CABLE_TYPES = {
  'Standard': { resistance: 20, capacitance: 200, inductance: 0.5, description: 'Standard instrumentation cable' },
  'Shielded': { resistance: 25, capacitance: 150, inductance: 0.4, description: 'Shielded twisted pair' },
  'Low Capacitance': { resistance: 22, capacitance: 80, inductance: 0.3, description: 'Low capacitance for long runs' },
  'Armored': { resistance: 28, capacitance: 180, inductance: 0.6, description: 'Steel wire armored' },
  'Fieldbus H1': { resistance: 24, capacitance: 150, inductance: 0.4, description: 'FOUNDATION Fieldbus H1' },
  'PROFIBUS PA': { resistance: 24, capacitance: 150, inductance: 0.4, description: 'PROFIBUS PA cable' },
};

const PROTECTION_LEVELS = {
  'ia': { factor: 1.5, description: 'Two faults - Zone 0', color: 'from-red-500 to-red-600' },
  'ib': { factor: 1.5, description: 'One fault - Zone 1', color: 'from-orange-500 to-orange-600' },
  'ic': { factor: 1.0, description: 'Normal operation - Zone 2', color: 'from-yellow-500 to-yellow-600' },
};

const WIRE_CONFIGS = {
  '2-wire': { loops: 2, description: '2-wire loop (4-20mA)' },
  '3-wire': { loops: 3, description: '3-wire RTD/sensor' },
  '4-wire': { loops: 4, description: '4-wire RTD/compensated' },
};

// Entity parameters limits per IEC 60079-11
const ENTITY_LIMITS = {
  'Group IIC': { maxEnergy: 20, maxPower: 1.3, maxVoltage: 30, maxCurrent: 0.1 },
  'Group IIB': { maxEnergy: 80, maxPower: 2.0, maxVoltage: 30, maxCurrent: 0.2 },
  'Group IIA': { maxEnergy: 160, maxPower: 3.15, maxVoltage: 30, maxCurrent: 0.4 },
};

// ─────────────────────────────────────────────────────────────
// IS Loop Calculations per IEC 60079-25
// ─────────────────────────────────────────────────────────────
function calculateISLoop(params) {
  const {
    voltage,           // Source voltage (V)
    resistance,        // Cable resistance (Ω/km)
    capacitance,       // Cable capacitance (nF/km)
    inductance,        // Cable inductance (mH/km)
    distance,          // Cable length (m)
    maxCurrent,        // Max operating current (A)
    safetyFactor,      // Safety factor (1.0-2.0)
    protectionLevel,   // ia, ib, ic
    wireConfig,        // 2-wire, 3-wire, 4-wire
    gasGroup,          // IIC, IIB, IIA
    // Entity parameters (from barrier/isolator)
    Uo,               // Max open circuit voltage (V)
    Io,               // Max short circuit current (A)
    Po,               // Max output power (W)
    Co,               // Max external capacitance (µF)
    Lo,               // Max external inductance (mH)
  } = params;

  const distanceKm = distance / 1000;
  const wireLoops = WIRE_CONFIGS[wireConfig]?.loops || 2;
  const safetyMult = PROTECTION_LEVELS[protectionLevel]?.factor || 1.5;

  // Calculate cable parameters
  const cableResistance = resistance * distanceKm * wireLoops; // Ω
  const cableCap = capacitance * distanceKm * wireLoops;       // nF
  const cableInd = inductance * distanceKm;                     // mH

  // Convert to standard units
  const cableCapuF = cableCap / 1000;  // µF
  const cableIndmH = cableInd;          // mH

  // Voltage drop calculation
  const voltageDrop = maxCurrent * cableResistance;
  const voltageAtDevice = voltage - voltageDrop;

  // Power dissipation
  const powerDissipation = maxCurrent * maxCurrent * cableResistance * 1000; // mW

  // Energy storage
  const capacitiveEnergy = 0.5 * cableCapuF * 1e-6 * voltage * voltage * 1e6; // µJ
  const inductiveEnergy = 0.5 * cableIndmH * 1e-3 * maxCurrent * maxCurrent * 1e6; // µJ
  const totalStoredEnergy = capacitiveEnergy + inductiveEnergy;

  // Entity compliance checks
  const entityLimits = ENTITY_LIMITS[`Group ${gasGroup}`] || ENTITY_LIMITS['Group IIC'];

  // Check against barrier entity parameters
  const capacitanceOk = Co ? (cableCapuF * safetyMult) <= Co : true;
  const inductanceOk = Lo ? (cableIndmH * safetyMult) <= Lo : true;
  const voltageOk = Uo ? voltage <= Uo : true;
  const currentOk = Io ? maxCurrent <= Io : true;
  const powerOk = Po ? (voltage * maxCurrent) <= Po : true;

  // Overall compliance
  const entityCompliant = capacitanceOk && inductanceOk && voltageOk && currentOk && powerOk;

  // Loop operational compliance
  const voltageDropOk = voltageAtDevice >= (voltage * 0.7); // Max 30% drop
  const minOperatingVoltage = 12; // Typical for 4-20mA
  const voltageOperationalOk = voltageAtDevice >= minOperatingVoltage;

  // Energy compliance per gas group
  const energyOk = totalStoredEnergy <= entityLimits.maxEnergy;
  const powerLimitOk = (voltage * maxCurrent) <= entityLimits.maxPower;

  const compliance = entityCompliant && energyOk && powerLimitOk && voltageDropOk && voltageOperationalOk
    ? 'Compliant'
    : 'Non-compliant';

  // Calculate max allowable distance
  const maxDistance = Co && Lo
    ? Math.min(
        (Co / (capacitance / 1000 * wireLoops * safetyMult)) * 1000,
        (Lo / (inductance * safetyMult)) * 1000
      )
    : null;

  // Margin calculations
  const capacitanceMargin = Co ? ((Co - cableCapuF * safetyMult) / Co * 100) : null;
  const inductanceMargin = Lo ? ((Lo - cableIndmH * safetyMult) / Lo * 100) : null;
  const voltageMargin = voltageAtDevice > minOperatingVoltage
    ? ((voltageAtDevice - minOperatingVoltage) / (voltage - minOperatingVoltage) * 100)
    : 0;

  return {
    // Input echo
    voltage,
    distance,
    maxCurrent,
    protectionLevel,
    wireConfig,
    gasGroup,

    // Cable parameters
    cableResistance: Number(cableResistance.toFixed(4)),
    cableCapacitance: Number(cableCap.toFixed(2)),
    cableCapacitanceuF: Number(cableCapuF.toFixed(4)),
    cableInductance: Number(cableIndmH.toFixed(4)),

    // Loop performance
    voltageDrop: Number(voltageDrop.toFixed(3)),
    voltageAtDevice: Number(voltageAtDevice.toFixed(2)),
    powerDissipation: Number(powerDissipation.toFixed(2)),

    // Energy storage
    capacitiveEnergy: Number(capacitiveEnergy.toFixed(2)),
    inductiveEnergy: Number(inductiveEnergy.toFixed(2)),
    totalStoredEnergy: Number(totalStoredEnergy.toFixed(2)),

    // Entity compliance
    entityParams: { Uo, Io, Po, Co, Lo },
    capacitanceOk,
    inductanceOk,
    voltageOk,
    currentOk,
    powerOk,
    entityCompliant,

    // Overall
    energyOk,
    powerLimitOk,
    voltageDropOk,
    voltageOperationalOk,
    compliance,

    // Margins
    maxAllowableDistance: maxDistance ? Number(maxDistance.toFixed(1)) : null,
    capacitanceMargin: capacitanceMargin !== null ? Number(capacitanceMargin.toFixed(1)) : null,
    inductanceMargin: inductanceMargin !== null ? Number(inductanceMargin.toFixed(1)) : null,
    voltageMargin: Number(voltageMargin.toFixed(1)),

    // Standard reference
    standard: 'IEC 60079-25',
    entityStandard: 'IEC 60079-11',
  };
}

// ─────────────────────────────────────────────────────────────
// Result Card Component
// ─────────────────────────────────────────────────────────────
function ResultCard({ result }) {
  if (!result) return null;

  const isCompliant = result.compliance === 'Compliant';

  return (
    <div className="animate-slideUp">
      {/* Main Status Banner */}
      <div className={`rounded-xl p-6 mb-6 text-white ${
        isCompliant
          ? 'bg-gradient-to-r from-green-500 to-emerald-600'
          : 'bg-gradient-to-r from-red-500 to-rose-600'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
            isCompliant ? 'bg-white/20' : 'bg-white/20'
          }`}>
            <span className="text-3xl">{isCompliant ? '✓' : '✗'}</span>
          </div>
          <div>
            <h3 className="text-2xl font-bold">{result.compliance}</h3>
            <p className="text-white/80">
              {isCompliant
                ? 'IS loop parameters within safe limits per IEC 60079-25'
                : 'One or more parameters exceed safe limits'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Cable Parameters */}
        <div className="card p-4 border-l-4 border-blue-500">
          <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="text-blue-500">📊</span> Cable Parameters
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Total Resistance:</span>
              <span className="font-medium">{result.cableResistance} Ω</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total Capacitance:</span>
              <span className="font-medium">{result.cableCapacitance} nF</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total Inductance:</span>
              <span className="font-medium">{result.cableInductance} mH</span>
            </div>
          </div>
        </div>

        {/* Loop Performance */}
        <div className="card p-4 border-l-4 border-amber-500">
          <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="text-amber-500">⚡</span> Loop Performance
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Voltage Drop:</span>
              <span className={`font-medium ${result.voltageDropOk ? 'text-green-600' : 'text-red-600'}`}>
                {result.voltageDrop} V
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Voltage at Device:</span>
              <span className={`font-medium ${result.voltageOperationalOk ? 'text-green-600' : 'text-red-600'}`}>
                {result.voltageAtDevice} V
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Power Dissipation:</span>
              <span className="font-medium">{result.powerDissipation} mW</span>
            </div>
          </div>
        </div>

        {/* Energy Storage */}
        <div className="card p-4 border-l-4 border-purple-500">
          <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="text-purple-500">🔋</span> Energy Storage
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Capacitive Energy:</span>
              <span className="font-medium">{result.capacitiveEnergy} µJ</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Inductive Energy:</span>
              <span className="font-medium">{result.inductiveEnergy} µJ</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total Stored:</span>
              <span className={`font-medium ${result.energyOk ? 'text-green-600' : 'text-red-600'}`}>
                {result.totalStoredEnergy} µJ
              </span>
            </div>
          </div>
        </div>

        {/* Entity Compliance */}
        <div className="card p-4 border-l-4 border-emerald-500">
          <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="text-emerald-500">🛡️</span> Entity Compliance
          </h4>
          <div className="space-y-2 text-sm">
            {result.entityParams.Co && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Capacitance (C ≤ Co):</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  result.capacitanceOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {result.capacitanceOk ? 'PASS' : 'FAIL'}
                </span>
              </div>
            )}
            {result.entityParams.Lo && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Inductance (L ≤ Lo):</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  result.inductanceOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {result.inductanceOk ? 'PASS' : 'FAIL'}
                </span>
              </div>
            )}
            {result.entityParams.Uo && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Voltage (U ≤ Uo):</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  result.voltageOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {result.voltageOk ? 'PASS' : 'FAIL'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Safety Margins */}
        {(result.capacitanceMargin !== null || result.inductanceMargin !== null) && (
          <div className="card p-4 border-l-4 border-cyan-500">
            <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <span className="text-cyan-500">📏</span> Safety Margins
            </h4>
            <div className="space-y-3">
              {result.capacitanceMargin !== null && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-500">Capacitance Margin:</span>
                    <span className={`font-medium ${result.capacitanceMargin > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {result.capacitanceMargin}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.capacitanceMargin > 0 ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.max(0, Math.min(100, result.capacitanceMargin))}%` }}
                    />
                  </div>
                </div>
              )}
              {result.inductanceMargin !== null && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-500">Inductance Margin:</span>
                    <span className={`font-medium ${result.inductanceMargin > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {result.inductanceMargin}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.inductanceMargin > 0 ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.max(0, Math.min(100, result.inductanceMargin))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Max Distance */}
        {result.maxAllowableDistance && (
          <div className="card p-4 border-l-4 border-indigo-500">
            <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <span className="text-indigo-500">📐</span> Distance Limits
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Current Distance:</span>
                <span className="font-medium">{result.distance} m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Max Allowable:</span>
                <span className="font-medium text-indigo-600">{result.maxAllowableDistance} m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Utilization:</span>
                <span className={`font-medium ${
                  result.distance <= result.maxAllowableDistance ? 'text-green-600' : 'text-red-600'
                }`}>
                  {((result.distance / result.maxAllowableDistance) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Standards Reference */}
      <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 flex items-center gap-2">
        <span>📋</span>
        Calculated per {result.standard} (System verification) and {result.entityStandard} (Entity parameters)
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// IS Label Component (for PDF)
// ─────────────────────────────────────────────────────────────
function ISLoopLabel({ result, form }) {
  if (!result) return null;

  const isCompliant = result.compliance === 'Compliant';
  const protLevel = PROTECTION_LEVELS[form.protectionLevel];

  return (
    <div className="border-2 border-gray-800 rounded-lg overflow-hidden bg-white max-w-md mx-auto shadow-lg">
      {/* Header */}
      <div className={`p-3 text-white text-center ${
        isCompliant ? 'bg-blue-600' : 'bg-red-600'
      }`}>
        <div className="text-xs font-medium mb-1">INTRINSIC SAFETY</div>
        <div className="text-lg font-bold">LOOP VERIFICATION</div>
        <div className="text-xs">IEC 60079-25</div>
      </div>

      {/* Protection Level */}
      <div className={`bg-gradient-to-r ${protLevel?.color || 'from-gray-500 to-gray-600'} text-white p-2 text-center`}>
        <span className="font-bold text-lg">Ex {form.protectionLevel}</span>
        <span className="ml-2 text-sm">{form.gasGroup}</span>
      </div>

      {/* Parameters Grid */}
      <div className="grid grid-cols-2 gap-px bg-gray-300">
        <div className="bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Cable Length</div>
          <div className="text-xl font-bold">{result.distance}</div>
          <div className="text-xs text-gray-600">meters</div>
        </div>
        <div className="bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Voltage at Device</div>
          <div className="text-xl font-bold">{result.voltageAtDevice}</div>
          <div className="text-xs text-gray-600">V DC</div>
        </div>
        <div className="bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Cable Capacitance</div>
          <div className="text-xl font-bold">{result.cableCapacitanceuF}</div>
          <div className="text-xs text-gray-600">µF</div>
        </div>
        <div className="bg-white p-3 text-center">
          <div className="text-xs text-gray-500">Cable Inductance</div>
          <div className="text-xl font-bold">{result.cableInductance}</div>
          <div className="text-xs text-gray-600">mH</div>
        </div>
      </div>

      {/* Status */}
      <div className={`p-3 text-center ${isCompliant ? 'bg-green-100' : 'bg-red-100'}`}>
        <span className={`font-bold ${isCompliant ? 'text-green-700' : 'text-red-700'}`}>
          {isCompliant ? '✓ LOOP VERIFIED' : '✗ NOT VERIFIED'}
        </span>
      </div>

      {/* Entity Parameters */}
      {(result.entityParams.Co || result.entityParams.Lo) && (
        <div className="p-3 bg-gray-50 border-t">
          <div className="text-xs font-semibold text-gray-600 mb-2">ENTITY LIMITS (Barrier):</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {result.entityParams.Co && (
              <div className="flex justify-between">
                <span className="text-gray-500">Co:</span>
                <span className="font-medium">{result.entityParams.Co} µF</span>
              </div>
            )}
            {result.entityParams.Lo && (
              <div className="flex justify-between">
                <span className="text-gray-500">Lo:</span>
                <span className="font-medium">{result.entityParams.Lo} mH</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PDF Export
// ─────────────────────────────────────────────────────────────
function generatePDF(form, result) {
  const doc = new jsPDF();
  const isCompliant = result.compliance === 'Compliant';

  // Header
  doc.setFillColor(30, 58, 138); // Blue
  doc.rect(0, 0, 210, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('IS LOOP CALCULATION', 105, 18, { align: 'center' });
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Intrinsic Safety Verification per IEC 60079-25', 105, 28, { align: 'center' });
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 36, { align: 'center' });

  // Status Banner
  const statusY = 48;
  doc.setFillColor(isCompliant ? 34 : 220, isCompliant ? 197 : 38, isCompliant ? 94 : 38);
  doc.roundedRect(15, statusY, 180, 20, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(result.compliance.toUpperCase(), 105, statusY + 13, { align: 'center' });

  doc.setTextColor(0, 0, 0);
  let y = 78;

  // Project Info
  if (form.project) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Project: ${form.project}`, 15, y);
    y += 10;
  }

  // Protection Level Box
  doc.setFillColor(249, 250, 251);
  doc.roundedRect(15, y, 85, 25, 2, 2, 'F');
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text('Protection Level', 20, y + 8);
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Ex ${form.protectionLevel} ${form.gasGroup}`, 20, y + 20);

  doc.setFillColor(249, 250, 251);
  doc.roundedRect(110, y, 85, 25, 2, 2, 'F');
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.setFont('helvetica', 'normal');
  doc.text('Wire Configuration', 115, y + 8);
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(form.wireConfig, 115, y + 20);

  y += 35;

  // Input Parameters Table
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('Input Parameters', 15, y);
  y += 5;

  doc.autoTable({
    startY: y,
    head: [['Parameter', 'Value', 'Unit']],
    body: [
      ['Source Voltage', form.voltage, 'V'],
      ['Cable Type', form.cableType, ''],
      ['Cable Distance', form.distance, 'm'],
      ['Resistance', form.resistance, 'Ω/km'],
      ['Capacitance', form.capacitance, 'nF/km'],
      ['Inductance', form.inductance, 'mH/km'],
      ['Max Current', form.maxCurrent * 1000, 'mA'],
      ['Safety Factor', form.safetyFactor, ''],
    ],
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 138] },
    margin: { left: 15, right: 15 },
  });

  y = doc.lastAutoTable.finalY + 10;

  // Entity Parameters (if provided)
  if (form.Uo || form.Co || form.Lo) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text('Barrier/Isolator Entity Parameters', 15, y);
    y += 5;

    const entityBody = [];
    if (form.Uo) entityBody.push(['Uo (Max voltage)', form.Uo, 'V']);
    if (form.Io) entityBody.push(['Io (Max current)', form.Io * 1000, 'mA']);
    if (form.Po) entityBody.push(['Po (Max power)', form.Po, 'W']);
    if (form.Co) entityBody.push(['Co (Max capacitance)', form.Co, 'µF']);
    if (form.Lo) entityBody.push(['Lo (Max inductance)', form.Lo, 'mH']);

    doc.autoTable({
      startY: y,
      head: [['Parameter', 'Value', 'Unit']],
      body: entityBody,
      theme: 'striped',
      headStyles: { fillColor: [107, 114, 128] },
      margin: { left: 15, right: 15 },
    });

    y = doc.lastAutoTable.finalY + 10;
  }

  // Results Table
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('Calculation Results', 15, y);
  y += 5;

  doc.autoTable({
    startY: y,
    head: [['Parameter', 'Value', 'Status']],
    body: [
      ['Total Cable Resistance', `${result.cableResistance} Ω`, '-'],
      ['Total Cable Capacitance', `${result.cableCapacitance} nF (${result.cableCapacitanceuF} µF)`,
        result.capacitanceOk ? '✓ Pass' : '✗ Fail'],
      ['Total Cable Inductance', `${result.cableInductance} mH`,
        result.inductanceOk ? '✓ Pass' : '✗ Fail'],
      ['Voltage Drop', `${result.voltageDrop} V`, result.voltageDropOk ? '✓ Pass' : '✗ Fail'],
      ['Voltage at Device', `${result.voltageAtDevice} V`, result.voltageOperationalOk ? '✓ Pass' : '✗ Fail'],
      ['Power Dissipation', `${result.powerDissipation} mW`, '-'],
      ['Stored Energy', `${result.totalStoredEnergy} µJ`, result.energyOk ? '✓ Pass' : '✗ Fail'],
    ],
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 138] },
    margin: { left: 15, right: 15 },
    columnStyles: {
      2: {
        fontStyle: 'bold',
        cellWidth: 30,
      }
    },
    didParseCell: (data) => {
      if (data.column.index === 2 && data.section === 'body') {
        if (data.cell.text[0]?.includes('Pass')) {
          data.cell.styles.textColor = [34, 197, 94];
        } else if (data.cell.text[0]?.includes('Fail')) {
          data.cell.styles.textColor = [239, 68, 68];
        }
      }
    },
  });

  y = doc.lastAutoTable.finalY + 10;

  // Safety Margins
  if (result.maxAllowableDistance) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text('Safety Analysis', 15, y);
    y += 5;

    doc.autoTable({
      startY: y,
      head: [['Parameter', 'Value']],
      body: [
        ['Maximum Allowable Distance', `${result.maxAllowableDistance} m`],
        ['Distance Utilization', `${((result.distance / result.maxAllowableDistance) * 100).toFixed(1)}%`],
        ['Capacitance Margin', result.capacitanceMargin !== null ? `${result.capacitanceMargin}%` : 'N/A'],
        ['Inductance Margin', result.inductanceMargin !== null ? `${result.inductanceMargin}%` : 'N/A'],
      ],
      theme: 'striped',
      headStyles: { fillColor: [30, 58, 138] },
      margin: { left: 15, right: 15 },
    });
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(
      `Page ${i} of ${pageCount} | IS Loop Calculation Report | IEC 60079-25 | ElectroHub`,
      105,
      287,
      { align: 'center' }
    );
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function LoopCalc() {
  const [form, setForm] = useState({
    project: '',
    voltage: 24,
    cableType: 'Standard',
    resistance: 20,
    capacitance: 200,
    inductance: 0.5,
    distance: 100,
    maxCurrent: 0.02,
    safetyFactor: 1.5,
    protectionLevel: 'ia',
    wireConfig: '2-wire',
    gasGroup: 'IIC',
    // Entity parameters (from barrier)
    Uo: 28,
    Io: 0.093,
    Po: 0.65,
    Co: 0.83,
    Lo: 3.7,
  });
  const [result, setResult] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const labelRef = useRef(null);

  // List state
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const cf = useCallback((k, v) => setForm(s => ({ ...s, [k]: v })), []);

  // Auto-fill cable parameters when type changes
  useEffect(() => {
    const cable = CABLE_TYPES[form.cableType];
    if (cable) {
      setForm(s => ({
        ...s,
        resistance: cable.resistance,
        capacitance: cable.capacitance,
        inductance: cable.inductance,
      }));
    }
  }, [form.cableType]);

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page, pageSize, sort, dir });
      if (q) params.set('q', q);
      if (filter) params.set('compliance', filter);
      const data = await apiGet(`/api/loopcalc/calculations?${params.toString()}`);
      setRows(data.data || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Load list failed:', e);
    }
  }, [q, filter, sort, dir, page, pageSize]);

  useEffect(() => { loadList(); }, [loadList]);

  const calculate = async () => {
    setCalculating(true);
    try {
      // Calculate locally first
      const localResult = calculateISLoop(form);

      // Then save to API
      const r = await apiPost('/api/loopcalc/calculations', {
        ...form,
        ...localResult,
      });

      setResult({ ...localResult, id: r.id });
      setPage(1);
      await loadList();
    } catch (e) {
      console.error('Calculate failed:', e);
      // Show local result anyway
      setResult(calculateISLoop(form));
    } finally {
      setCalculating(false);
    }
  };

  const loadForEdit = async (id) => {
    try {
      const data = await apiGet(`/api/loopcalc/calculations/${id}`);
      setForm({
        project: data.project || '',
        voltage: data.voltage,
        cableType: data.cable_type || 'Standard',
        resistance: data.resistance,
        capacitance: data.capacitance,
        inductance: data.inductance,
        distance: data.distance,
        maxCurrent: data.max_current,
        safetyFactor: data.safety_factor,
        protectionLevel: data.protection_level || 'ia',
        wireConfig: data.wire_config || '2-wire',
        gasGroup: data.gas_group || 'IIC',
        Uo: data.uo || 28,
        Io: data.io || 0.093,
        Po: data.po || 0.65,
        Co: data.co || 0.83,
        Lo: data.lo || 3.7,
      });
      setEditingId(id);
      setResult(null);
    } catch (e) {
      console.error('Load for edit failed:', e);
    }
  };

  const updateCalculation = async () => {
    setCalculating(true);
    try {
      const localResult = calculateISLoop(form);
      const r = await apiPatch(`/api/loopcalc/calculations/${editingId}`, {
        ...form,
        ...localResult,
      });
      setResult({ ...localResult, id: r.id });
      setEditingId(null);
      resetForm();
      await loadList();
    } catch (e) {
      console.error('Update failed:', e);
    } finally {
      setCalculating(false);
    }
  };

  const deleteCalculation = async (id) => {
    if (!confirm('Delete this calculation?')) return;
    try {
      await apiDelete(`/api/loopcalc/calculations/${id}`);
      if (editingId === id) {
        setEditingId(null);
        resetForm();
        setResult(null);
      }
      await loadList();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const resetForm = () => {
    setForm({
      project: '',
      voltage: 24,
      cableType: 'Standard',
      resistance: 20,
      capacitance: 200,
      inductance: 0.5,
      distance: 100,
      maxCurrent: 0.02,
      safetyFactor: 1.5,
      protectionLevel: 'ia',
      wireConfig: '2-wire',
      gasGroup: 'IIC',
      Uo: 28,
      Io: 0.093,
      Po: 0.65,
      Co: 0.83,
      Lo: 3.7,
    });
  };

  const exportPDF = () => {
    if (!result) return;
    const doc = generatePDF(form, result);
    doc.save(`IS_Loop_${form.project || 'calculation'}_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  const changeSort = (col) => {
    if (sort === col) setDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setDir('asc'); }
  };

  const isEditing = editingId !== null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="container-wide py-8 animate-fadeIn">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl shadow-lg">
              🔄
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-800">IS Loop Calculation</h1>
              <p className="text-gray-500">Intrinsic Safety verification per IEC 60079-25</p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column - Form */}
          <div className="lg:col-span-1 space-y-6">
            {/* Project & Basic */}
            <div className="card p-6 animate-slideUp">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="text-blue-500">📋</span>
                {isEditing ? 'Edit Calculation' : 'Loop Parameters'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="label">Project Name</label>
                  <input
                    className="input mt-1"
                    value={form.project}
                    onChange={e => cf('project', e.target.value)}
                    placeholder="Enter project name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Protection Level</label>
                    <select
                      className="input mt-1"
                      value={form.protectionLevel}
                      onChange={e => cf('protectionLevel', e.target.value)}
                    >
                      {Object.entries(PROTECTION_LEVELS).map(([k, v]) => (
                        <option key={k} value={k}>Ex {k} - {v.description}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Gas Group</label>
                    <select
                      className="input mt-1"
                      value={form.gasGroup}
                      onChange={e => cf('gasGroup', e.target.value)}
                    >
                      <option value="IIC">IIC (Hydrogen)</option>
                      <option value="IIB">IIB (Ethylene)</option>
                      <option value="IIA">IIA (Propane)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Wire Configuration</label>
                  <select
                    className="input mt-1"
                    value={form.wireConfig}
                    onChange={e => cf('wireConfig', e.target.value)}
                  >
                    {Object.entries(WIRE_CONFIGS).map(([k, v]) => (
                      <option key={k} value={k}>{v.description}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Cable Parameters */}
            <div className="card p-6 animate-slideUp" style={{ animationDelay: '0.1s' }}>
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="text-amber-500">🔌</span>
                Cable Parameters
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="label">Cable Type</label>
                  <select
                    className="input mt-1"
                    value={form.cableType}
                    onChange={e => cf('cableType', e.target.value)}
                  >
                    {Object.entries(CABLE_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{k} - {v.description}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">Distance (m)</label>
                  <input
                    type="number"
                    className="input mt-1"
                    value={form.distance}
                    onChange={e => cf('distance', Number(e.target.value))}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="label text-xs">R (Ω/km)</label>
                    <input
                      type="number"
                      className="input mt-1 text-sm"
                      value={form.resistance}
                      onChange={e => cf('resistance', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">C (nF/km)</label>
                    <input
                      type="number"
                      className="input mt-1 text-sm"
                      value={form.capacitance}
                      onChange={e => cf('capacitance', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">L (mH/km)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input mt-1 text-sm"
                      value={form.inductance}
                      onChange={e => cf('inductance', Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Electrical Parameters */}
            <div className="card p-6 animate-slideUp" style={{ animationDelay: '0.2s' }}>
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="text-purple-500">⚡</span>
                Electrical Parameters
              </h2>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Source Voltage (V)</label>
                    <input
                      type="number"
                      className="input mt-1"
                      value={form.voltage}
                      onChange={e => cf('voltage', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label">Max Current (mA)</label>
                    <input
                      type="number"
                      className="input mt-1"
                      value={form.maxCurrent * 1000}
                      onChange={e => cf('maxCurrent', Number(e.target.value) / 1000)}
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Safety Factor</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input mt-1"
                    value={form.safetyFactor}
                    onChange={e => cf('safetyFactor', Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            {/* Entity Parameters */}
            <div className="card p-6 animate-slideUp" style={{ animationDelay: '0.3s' }}>
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="text-emerald-500">🛡️</span>
                Barrier Entity Parameters
              </h2>
              <p className="text-xs text-gray-500 mb-4">From barrier/isolator datasheet (IEC 60079-11)</p>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Uo (V)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input mt-1 text-sm"
                      value={form.Uo}
                      onChange={e => cf('Uo', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Io (mA)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input mt-1 text-sm"
                      value={form.Io * 1000}
                      onChange={e => cf('Io', Number(e.target.value) / 1000)}
                    />
                  </div>
                </div>
                <div>
                  <label className="label text-xs">Po (W)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input mt-1 text-sm"
                    value={form.Po}
                    onChange={e => cf('Po', Number(e.target.value))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Co (µF)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input mt-1 text-sm"
                      value={form.Co}
                      onChange={e => cf('Co', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Lo (mH)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input mt-1 text-sm"
                      value={form.Lo}
                      onChange={e => cf('Lo', Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              {isEditing ? (
                <>
                  <button
                    className="btn bg-gray-100 hover:bg-gray-200 flex-1"
                    onClick={() => { setEditingId(null); resetForm(); setResult(null); }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary flex-1"
                    onClick={updateCalculation}
                    disabled={calculating}
                  >
                    {calculating ? 'Updating...' : 'Update & Save'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn bg-gray-100 hover:bg-gray-200"
                    onClick={resetForm}
                  >
                    Reset
                  </button>
                  <button
                    className="btn btn-primary flex-1"
                    onClick={calculate}
                    disabled={calculating}
                  >
                    {calculating ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin">⚙️</span> Calculating...
                      </span>
                    ) : (
                      'Calculate & Save'
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right Column - Results & History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Results */}
            {result && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-gray-800">Calculation Results</h2>
                  <div className="flex gap-2">
                    <button
                      className="btn bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-sm"
                      onClick={() => setShowLabel(!showLabel)}
                    >
                      {showLabel ? 'Hide Label' : 'Show IS Label'}
                    </button>
                    <button
                      className="btn bg-green-500 hover:bg-green-600 text-white text-sm"
                      onClick={exportPDF}
                    >
                      📄 Export PDF
                    </button>
                  </div>
                </div>

                <ResultCard result={result} />

                {/* IS Label Preview */}
                {showLabel && (
                  <div className="animate-slideUp" ref={labelRef}>
                    <h3 className="text-sm font-semibold text-gray-600 mb-3">IS Loop Label Preview</h3>
                    <ISLoopLabel result={result} form={form} />
                  </div>
                )}
              </div>
            )}

            {/* Filters */}
            <div className="card p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  className="input flex-1"
                  placeholder="Search project, cable type..."
                  value={q}
                  onChange={e => { setQ(e.target.value); setPage(1); }}
                />
                <select
                  className="input w-full sm:w-48"
                  value={filter}
                  onChange={e => { setFilter(e.target.value); setPage(1); }}
                >
                  <option value="">All statuses</option>
                  <option value="Compliant">Compliant</option>
                  <option value="Non-compliant">Non-compliant</option>
                </select>
              </div>
            </div>

            {/* History Table */}
            <div className="card p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-800">Calculation History</h2>
                <span className="text-sm text-gray-500">{total} records</span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                    <tr>
                      {[
                        ['created_at', 'Date'],
                        ['project', 'Project'],
                        ['voltage', 'Voltage'],
                        ['distance', 'Distance'],
                        ['compliance', 'Status'],
                      ].map(([key, label]) => (
                        <th
                          key={key}
                          className="px-3 py-3 text-left cursor-pointer select-none whitespace-nowrap hover:bg-gray-200 transition-colors"
                          onClick={() => changeSort(key)}
                        >
                          {label}
                          {sort === key && (
                            <span className="ml-1 text-blue-500">
                              {dir === 'asc' ? '▲' : '▼'}
                            </span>
                          )}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="border-t hover:bg-blue-50/50 transition-colors">
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="text-xs font-medium">{new Date(r.created_at).toLocaleDateString()}</div>
                          <div className="text-xs text-gray-400">{new Date(r.created_at).toLocaleTimeString()}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="max-w-[120px] truncate font-medium" title={r.project || '—'}>
                            {r.project || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{r.voltage} V</td>
                        <td className="px-3 py-3 whitespace-nowrap">{r.distance} m</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            r.compliance === 'Compliant'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {r.compliance}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              className="btn bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded transition-colors"
                              onClick={() => loadForEdit(r.id)}
                              disabled={isEditing}
                            >
                              Edit
                            </button>
                            <a
                              className="btn bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded transition-colors"
                              href={`/api/loopcalc/${r.id}/report`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              PDF
                            </a>
                            <button
                              className="btn bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded transition-colors"
                              onClick={() => deleteCalculation(r.id)}
                              disabled={isEditing}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                          <div className="text-4xl mb-2">📊</div>
                          <div>No calculations yet</div>
                          <div className="text-sm">Enter parameters and click Calculate to start</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-gray-500">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <button
                      className="btn bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Standards Info */}
            <div className="card p-4 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <span>📚</span> Standards Reference
              </h3>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-medium text-blue-700">IEC 60079-25</div>
                  <div className="text-gray-600">Intrinsically safe electrical systems</div>
                </div>
                <div>
                  <div className="font-medium text-blue-700">IEC 60079-11</div>
                  <div className="text-gray-600">Equipment protection by intrinsic safety</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
