// src/pages/SwitchboardControls_map.jsx
// Unified floor plan view for all electrical control equipment
// Clicking on a marker navigates to the controls list filtered by that equipment
import React from "react";
import { useNavigate } from "react-router-dom";
import UnifiedEquipmentMap from "../components/UnifiedEquipmentMap.jsx";

export default function SwitchboardControlsMap() {
  const navigate = useNavigate();

  // Custom handler: navigate to controls list filtered by equipment
  const handleMarkerClick = (position, controlStatus) => {
    if (!position) return;

    // Map equipment types to URL parameter names (matching SwitchboardControls expectations)
    const typeToParam = {
      switchboard: 'switchboard',
      vsd: 'vsd_equipment_id',
      meca: 'meca_equipment_id',
      mobile: 'mobile_equipment_id',
      hv: 'hv_equipment_id',
      glo: 'glo_equipment_id',
      datahub: 'datahub_equipment_id',
      infrastructure: 'infrastructure_equipment_id',
    };

    // Get base type (remove category suffix like datahub_cat_xxx)
    let baseType = position.equipment_type;
    if (baseType?.startsWith('datahub_cat_')) baseType = 'datahub';
    if (baseType?.startsWith('infrastructure_cat_')) baseType = 'infrastructure';
    if (baseType?.startsWith('meca_cat_')) baseType = 'meca';

    const paramName = typeToParam[baseType] || 'equipment_id';

    // Navigate to controls list (schedules tab) with equipment filter
    const url = `/app/switchboard-controls?tab=schedules&equipment_type=${baseType}&${paramName}=${position.equipment_id}`;
    console.log('[ControlsMap] Navigating to controls:', url);
    navigate(url);
  };

  return (
    <UnifiedEquipmentMap
      title="Plan des Contrôles"
      subtitle="Vue centralisée des équipements avec contrôles planifiés"
      backLink="/app/switchboard-controls"
      initialVisibleTypes={["switchboard", "vsd", "meca", "mobile", "hv", "glo"]}
      showTypeFilters={true}
      showOnlyWithControls={true}
      onMarkerClick={handleMarkerClick}
    />
  );
}
