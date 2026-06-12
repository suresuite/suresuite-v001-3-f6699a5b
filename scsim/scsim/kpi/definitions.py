"""Part V — KPI dictionary. Single source for docs and the registry export."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KpiSpec:
    name: str
    symbol: str
    definition: str
    unit: str


KPI_DICTIONARY: tuple[KpiSpec, ...] = (
    KpiSpec("fill_rate", "FR",
            "Value-weighted served demand: Σ u_p·served_p / Σ u_p·D_p over the analysis "
            "window (Eq. 10); weekly FR[t] recorded in the trace.", "%"),
    KpiSpec("lost_sales_value", "—", "Σ u_p · L_p over the window.", "€"),
    KpiSpec("cost_of_resilience", "C^res",
            "mat-SS holding + backup premiums + expediting + overtime + lost sales + "
            "allocation labor + FG-SS holding (MTS) + backorder penalties (Eq. 23).", "€"),
    KpiSpec("delta_cost", "ΔC^res_i", "1 − C^res_i / C^res_S0, CRN-paired per replication "
            "(Eq. 24-style); positive = cheaper than do-nothing.", "%"),
    KpiSpec("delta_revenue", "ΔR_i", "Σu_p(Q_i − Q_S0) / Σu_p(D − Q_S0), CRN-paired "
            "(Eq. 25-style); share of S0's lost revenue recovered.", "%"),
    KpiSpec("ttr_weeks", "TTR", "Weeks from disruption start until weekly FR re-enters the "
            "pre-disruption band (3-week sustained); 0 if FR never left the band.", "wks"),
    KpiSpec("tts_weeks", "TTS", "Weeks from disruption start that FR survives inside the "
            "band (time-to-survive under the shock).", "wks"),
    KpiSpec("service_loss_area", "SLA", "∫ max(0, FR_clean − FR_disrupted) dt over the window, "
            "CRN-paired against the same portfolio without events.", "%·wks"),
    KpiSpec("max_backlog", "—", "Peak Σ_p B_p within the window.", "units"),
    KpiSpec("lost_inbound_units", "—", "Inbound rejected under overflow_rule=reject.", "units"),
    KpiSpec("synergy_R / synergy_C", "—", "Δ_portfolio − Σ Δ_components, CRN-paired, "
            "percentile-bootstrap stars.", "pp"),
    KpiSpec("resilience_index", "RI", "100·[w1(1−ŠLA) + w2(1−ŤTR) + w3·ŤTS + w4(1−Č)], "
            "w=(.35,.25,.15,.25) editable; components always shown.", "0–100"),
)
