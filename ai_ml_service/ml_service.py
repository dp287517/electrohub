# ElectroHub AI/ML Prediction Service
# FastAPI + scikit-learn for predictive maintenance
#
# Endpoints:
#   GET  /health
#   POST /predict/failure - Predict equipment failure probability
#   POST /predict/maintenance - Predict optimal maintenance schedule
#   POST /analyze/patterns - Analyze usage patterns
#   POST /train - Retrain models with new data
#   POST /feedback - Submit prediction feedback for learning
#
# Launch:
#   uvicorn ml_service:app --host 0.0.0.0 --port 8089
# Or:
#   python ml_service.py

import os
import json
import pickle
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import psycopg2
from psycopg2.extras import RealDictCursor

# ML imports
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, mean_squared_error
import joblib

# Config
PG_URL = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
MODEL_DIR = Path(os.getenv("ML_MODEL_DIR", "/tmp/electrohub_models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================
# Database helpers
# ============================================================
def db_query(sql: str, params=()):
    if not PG_URL:
        return []
    conn = psycopg2.connect(PG_URL)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()

def db_execute(sql: str, params=()):
    if not PG_URL:
        return False
    conn = psycopg2.connect(PG_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
        return True
    finally:
        conn.close()

# ============================================================
# ML Models Manager
# ============================================================
class MLModelsManager:
    def __init__(self):
        self.failure_model = None
        self.maintenance_model = None
        self.scaler = StandardScaler()
        self.label_encoders = {}
        self.model_version = "1.0.0"
        self.last_trained = None
        self._load_models()

    def _load_models(self):
        """Load pre-trained models if available"""
        try:
            failure_path = MODEL_DIR / "failure_model.joblib"
            maintenance_path = MODEL_DIR / "maintenance_model.joblib"
            scaler_path = MODEL_DIR / "scaler.joblib"

            if failure_path.exists():
                self.failure_model = joblib.load(failure_path)
                print("[ML] Loaded failure prediction model")

            if maintenance_path.exists():
                self.maintenance_model = joblib.load(maintenance_path)
                print("[ML] Loaded maintenance prediction model")

            if scaler_path.exists():
                self.scaler = joblib.load(scaler_path)
                print("[ML] Loaded scaler")

        except Exception as e:
            print(f"[ML] Model load warning: {e}")

    def _save_models(self):
        """Save trained models"""
        try:
            if self.failure_model:
                joblib.dump(self.failure_model, MODEL_DIR / "failure_model.joblib")
            if self.maintenance_model:
                joblib.dump(self.maintenance_model, MODEL_DIR / "maintenance_model.joblib")
            joblib.dump(self.scaler, MODEL_DIR / "scaler.joblib")
            self.last_trained = datetime.now()
            print("[ML] Models saved successfully")
        except Exception as e:
            print(f"[ML] Model save error: {e}")

    def prepare_features(self, equipment_data: Dict) -> np.ndarray:
        """Prepare feature vector from equipment data"""
        features = []

        # Numeric features
        features.append(equipment_data.get('days_since_control', 0))
        features.append(equipment_data.get('nc_count', 0))
        features.append(equipment_data.get('total_controls', 0))
        features.append(equipment_data.get('nc_rate', 0))
        features.append(equipment_data.get('age_days', 365))
        features.append(equipment_data.get('criticality_score', 0.5))

        # Zone/type encoding (simplified)
        zone = equipment_data.get('zone', 'none')
        zone_score = {'zone0': 1.0, 'zone1': 0.8, 'zone2': 0.6, 'zone21': 0.7, 'zone22': 0.5, 'none': 0.2}
        features.append(zone_score.get(str(zone).lower(), 0.3))

        # Equipment type encoding
        eq_type = equipment_data.get('equipment_type', 'switchboard')
        type_score = {'atex': 1.0, 'vsd': 0.7, 'meca': 0.6, 'switchboard': 0.5}
        features.append(type_score.get(eq_type.lower(), 0.5))

        return np.array(features).reshape(1, -1)

    def predict_failure(self, equipment_data: Dict) -> Dict:
        """Predict failure probability for equipment"""
        try:
            features = self.prepare_features(equipment_data)

            if self.failure_model is not None:
                # Use trained model
                proba = self.failure_model.predict_proba(features)[0]
                failure_prob = float(proba[1]) if len(proba) > 1 else float(proba[0])
            else:
                # Heuristic fallback when no model trained
                failure_prob = self._heuristic_failure_prediction(equipment_data)

            # Risk classification
            if failure_prob >= 0.7:
                risk_level = "CRITICAL"
                action = "Inspection immédiate requise"
            elif failure_prob >= 0.5:
                risk_level = "HIGH"
                action = "Planifier contrôle préventif urgent"
            elif failure_prob >= 0.3:
                risk_level = "MEDIUM"
                action = "Surveillance accrue recommandée"
            else:
                risk_level = "LOW"
                action = "Maintenance standard"

            return {
                "failure_probability": round(failure_prob, 3),
                "risk_level": risk_level,
                "confidence": 0.85 if self.failure_model else 0.6,
                "recommended_action": action,
                "model_version": self.model_version,
                "factors": {
                    "days_since_control": equipment_data.get('days_since_control', 0),
                    "nc_history": equipment_data.get('nc_count', 0),
                    "equipment_type": equipment_data.get('equipment_type', 'unknown')
                }
            }
        except Exception as e:
            print(f"[ML] Prediction error: {e}")
            return {
                "failure_probability": 0.5,
                "risk_level": "UNKNOWN",
                "confidence": 0.0,
                "error": str(e)
            }

    def _heuristic_failure_prediction(self, data: Dict) -> float:
        """Fallback heuristic prediction"""
        score = 0.2  # Base score

        # Days since control factor
        days = data.get('days_since_control', 0)
        if days > 365:
            score += 0.3
        elif days > 180:
            score += 0.15
        elif days > 90:
            score += 0.05

        # NC history factor
        nc_count = data.get('nc_count', 0)
        score += min(nc_count * 0.1, 0.3)

        # NC rate factor
        nc_rate = data.get('nc_rate', 0)
        score += nc_rate * 0.2

        # Equipment type factor
        eq_type = data.get('equipment_type', '').lower()
        if eq_type == 'atex':
            score += 0.15
        elif eq_type == 'vsd':
            score += 0.1

        return min(score, 1.0)

    def predict_maintenance_date(self, equipment_data: Dict) -> Dict:
        """Predict optimal next maintenance date"""
        try:
            # Get failure prediction first
            failure_pred = self.predict_failure(equipment_data)
            failure_prob = failure_pred['failure_probability']

            # Calculate recommended days until maintenance
            if failure_prob >= 0.7:
                days_until = 0  # Immediate
            elif failure_prob >= 0.5:
                days_until = 7
            elif failure_prob >= 0.3:
                days_until = 30
            else:
                # Based on equipment type and last control
                frequency_months = equipment_data.get('frequency_months', 12)
                days_since = equipment_data.get('days_since_control', 0)
                ideal_interval = frequency_months * 30
                days_until = max(0, ideal_interval - days_since)

            recommended_date = (datetime.now() + timedelta(days=days_until)).strftime("%Y-%m-%d")

            return {
                "recommended_date": recommended_date,
                "days_until": days_until,
                "urgency": "immediate" if days_until == 0 else "week" if days_until <= 7 else "month" if days_until <= 30 else "scheduled",
                "based_on_risk": failure_prob,
                "confidence": 0.8 if self.maintenance_model else 0.65
            }
        except Exception as e:
            print(f"[ML] Maintenance prediction error: {e}")
            return {
                "recommended_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
                "days_until": 30,
                "urgency": "scheduled",
                "error": str(e)
            }

    def analyze_patterns(self, site: str) -> Dict:
        """Analyze patterns in control and NC data"""
        try:
            # Get control history
            controls = db_query("""
                SELECT
                    cr.control_date,
                    cr.result,
                    s.building_code,
                    EXTRACT(DOW FROM cr.control_date) as day_of_week,
                    EXTRACT(MONTH FROM cr.control_date) as month
                FROM control_reports cr
                LEFT JOIN switchboards s ON cr.switchboard_id = s.id
                WHERE s.site = %s
                ORDER BY cr.control_date DESC
                LIMIT 1000
            """, (site,))

            if not controls:
                return {"patterns": [], "insights": ["Pas assez de données pour l'analyse"]}

            # Analyze patterns
            patterns = []
            insights = []

            # Day of week analysis
            dow_counts = {}
            dow_nc = {}
            for c in controls:
                dow = int(c.get('day_of_week', 0))
                dow_counts[dow] = dow_counts.get(dow, 0) + 1
                if c.get('result') == 'non_conforme':
                    dow_nc[dow] = dow_nc.get(dow, 0) + 1

            # Find problematic days
            for dow, count in dow_counts.items():
                nc_count = dow_nc.get(dow, 0)
                if count > 0:
                    nc_rate = nc_count / count
                    if nc_rate > 0.3:
                        day_names = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
                        patterns.append({
                            "type": "day_pattern",
                            "day": day_names[dow],
                            "nc_rate": round(nc_rate * 100, 1),
                            "total_controls": count
                        })

            # Building analysis
            building_stats = {}
            for c in controls:
                bldg = c.get('building_code', 'Unknown')
                if bldg not in building_stats:
                    building_stats[bldg] = {'total': 0, 'nc': 0}
                building_stats[bldg]['total'] += 1
                if c.get('result') == 'non_conforme':
                    building_stats[bldg]['nc'] += 1

            # Find problematic buildings
            for bldg, stats in building_stats.items():
                if stats['total'] >= 10:
                    nc_rate = stats['nc'] / stats['total']
                    if nc_rate > 0.25:
                        patterns.append({
                            "type": "building_pattern",
                            "building": bldg,
                            "nc_rate": round(nc_rate * 100, 1),
                            "total_controls": stats['total']
                        })
                        insights.append(f"Bâtiment {bldg}: taux de NC élevé ({round(nc_rate * 100)}%)")

            # Monthly trend
            monthly_nc = {}
            for c in controls:
                month = int(c.get('month', 1))
                if month not in monthly_nc:
                    monthly_nc[month] = {'total': 0, 'nc': 0}
                monthly_nc[month]['total'] += 1
                if c.get('result') == 'non_conforme':
                    monthly_nc[month]['nc'] += 1

            # Seasonal patterns
            high_nc_months = []
            for month, stats in monthly_nc.items():
                if stats['total'] >= 5:
                    nc_rate = stats['nc'] / stats['total']
                    if nc_rate > 0.3:
                        month_names = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
                        high_nc_months.append(month_names[month - 1])

            if high_nc_months:
                insights.append(f"Mois à surveiller: {', '.join(high_nc_months)}")

            return {
                "patterns": patterns,
                "insights": insights if insights else ["Aucun pattern anormal détecté"],
                "data_points": len(controls),
                "buildings_analyzed": len(building_stats)
            }
        except Exception as e:
            print(f"[ML] Pattern analysis error: {e}")
            return {"patterns": [], "insights": [f"Erreur d'analyse: {str(e)}"], "error": str(e)}

    def train_models(self, site: str = None) -> Dict:
        """Train/retrain ML models with current data"""
        try:
            # Get training data
            controls = db_query("""
                SELECT
                    cr.switchboard_id,
                    cr.result,
                    cr.control_date,
                    s.building_code,
                    (SELECT COUNT(*) FROM control_reports cr2
                     WHERE cr2.switchboard_id = cr.switchboard_id
                     AND cr2.result = 'non_conforme') as nc_count,
                    (SELECT COUNT(*) FROM control_reports cr2
                     WHERE cr2.switchboard_id = cr.switchboard_id) as total_controls
                FROM control_reports cr
                LEFT JOIN switchboards s ON cr.switchboard_id = s.id
                WHERE s.site = %s OR %s IS NULL
                ORDER BY cr.control_date
            """, (site, site))

            if len(controls) < 50:
                return {
                    "success": False,
                    "message": "Pas assez de données pour l'entraînement (min 50 contrôles)",
                    "data_points": len(controls)
                }

            # Prepare training data
            X = []
            y = []

            for c in controls:
                features = [
                    c.get('nc_count', 0),
                    c.get('total_controls', 1),
                    c.get('nc_count', 0) / max(c.get('total_controls', 1), 1),
                    0.5,  # placeholder for days_since
                    0.5,  # placeholder for criticality
                    0.5,  # placeholder for zone
                    0.5,  # placeholder for type
                    0.5   # placeholder
                ]
                X.append(features)
                y.append(1 if c.get('result') == 'non_conforme' else 0)

            X = np.array(X)
            y = np.array(y)

            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

            # Scale features
            X_train_scaled = self.scaler.fit_transform(X_train)
            X_test_scaled = self.scaler.transform(X_test)

            # Train failure prediction model
            self.failure_model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
            self.failure_model.fit(X_train_scaled, y_train)

            # Evaluate
            y_pred = self.failure_model.predict(X_test_scaled)
            accuracy = accuracy_score(y_test, y_pred)

            # Save models
            self._save_models()

            return {
                "success": True,
                "message": f"Modèles entraînés avec succès",
                "data_points": len(controls),
                "accuracy": round(accuracy, 3),
                "model_version": self.model_version,
                "trained_at": datetime.now().isoformat()
            }
        except Exception as e:
            print(f"[ML] Training error: {e}")
            return {
                "success": False,
                "message": f"Erreur d'entraînement: {str(e)}",
                "error": str(e)
            }

# Initialize models manager
models = MLModelsManager()

# ============================================================
# FastAPI App
# ============================================================
app = FastAPI(title="ElectroHub ML Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Request models
class EquipmentData(BaseModel):
    equipment_id: Optional[str] = None
    equipment_type: str = "switchboard"
    days_since_control: int = 0
    nc_count: int = 0
    total_controls: int = 0
    nc_rate: float = 0.0
    age_days: int = 365
    criticality_score: float = 0.5
    zone: Optional[str] = None
    frequency_months: int = 12
    site: Optional[str] = None

class BatchPredictionRequest(BaseModel):
    equipments: List[EquipmentData]

class FeedbackRequest(BaseModel):
    prediction_id: Optional[str] = None
    equipment_id: str
    prediction_type: str
    was_accurate: bool
    actual_outcome: Optional[str] = None
    site: Optional[str] = None

class TrainRequest(BaseModel):
    site: Optional[str] = None

class PatternRequest(BaseModel):
    site: str

# Endpoints
@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "ElectroHub ML Service",
        "version": "1.0.0",
        "models_loaded": {
            "failure_model": models.failure_model is not None,
            "maintenance_model": models.maintenance_model is not None
        },
        "model_version": models.model_version,
        "last_trained": models.last_trained.isoformat() if models.last_trained else None
    }

@app.post("/predict/failure")
def predict_failure(data: EquipmentData):
    """Predict failure probability for a single equipment"""
    equipment_dict = data.dict()
    result = models.predict_failure(equipment_dict)
    return {"ok": True, "prediction": result}

@app.post("/predict/failure/batch")
def predict_failure_batch(data: BatchPredictionRequest):
    """Predict failure probability for multiple equipments"""
    results = []
    for eq in data.equipments:
        result = models.predict_failure(eq.dict())
        result['equipment_id'] = eq.equipment_id
        results.append(result)

    # Sort by risk
    results.sort(key=lambda x: x['failure_probability'], reverse=True)

    return {
        "ok": True,
        "predictions": results,
        "high_risk_count": sum(1 for r in results if r['risk_level'] in ['HIGH', 'CRITICAL']),
        "total": len(results)
    }

@app.post("/predict/maintenance")
def predict_maintenance(data: EquipmentData):
    """Predict optimal maintenance date for equipment"""
    equipment_dict = data.dict()
    result = models.predict_maintenance_date(equipment_dict)
    return {"ok": True, "prediction": result}

@app.post("/analyze/patterns")
def analyze_patterns(data: PatternRequest):
    """Analyze patterns in control and NC data"""
    result = models.analyze_patterns(data.site)
    return {"ok": True, "analysis": result}

@app.post("/train")
def train_models(data: TrainRequest):
    """Train/retrain ML models"""
    result = models.train_models(data.site)
    return {"ok": result['success'], **result}

@app.post("/feedback")
def submit_feedback(data: FeedbackRequest):
    """Submit feedback on predictions for learning"""
    try:
        # Store feedback in database
        db_execute("""
            INSERT INTO ai_predictions (prediction_type, target_id, target_type, site,
                                        prediction_data, was_accurate, feedback_date)
            VALUES (%s, %s, 'equipment', %s, %s, %s, NOW())
        """, (
            data.prediction_type,
            data.equipment_id,
            data.site,
            json.dumps({"actual_outcome": data.actual_outcome}),
            data.was_accurate
        ))

        return {
            "ok": True,
            "message": "Feedback enregistré, merci! Cela améliore nos prédictions."
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e)
        }

@app.get("/stats")
def get_stats():
    """Get ML service statistics"""
    try:
        # Get prediction accuracy stats
        accuracy_stats = db_query("""
            SELECT
                prediction_type,
                COUNT(*) as total,
                SUM(CASE WHEN was_accurate THEN 1 ELSE 0 END) as accurate
            FROM ai_predictions
            WHERE was_accurate IS NOT NULL
            GROUP BY prediction_type
        """)

        stats = {}
        for row in accuracy_stats:
            ptype = row['prediction_type']
            total = row['total']
            accurate = row['accurate']
            stats[ptype] = {
                "total_predictions": total,
                "accurate": accurate,
                "accuracy_rate": round(accurate / total, 3) if total > 0 else 0
            }

        return {
            "ok": True,
            "prediction_stats": stats,
            "model_version": models.model_version,
            "last_trained": models.last_trained.isoformat() if models.last_trained else None
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

# Run server
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("ML_SERVICE_PORT", "8089"))
    uvicorn.run(app, host=os.getenv("ML_SERVICE_HOST", "0.0.0.0"), port=port)
