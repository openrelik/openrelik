/**
 * Metrics API: worker task counts over time, from the server's Prometheus.
 *
 * The server asks Prometheus for `increase(metric[resolution])` — summed
 * over all tasks when `aggregate` — sampled every `step` seconds over the
 * last `range` seconds. Without Prometheus configured it answers with no
 * series; with Prometheus down, it fails.
 */

import { httpClient, type RequestOptions } from '../client'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export interface MetricsQuery {
  /** A Celery exporter counter, e.g. `celery_task_succeeded_total`. */
  metric: string
  /** Sum the task or queue series into one. */
  aggregate: boolean
  /** Seconds to look back. */
  range: number
  /** Seconds between points. */
  step: number
  /** The window each point counts over, as Prometheus writes it: `1m`, `1h`. */
  resolution: string
}

/** One line: a task or queue name (or "sum"), and [time in ms, value] points. */
export interface MetricSeries {
  name: string
  data: [number, number][]
}

export const metricsApi = {
  tasks(query: MetricsQuery, options?: CallOptions): Promise<MetricSeries[]> {
    return httpClient.post<MetricSeries[]>(
      '/metrics/tasks',
      {
        metric_name: query.metric,
        aggregate: query.aggregate,
        range: query.range,
        step: query.step,
        resolution: query.resolution,
      },
      options,
    )
  },
}
