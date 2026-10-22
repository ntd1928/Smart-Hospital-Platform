// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Attributes, Counter, Gauge, Histogram, Meter, MetricOptions, UpDownCounter } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';
import os from 'node:os';
import type { WorkerName } from '../config/types';

export type QueueMetric = 'waitingCount' | 'delayedCount' | 'activeCount' | 'inFlightJobs' | 'jobsCompleted';

export function getQueueMetricName(queueName: WorkerName, metric: QueueMetric): string {
  return `medplum.${queueName}.${metric}`;
}

// These helpers use the global OpenTelemetry API; no exporter is initialized here.

const hostname = os.hostname();
export const BASE_METRIC_OPTIONS = { attributes: { hostname } } satisfies RecordMetricOptions;
let otelHeartbeatListener: (() => Promise<void>) | undefined;

let meter: Meter | undefined = undefined;
const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<string, Gauge>();
const upDownCounters = new Map<string, UpDownCounter>();

export type RecordMetricOptions = {
  attributes?: Attributes;
  options?: MetricOptions;
};

function getMeter(): Meter {
  meter ??= metrics.getMeter('medplum');
  return meter;
}

export function getCounter(name: string, options?: MetricOptions): Counter {
  let result = counters.get(name);
  if (!result) {
    result = getMeter().createCounter(name, options);
    counters.set(name, result);
  }
  return result;
}

export function incrementCounter(name: string, options?: RecordMetricOptions, n = 1): boolean {
  if (!isOtelMetricsEnabled()) {
    return false;
  }
  getCounter(name, options?.options).add(n, options?.attributes);
  return true;
}

export function getHistogram(name: string, options?: MetricOptions): Histogram {
  let result = histograms.get(name);
  if (!result) {
    result = getMeter().createHistogram(name, options);
    histograms.set(name, result);
  }
  return result;
}

export function recordHistogramValue(name: string, value: number, options?: RecordMetricOptions): boolean {
  if (!isOtelMetricsEnabled()) {
    return false;
  }
  getHistogram(name, options?.options).record(value, options?.attributes);
  return true;
}

export function getGauge(name: string, options?: MetricOptions): Gauge {
  let result = gauges.get(name);
  if (!result) {
    result = getMeter().createGauge(name, options);
    gauges.set(name, result);
  }
  return result;
}

export function setGauge(name: string, value: number, options?: RecordMetricOptions): boolean {
  if (!isOtelMetricsEnabled()) {
    return false;
  }
  getGauge(name, options?.options).record(value, options?.attributes);
  return true;
}

export function getUpDownCounter(name: string, options?: MetricOptions): UpDownCounter {
  let result = upDownCounters.get(name);
  if (!result) {
    result = getMeter().createUpDownCounter(name, options);
    upDownCounters.set(name, result);
  }
  return result;
}

export function addToUpDownCounter(name: string, delta: number, options?: RecordMetricOptions): boolean {
  if (!isOtelMetricsEnabled()) {
    return false;
  }
  getUpDownCounter(name, options?.options).add(delta, options?.attributes);
  return true;
}

function isOtelMetricsEnabled(): boolean {
  return !!process.env.OTLP_METRICS_ENDPOINT;
}
