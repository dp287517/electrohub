// src/pages/Switchboard_map.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api"; // garde ton chemin actuel

import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

// Worker PDFJS (CDN, simple et fiable sur Render/Vite)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
  const canvasRef = useRef(null);

  const [pageSize, setPageSize] = useState({ w: 1, h: 1 });
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);

  // -------- load plans --------
  useEffect(() => {
    (async () => {
      setLoadingPlans(true);
      try {
        const r = await api.switchboardMaps.listPlans();
        const arr = r?.plans || r || [];
        setPlans(arr);
        if (arr[0]) setSelectedPlan(arr[0]);
      } catch (e) {
        console.error("Load plans error:", e);
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, []);

  // -------- load switchboards list --------
  useEffect(() => {
    (async () => {
      try {
        // garde ta logique : list() -> {switchboards/items}
        const r = await api.switchboards.list();
        setSwitchboards(r?.switchboards || r?.items || r?.data || []);
      } catch (e) {
        console.error("Load switchboards error:", e);
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
        setPositions(r?.positions || r || []);
      } catch (e) {
        console.error("Load positions error:", e);
      } finally {
        setLoadingPositions(false);
      }
    })();
  }, [selectedPlan, pageIndex]);

  const planUrl = useMemo(() => {
    if (!selectedPlan) return null;
    return api.switchboardMaps.planFileUrlAuto(selectedPlan, { bust: true });
  }, [selectedPlan]);

  // -------- PDF render (pdfjs-dist) --------
  async function renderPdfPage(url, pageNumber) {
    if (!url || !canvasRef.current) return;

    setIsRenderingPdf(true);
    try {
      const loadingTask = pdfjsLib.getDocument({
        url,
        withCredentials: true,
      });
      const pdf = await loadingTask.promise;

      const total = pdf.numPages || 1;
      setNumPages(total);

      const safePageNumber = Math.min(
        Math.max(1, pageNumber),
        total
      );

      const page = await pdf.getPage(safePageNumber);

      // On scale proprement selon container
      const wrap = pageWrapRef.current;
      const wrapWidth = wrap?.clientWidth || 1000;
      const baseViewport = page.getViewport({ scale: 1 });

      const scale = wrapWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      // DPR pour netteté
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      setPageSize({ w: viewport.width, h: viewport.height });

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;

      await loadingTask.destroy();
    } catch (e) {
      console.error("PDF render error:", e);
    } finally {
      setIsRenderingPdf(false);
    }
  }

  // Re-render PDF when plan or page changes
  useEffect(() => {
    if (!planUrl) return;
    renderPdfPage(planUrl, pageIndex + 1);
    // eslint-disable-next-line
  }, [planUrl, pageIndex]);

  // -------- click on a point --------
  async function onPointClick(p) {
    setFocusPoint(p);
    try {
      const r = await api.switchboards.get(p.switchboard_id);
      setFocusSwitchboard(r?.switchboard || r);
    } catch (e) {
      console.error("Load switchboard detail error:", e);
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
      setPositions(r?.positions || r || []);

      setPlacementMode(false);
    } catch (e2) {
      console.error("Placement error:", e2);
      alert("Erreur placement: " + e2.message);
    }
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
          maxWidth: "100%",
        }}
      >
        {!planUrl && <div style={{ padding: 20 }}>Aucun plan</div>}

        {planUrl && (
          <canvas ref={canvasRef} />
        )}

        {isRenderingPdf && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            Chargement PDF...
          </div>
        )}

        {/* Points overlay */}
        {planUrl &&
          positions.map((p) => {
            const left = (p.x_frac ?? p.x) * pageSize.w;
            const top = (p.y_frac ?? p.y) * pageSize.h;

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
            <h3 style={{ margin: 0 }}>Détail switchboard</h3>
            <button
              onClick={() => {
                setFocusPoint(null);
                setFocusSwitchboard(null);
              }}
            >
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
                    (window.location.href = `/app/switchboards/${focusSwitchboard.id}`)
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
