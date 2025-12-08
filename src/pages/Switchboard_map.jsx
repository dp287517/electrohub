import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api"; // adapte le chemin si besoin
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";

// IMPORTANT: configure worker pour react-pdf
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function Switchboard_map() {
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);

  const [positions, setPositions] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingPositions, setLoadingPositions] = useState(false);

  const [numPages, setNumPages] = useState(1);

  const [switchboards, setSwitchboards] = useState([]);
  const [selectedSwitchboardId, setSelectedSwitchboardId] = useState("");
  const [placementMode, setPlacementMode] = useState(false);

  const [focusPoint, setFocusPoint] = useState(null); // {switchboard_id, x_frac, y_frac}
  const [focusSwitchboard, setFocusSwitchboard] = useState(null);

  const pageWrapRef = useRef(null);
  const [pageSize, setPageSize] = useState({ w: 1, h: 1 });

  // -------- load plans --------
  useEffect(() => {
    (async () => {
      setLoadingPlans(true);
      try {
        const r = await api.switchboardMaps.listPlans();
        const arr = r?.plans || [];
        setPlans(arr);
        if (arr[0]) setSelectedPlan(arr[0]);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, []);

  // -------- load switchboards list --------
  useEffect(() => {
    (async () => {
      try {
        const r = await api.switchboards.list(); // à vérifier chez toi
        setSwitchboards(r?.switchboards || r?.items || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // -------- load positions for plan/page --------
  useEffect(() => {
    if (!selectedPlan) return;
    (async () => {
      setLoadingPositions(true);
      try {
        const r = await api.switchboardMaps.positionsAuto(
          selectedPlan,
          pageIndex
        );
        setPositions(r?.positions || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingPositions(false);
      }
    })();
  }, [selectedPlan, pageIndex]);

  const planUrl = useMemo(() => {
    if (!selectedPlan) return null;
    return api.switchboardMaps.planFileUrlAuto(selectedPlan, { bust: true });
  }, [selectedPlan]);

  // -------- click on a point --------
  async function onPointClick(p) {
    setFocusPoint(p);
    try {
      const r = await api.switchboards.get(p.switchboard_id);
      setFocusSwitchboard(r?.switchboard || r);
    } catch (e) {
      console.error(e);
      setFocusSwitchboard(null);
    }
  }

  // -------- placement handling --------
  async function onPageClick(e) {
    if (!placementMode || !selectedSwitchboardId || !selectedPlan) return;

    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const xFrac = x / rect.width;
    const yFrac = y / rect.height;

    try {
      await api.switchboardMaps.setPosition({
        switchboard_id: selectedSwitchboardId,
        logical_name: selectedPlan.logical_name,
        plan_id: selectedPlan.id,
        page_index: pageIndex,
        x_frac: xFrac,
        y_frac: yFrac,
      });

      // refresh points
      const r = await api.switchboardMaps.positionsAuto(
        selectedPlan,
        pageIndex
      );
      setPositions(r?.positions || []);
      setPlacementMode(false);
    } catch (e2) {
      console.error(e2);
      alert("Erreur placement: " + e2.message);
    }
  }

  function onDocLoadSuccess({ numPages }) {
    setNumPages(numPages || 1);
    if (pageIndex > (numPages || 1) - 1) setPageIndex(0);
  }

  function onPageRenderSuccess(page) {
    try {
      const viewport = page.getViewport({ scale: 1 });
      setPageSize({ w: viewport.width, h: viewport.height });
    } catch {}
  }

  return (
    <div style={{ padding: 12 }}>
      <h2>Switchboards — Plans</h2>

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <label>
          Plan :{" "}
          <select
            value={selectedPlan?.id || ""}
            onChange={(e) => {
              const p = plans.find((x) => x.id === e.target.value);
              setSelectedPlan(p || null);
              setPageIndex(0);
              setFocusPoint(null);
              setFocusSwitchboard(null);
            }}
            disabled={loadingPlans}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name || p.logical_name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Page :{" "}
          <select
            value={pageIndex}
            onChange={(e) => setPageIndex(Number(e.target.value))}
            disabled={!selectedPlan}
          >
            {Array.from({ length: numPages }, (_, i) => (
              <option key={i} value={i}>
                {i + 1} / {numPages}
              </option>
            ))}
          </select>
        </label>

        <label>
          Switchboard à placer :{" "}
          <select
            value={selectedSwitchboardId}
            onChange={(e) => setSelectedSwitchboardId(e.target.value)}
          >
            <option value="">-- choisir --</option>
            {switchboards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.tag || s.id}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => setPlacementMode((v) => !v)}
          disabled={!selectedSwitchboardId}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #444",
            cursor: selectedSwitchboardId ? "pointer" : "not-allowed",
          }}
          title="Active le mode placement puis clique sur le plan"
        >
          {placementMode ? "Placement: ON" : "Placement: OFF"}
        </button>

        {loadingPositions && <span>Chargement positions…</span>}
      </div>

      {/* Viewer */}
      <div
        ref={pageWrapRef}
        onClick={onPageClick}
        style={{
          position: "relative",
          border: "1px solid #ccc",
          borderRadius: 8,
          overflow: "auto",
          display: "inline-block",
          background: "#f8f8f8",
        }}
      >
        {!planUrl && <div style={{ padding: 20 }}>Aucun plan</div>}

        {planUrl && (
          <Document file={planUrl} onLoadSuccess={onDocLoadSuccess}>
            <Page
              pageNumber={pageIndex + 1}
              onRenderSuccess={onPageRenderSuccess}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
        )}

        {/* Points overlay */}
        {planUrl &&
          positions.map((p) => {
            const left = p.x_frac * pageSize.w;
            const top = p.y_frac * pageSize.h;

            const isFocused =
              focusPoint?.switchboard_id === p.switchboard_id;

            return (
              <div
                key={`${p.switchboard_id}_${p.x_frac}_${p.y_frac}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPointClick(p);
                }}
                title="Voir switchboard"
                style={{
                  position: "absolute",
                  left,
                  top,
                  transform: "translate(-50%, -50%)",
                  width: isFocused ? 18 : 14,
                  height: isFocused ? 18 : 14,
                  borderRadius: "50%",
                  background: isFocused ? "#ff5252" : "#1976d2",
                  border: "2px solid white",
                  boxShadow: "0 1px 4px rgba(0,0,0,.35)",
                  cursor: "pointer",
                }}
              />
            );
          })}
      </div>

      {/* Details panel */}
      {focusPoint && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 8,
            background: "white",
            maxWidth: 720,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              Détail switchboard
            </h3>
            <button onClick={() => { setFocusPoint(null); setFocusSwitchboard(null); }}>
              Fermer
            </button>
          </div>

          {!focusSwitchboard && (
            <div style={{ marginTop: 8 }}>Chargement…</div>
          )}

          {focusSwitchboard && (
            <div style={{ marginTop: 8 }}>
              <div><b>Nom</b> : {focusSwitchboard.name}</div>
              <div><b>Tag</b> : {focusSwitchboard.tag}</div>
              <div><b>Building</b> : {focusSwitchboard.building}</div>
              <div><b>Zone</b> : {focusSwitchboard.zone}</div>
              <div><b>Floor</b> : {focusSwitchboard.floor}</div>
              <div><b>Location</b> : {focusSwitchboard.location}</div>
              <div><b>Status</b> : {focusSwitchboard.status}</div>

              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() =>
                    (window.location.href = `/switchboards/${focusSwitchboard.id}`)
                  }
                >
                  Ouvrir fiche Switchboard
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
