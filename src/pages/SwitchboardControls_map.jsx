// src/pages/SwitchboardControls_map.jsx
// Unified floor plan view for all electrical control equipment
import React from "react";
import UnifiedEquipmentMap from "../components/UnifiedEquipmentMap.jsx";

export default function SwitchboardControlsMap() {
  return (
    <UnifiedEquipmentMap
      title="Plan des Contrôles"
      subtitle="Vue centralisée des équipements avec contrôles planifiés"
      backLink="/app/switchboard-controls"
      initialVisibleTypes={["switchboard", "vsd", "meca", "mobile", "hv", "glo"]}
      showTypeFilters={true}
      showOnlyWithControls={true}
    />
  );
}
