---
sidebar_position: 2
title: Observability
description: Metrics, logs, and traces from Open Huddle.
---

# Observability

Open Huddle emits telemetry via **OpenTelemetry**. How and where you collect it is your choice.

:::info
This page describes the target state. Instrumentation is being added service-by-service as features land.
:::

## Signals

| Signal | Source | Recommended sink |
|---|---|---|
| **Metrics** | OTel SDK in every service | Prometheus |
| **Logs** | Structured JSON on stdout (slog) + OTel logs | Loki |
| **Traces** | OTel SDK, auto-propagated via Connect / gRPC metadata | Tempo |

All three land in **Grafana** dashboards shipped with the Helm chart.

## Audit vs application logs

Application logs are operational — errors, warnings, request IDs. They are not the audit log.

The **audit log** is a projection of the NATS event stream ([Architecture overview](../architecture/overview)) and is stored separately for SOC 2 / HIPAA retention requirements. See [Audit logging](../compliance/audit-logging).

## What's not in scope for the project

- Alerting rules, SLOs, and paging integrations. You own the runbook for your deployment.
- Long-term retention. Every regulated environment has its own retention requirements — choose a storage tier and lifecycle policy that fits yours.
