import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api"; // conserver le chemin adapté à votre projet

import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

// Configuration du worker PDFJS (via CDN pour simplicité)
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

  const [focusPoint, setFocusPoint] = useState(null);       // { switchboard_id, x_frac, y_frac, ... }
  const [focusSwitchboard, setFocusSwitchboard] = useState(null);

  const pageWrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [pageSize, setPageSize] = useState({ w: 1, h: 1 });
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);

  // -------- Chargement de la liste des plans --------
  useEffect(() => {
    (async () => {
      setLoadingPlans(true);
      try {
        const res = await api.switchboardMaps.listPlans();
        const plansArr = res?.plans || res || [];
        setPlans(plansArr);
        if (plansArr[0]) {
          // Sélectionne par défaut le premier plan de la liste
          setSelectedPlan(plansArr[0]);
        }
      } catch (err) {
        console.error("Erreur de chargement des plans :", err);
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, []);

  // -------- Chargement de la liste des switchboards --------
  useEffect(() => {
    (async () => {
      try {
        // Récupère tous les switchboards existants (pas de pagination dans ce contexte)
        const res = await api.switchboards.list();
        const list = res?.switchboards || res?.items || res?.data || [];
        setSwitchboards(list);
      } catch (err) {
        console.error("Erreur de chargement des switchboards :", err);
      }
    })();
  }, []);

  // -------- Chargement des positions pour le plan/page courants --------
  useEffect(() => {
    if (!selectedPlan) return;
    (async () => {
      setLoadingPositions(true);
      try {
        const res = await api.switchboardMaps.positionsAuto(selectedPlan, pageIndex);
        const posList = res?.positions || res || [];
        setPositions(posList);
      } catch (err) {
        console.error("Erreur de chargement des positions :", err);
      } finally {
        setLoadingPositions(false);
      }
    })();
  }, [selectedPlan, pageIndex]);

  // Mémorise l’URL du fichier PDF du plan sélectionné (avec bust de cache)
  const planUrl = useMemo(() => {
    if (!selectedPlan) return null;
    return api.switchboardMaps.planFileUrlAuto(selectedPlan, { bust: true });
  }, [selectedPlan]);

  // -------- Rendu PDF d’une page via pdfjs-dist --------
  async function renderPdfPage(url, pageNumber) {
    if (!url || !canvasRef.current) return;
    setIsRenderingPdf(true);
    try {
      // Chargement du document PDF
      const loadingTask = pdfjsLib.getDocument({ url, withCredentials: true });
      const pdf = await loadingTask.promise;

      // Récupère le nombre total de pages
      const totalPages = pdf.numPages || 1;
      setNumPages(totalPages);

      // Sécurise le numéro de page demandé (borne dans [1, totalPages])
      const safePageNum = Math.min(Math.max(1, pageNumber), totalPages);
      const page = await pdf.getPage(safePageNum);

      // Calcule le viewport à l’échelle du conteneur
      const wrap = pageWrapRef.current;
      const wrapWidth = wrap?.clientWidth || 1000;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = wrapWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      // Prépare le canvas pour le rendu
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      // Utilise le ratio d’écran (DPR) pour améliorer la netteté
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Mémorise la taille de page (utilisée pour positionner les points)
      setPageSize({ w: viewport.width, h: viewport.height });

      // Dessine la page PDF sur le canvas
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Libère les ressources PDF
      await loadingTask.destroy();
    } catch (err) {
      console.error("Erreur lors du rendu PDF :", err);
    } finally {
      setIsRenderingPdf(false);
    }
  }

  // Re-rendu du PDF à chaque changement de plan ou de page
  useEffect(() => {
    if (planUrl) {
      renderPdfPage(planUrl, pageIndex + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planUrl, pageIndex]);

  // -------- Gestion du clic sur un point existant --------
  async function onPointClick(point) {
    setFocusPoint(point);
    try {
      // Récupère les détails du switchboard associé au point cliqué
      const res = await api.switchboards.get(point.switchboard_id);
      const sw = res?.switchboard || res;
      setFocusSwitchboard(sw);
    } catch (err) {
      console.error("Erreur de chargement du détail switchboard :", err);
      setFocusSwitchboard(null);
    }
  }

  // -------- Gestion du placement d’un nouveau point --------
  async function onPageClick(event) {
    if (!placementMode || !selectedSwitchboardId || !selectedPlan) return;
    // Calcule la position cliquée en pourcentage du conteneur
    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    const xFrac = clickX / rect.width;
    const yFrac = clickY / rect.height;
    try {
      // Enregistre la position du switchboard sélectionné sur le plan
      await api.switchboardMaps.setPosition({
        switchboard_id: selectedSwitchboardId,
        logical_name: selectedPlan.logical_name,
        plan_id: selectedPlan.id,
        page_index: pageIndex,
        x_frac: xFrac,
        y_frac: yFrac,
      });
      // Recharge la liste des positions pour voir le nouveau point
      const res = await api.switchboardMaps.positionsAuto(selectedPlan, pageIndex);
      const posList = res?.positions || res || [];
      setPositions(posList);
      // Désactive le mode placement une fois l’opération terminée
      setPlacementMode(false);
    } catch (err) {
      console.error("Erreur lors du placement :", err);
      alert("Erreur placement : " + err.message);
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <h2>Switchboards — Plans</h2>

      {/* Barre d'outils */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        {/* Sélecteur de plan */}
        <label>
          Plan :{" "}
          <select
            value={selectedPlan?.id || ""}
            onChange={(e) => {
              const plan = plans.find((p) => p.id === e.target.value);
              setSelectedPlan(plan || null);
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

        {/* Sélecteur de page PDF */}
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

        {/* Sélecteur de switchboard à placer */}
        <label>
          Switchboard à placer :{" "}
          <select
            value={selectedSwitchboardId}
            onChange={(e) => setSelectedSwitchboardId(e.target.value)}
          >
            <option value="">-- choisir --</option>
            {switchboards.map((sw) => (
              <option key={sw.id} value={sw.id}>
                {sw.name || sw.tag || sw.id}
              </option>
            ))}
          </select>
        </label>

        {/* Bouton de mode placement */}
        <button
          onClick={() => setPlacementMode((prev) => !prev)}
          disabled={!selectedSwitchboardId}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #444",
            cursor: selectedSwitchboardId ? "pointer" : "not-allowed",
          }}
          title="Activer le mode placement puis cliquer sur le plan"
        >
          {placementMode ? "Placement : ON" : "Placement : OFF"}
        </button>

        {loadingPositions && <span>Chargement des positions…</span>}
      </div>

      {/* Zone d'affichage du plan PDF */}
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
        {!planUrl && <div style={{ padding: 20 }}>Aucun plan à afficher</div>}

        {planUrl && <canvas ref={canvasRef} />}

        {isRenderingPdf && (
          // Indicateur de chargement du PDF
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
            Chargement du PDF...
          </div>
        )}

        {/* Points positionnés en surimpression */}
        {planUrl &&
          positions.map((p) => {
            const left = (p.x_frac ?? p.x) * pageSize.w;
            const top = (p.y_frac ?? p.y) * pageSize.h;
            const isFocused = focusPoint?.switchboard_id === p.switchboard_id;
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
                  left: left,
                  top: top,
                  transform: "translate(-50%, -50%)",
                  width: isFocused ? 18 : 14,
                  height: isFocused ? 18 : 14,
                  borderRadius: "50%",
                  background: isFocused ? "#ff5252" : "#1976d2",
                  border: "2px solid white",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                  cursor: "pointer",
                }}
              />
            );
          })}
      </div>

      {/* Panneau de détail du switchboard sélectionné */}
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
              <div><b>Bâtiment</b> : {focusSwitchboard.building}</div>
              <div><b>Zone</b> : {focusSwitchboard.zone}</div>
              <div><b>Étage</b> : {focusSwitchboard.floor}</div>
              <div><b>Localisation</b> : {focusSwitchboard.location}</div>
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
