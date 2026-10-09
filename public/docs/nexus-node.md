# Nexus Node Guide

A **nexus node** is a point in your supply network whose loss, on its own, would stop a large share of what you sell. The **Nexus Node Prediction** panel on the network pages finds these nodes for the selected project.

## What the score means

Each node's score is its **demand at risk**: the share of finished-goods demand you could not serve if that node alone were lost and nothing were rerouted, rebalanced or drawn from stock.

A node is **nexus** when its demand at risk is at least the threshold, which is **10% of finished-goods demand** by default. This is an absolute test, not a quota:

- A well-diversified network can have no nexus nodes at all.
- A single-product chain is nexus all along its critical path.

## How it is computed

The score is computed from your project's lane graph: the inbound, BOM and outbound lanes built from your uploads. The lane type decides how a loss travels downstream:

| Lane | Rule |
|---|---|
| Inbound — supplier → material | The material loses that supplier's **share** of its weekly supply. |
| BOM — material → product | A product needs **all** of its materials, so it loses as much as its worst-hit material. |
| Outbound — product → customer | Each product's weekly demand is the **weight** its loss carries. |

**Worked example.** A product needs materials M1 and M2. Suppliers S1 and S3 each deliver half of M1, and S2 is the only source of M2.

- Losing **S2** puts **100%** of demand at risk.
- Losing **S1** or **S3** puts **50%** at risk each.

## What the panel shows

- **Counts:** total nodes, nexus nodes and non-nexus nodes.
- **Top five:** the five nexus nodes with the highest demand at risk. For each, you see its role, the materials it is the only source of, and how many products it affects.
- **Substitutions:** any assumption the score had to make because your data didn't say. For example, every product is weighted equally when no outbound volume was uploaded.
- **Staleness:** "lanes changed since — re-run" when your data changed after the last run.

## Where results are stored

Scores are stored once per node, so they survive the next upload. Each score records which version of your data it was computed from.

## Limits

This is a **first-order** estimate. It ignores safety stock, recovery time and rerouting, so it can overstate the impact of a short outage and understate a long one.

To see an outage play out over time, run a **stress test** in the Simulation Lab. The "single-source materials" count on the lens pages is a separate, structural fact about sourcing; the two answer different questions.
